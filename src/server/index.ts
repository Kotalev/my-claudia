import Fastify, { LogController, type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOST, PORT, isLoopbackHost } from '../shared/config.js'
import { ProjectRegistry } from './registry.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerExportRoutes } from './routes/export.js'
import { registerSearchRoutes } from './routes/search.js'
import { registerTaskRoutes } from './routes/tasks.js'
import { TaskStore } from '../tasks/store.js'
import { SessionStore } from './watcher/session-store.js'
import { SessionWatcher } from './watcher/index.js'
import { TasksWatcher, type TasksChange } from './watcher/tasks-watcher.js'
import { EventHub } from './ws/hub.js'
import { isAllowedHost, isAllowedOrigin } from './origin-guard.js'
import { extractToken, loadOrCreateToken, requiresToken, tokenMatches } from './auth.js'
import { Dispatcher } from './dispatcher/index.js'
import { DispatchQueue } from './dispatcher/queue.js'
import { pruneStaleWorktrees } from './dispatcher/worktree.js'
import { registerDispatchRoutes } from './routes/dispatch.js'
import { registerHookRoutes } from './routes/hooks.js'
import { PermissionBroker, registerPermissionRoutes } from './routes/permissions.js'
import { registerStatuslineRoutes } from './routes/statusline.js'
import { registerHookInstallRoutes } from './routes/hook-install.js'
import { SessionsRegistry } from './live/sessions-registry.js'
import { startAlerts } from './alerts/index.js'
import { registerStatic } from './static.js'
import { AgentsPoller, mergeLive } from './live/agents-poller.js'
import { SpendLedger } from './usage/spend-ledger.js'
import { openHistoryDb } from './history/db.js'
import { HistoryRecorder } from './history/recorder.js'
import { registerHistoryRoutes } from './routes/history.js'
import { registerDigestRoutes } from './routes/digest.js'
import { listPendingReviews, worktreeKeepSet } from './reviews/index.js'
import { Scheduler } from './scheduler/index.js'
import { LoopController } from './scheduler/loop.js'
import { deferLoopIteration, DeferralTracker } from './scheduler/limit-defer.js'
import { registerScheduleRoutes } from './routes/schedules.js'
import { registerTemplateRoutes } from './routes/templates.js'
import { buildTaskPrompt } from './dispatcher/prompt.js'
import { readAccountEmail } from './usage/account.js'
import { isCountable } from './watcher/usage.js'
import { projectsDir } from '../shared/config.js'
import type { AccountInfo, PendingReview, ProjectRecord, QueuedDispatch, RunHandle, ScheduleJob } from '../shared/types.js'

/** Absolute path to the forwarder, resolved once — a project's settings must not hold a relative path. */
const HOOK_SCRIPT_PATH = fileURLToPath(new URL('../../scripts/hook-post.sh', import.meta.url))
const STATUSLINE_SCRIPT_PATH = fileURLToPath(new URL('../../scripts/statusline.sh', import.meta.url))
const PERMISSION_SCRIPT_PATH = fileURLToPath(new URL('../../scripts/permission-prompt.sh', import.meta.url))

declare module 'fastify' {
  interface FastifyInstance {
    registry: ProjectRegistry
    store: SessionStore
    watcher: SessionWatcher
    tasksWatcher: TasksWatcher
    dispatcher: Dispatcher
    sessionsRegistry: SessionsRegistry
    hub: EventHub
    authToken: string
  }
}

export async function buildServer(
  storePath = join(process.cwd(), 'projects.json'),
  tokenPath = join(process.cwd(), '.auth-token'),
  // Overridable so a test server can never prune the real .worktrees or open
  // the real history db of a dashboard running beside the test run.
  paths: { worktreesRoot?: string; historyDbPath?: string } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: 'info' },
    logController: new LogController({ disableRequestLogging: true }),
  })

  const authToken = await loadOrCreateToken(tokenPath)

  const registry = new ProjectRegistry(storePath)
  await registry.load()
  const store = new SessionStore()
  const watcher = new SessionWatcher(registry, store)
  await watcher.start()

  const worktreesRoot = paths.worktreesRoot ?? join(process.cwd(), '.worktrees')
  const dispatcher = new Dispatcher({ worktreesRoot })
  const dispatchQueue = new DispatchQueue(dispatcher)

  // Claude Code's own live-session registry. Started before the hub so the first
  // snapshot already carries the running processes rather than an empty band.
  const sessionsRegistry = new SessionsRegistry()
  await sessionsRegistry.start()
  const agentsPoller = new AgentsPoller()
  store.setLive(mergeLive(sessionsRegistry.list(), agentsPoller.list()))

  const tasksWatcher = new TasksWatcher(registry)
  await tasksWatcher.start()

  // Task docs live on disk, so the snapshot reads them fresh rather than caching
  // a copy the watcher would then have to keep in step.
  const taskDocs = async (): Promise<Record<string, unknown>> => {
    const entries = await Promise.all(registry.list().map(async p =>
      [p.id, await new TaskStore(p.path).read()] as const))
    return Object.fromEntries(entries)
  }
  let cachedDocs: Record<string, unknown> = await taskDocs()

  const spendLedger = new SpendLedger()

  // Persistent history. Degrades to a disabled no-op handle on Node < 22.5
  // (no node:sqlite) or an unreadable db file — never fatal.
  const historyDb = await openHistoryDb(paths.historyDbPath ?? join(process.cwd(), 'mission-control.db'))
  const historyRecorder = new HistoryRecorder(historyDb)
  historyRecorder.attach(dispatcher)

  // Runs are in-memory only, so after a restart the directories under
  // .worktrees are orphans from a previous process — EXCEPT the ones behind
  // unresolved worktree runs in the history db, whose unreviewed (possibly
  // uncommitted) changes must survive. Prune before any dispatch can create a
  // fresh one; with history disabled there is nothing to consult, so all go.
  await pruneStaleWorktrees(worktreesRoot, worktreeKeepSet(dispatcher.list(), historyDb))

  // The review backlog is cached: the snapshot callback is synchronous, and
  // computing the list means asking git which branches still exist.
  const computeReviews = (): Promise<PendingReview[]> => listPendingReviews({
    runs: dispatcher.list(),
    history: historyDb,
    projectPath: id => registry.byId(id)?.path,
  })
  let cachedReviews: PendingReview[] = await computeReviews()

  const scheduler = new Scheduler(historyDb)
  const getFiveHour = () => store.planLimits()?.fiveHour ?? null
  // Loop schedules: follows a fired loop job's run (or queued dispatch) to its
  // end and creates the next iteration's job — iterations never overlap.
  const loops = new LoopController(scheduler, dispatcher, dispatchQueue, { getFiveHour })

  // The account file changes only on login/logout, so a lazy re-read every few
  // minutes is enough — and never on the broadcast path.
  const ACCOUNT_TTL_MS = 5 * 60_000
  let account: AccountInfo | null = null
  let accountReadAt = 0
  const accountInfo = (): AccountInfo | null => {
    if (Date.now() - accountReadAt >= ACCOUNT_TTL_MS) {
      const email = readAccountEmail()
      account = email === null ? null : { email }
      accountReadAt = Date.now()
    }
    return account
  }

  const permissionBroker = new PermissionBroker()

  const hub = new EventHub(() => ({
    projects: registry.list(),
    sessions: store.all(),
    tasks: cachedDocs,
    planLimits: store.planLimits(),
    spend: spendLedger.summary(),
    account: accountInfo(),
    runs: dispatcher.list(),
    permissions: permissionBroker.list(),
    schedules: scheduler.list(),
    queue: dispatchQueue.list(),
    reviews: cachedReviews,
  }))
  const refreshReviews = (): void => {
    void computeReviews().then(reviews => {
      cachedReviews = reviews
      hub.broadcast({ type: 'review.updated', reviews })
    }).catch(err => app.log.warn(`review list refresh failed: ${(err as Error).message}`))
  }
  dispatchQueue.on('changed', (queue: QueuedDispatch[]) =>
    hub.broadcast({ type: 'queue.updated', queue }))
  permissionBroker.onRequested = request =>
    hub.broadcast({ type: 'permission.requested', request })
  permissionBroker.onResolved = (id, behavior) =>
    hub.broadcast({ type: 'permission.resolved', id, behavior })
  watcher.on('session', session => hub.broadcast({ type: 'session.updated', session }))

  // Entries arrive in bursts during a turn; one spend figure per ~2s is plenty
  // for a band segment, so the broadcast is a trailing-edge throttle.
  let spendTimer: NodeJS.Timeout | null = null
  const scheduleSpendBroadcast = (): void => {
    if (spendTimer) return
    spendTimer = setTimeout(() => {
      spendTimer = null
      const spend = spendLedger.summary()
      historyRecorder.recordSpend(spend)
      hub.broadcast({ type: 'spend.updated', spend })
    }, 2_000)
    spendTimer.unref()
  }
  store.onSpendEntry((projectId, entry) => {
    spendLedger.addEntry(projectId, entry)
    if (isCountable(entry)) scheduleSpendBroadcast()
  })
  const scanIntoLedger = (p: ProjectRecord): void => {
    // Not awaited: pricing a month of transcripts must not delay startup or a
    // registration response. The finished scan announces itself through the
    // throttled broadcast, and dedup makes the overlap with the live feed safe.
    void spendLedger.scanProject(p.id, join(projectsDir(), p.escapedDir)).then(scheduleSpendBroadcast)
  }
  let spendProjectIds = new Set(registry.list().map(p => p.id))
  for (const p of registry.list()) scanIntoLedger(p)

  const pushLive = (): void => {
    for (const session of store.setLive(mergeLive(sessionsRegistry.list(), agentsPoller.list()))) {
      hub.broadcast({ type: 'session.updated', session })
    }
  }
  sessionsRegistry.on('change', pushLive)
  agentsPoller.on('change', pushLive)
  // Not awaited: the first poll shells out to `claude`, and the dashboard must
  // come up whether or not that binary answers.
  void agentsPoller.start()
  dispatcher.on('output', ({ runId, chunk }: { runId: string; chunk: string }) =>
    hub.broadcast({ type: 'dispatch.output', runId, chunk }))
  dispatcher.on('update', (run: RunHandle) => {
    hub.broadcast({ type: 'dispatch.updated', run })
    // A run ending, merging or discarding all re-emit the ended handle — each
    // changes what is pending review.
    if (run.endedAt !== null) refreshReviews()
  })
  tasksWatcher.on('tasks', ({ projectId, doc }: TasksChange) => {
    cachedDocs = { ...cachedDocs, [projectId]: doc }
    hub.broadcast({ type: 'task.updated', projectId, doc })
  })

  await app.register(websocket)

  // Applies to the WebSocket upgrade request too, which is the point: /ws would
  // otherwise be reachable from any page the user happens to have open.
  app.addHook('onRequest', async (req, reply) => {
    if (!isAllowedHost(req.headers.host) || !isAllowedOrigin(req.headers.origin)) {
      return reply.code(403).send({ error: 'forbidden: non-local host or origin' })
    }
    // The origin guard only keeps browsers honest; the token is what keeps
    // other local processes out of the API and the socket.
    if (requiresToken(req.url) && !tokenMatches(extractToken(req.url, req.headers), authToken)) {
      return reply.code(401).send({ error: 'missing or invalid token' })
    }
  })

  app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }))
  registerProjectRoutes(app, registry, async () => {
    await tasksWatcher.restart()
    cachedDocs = await taskDocs()
    // The project list only ever reached a client in the snapshot, so an added or
    // removed project stayed invisible until the tab reconnected.
    hub.broadcast({ type: 'projects.updated', projects: registry.list() })
    // A newly registered project's history enters the ledger by scan; an
    // unregistered one leaves it by dropping its buckets.
    const currentIds = new Set(registry.list().map(p => p.id))
    for (const p of registry.list()) if (!spendProjectIds.has(p.id)) scanIntoLedger(p)
    for (const id of spendProjectIds) {
      if (!currentIds.has(id)) {
        spendLedger.removeProject(id)
        scheduleSpendBroadcast()
      }
    }
    spendProjectIds = currentIds
    // Sessions of an unregistered project would otherwise keep pointing at a card
    // that no longer exists, and vanish from the dashboard rather than fall back
    // to the unregistered list.
    for (const session of store.forgetUnregistered(currentIds)) {
      hub.broadcast({ type: 'session.updated', session })
    }
  })
  registerSessionRoutes(app, store, registry)
  registerExportRoutes(app, registry, store, spendLedger)
  registerSearchRoutes(app, store, registry)
  const publishTasks = (projectId: string): void => {
    const project = registry.byId(projectId)
    if (!project) return
    void new TaskStore(project.path).read().then(doc => {
      cachedDocs = { ...cachedDocs, [projectId]: doc }
      hub.broadcast({ type: 'task.updated', projectId, doc })
    })
  }

  registerTaskRoutes(app, registry, publishTasks)
  registerDispatchRoutes(app, registry, dispatcher, dispatchQueue, store, publishTasks,
    historyDb, worktreesRoot, refreshReviews)
  registerHistoryRoutes(app, historyDb)
  registerDigestRoutes(app, {
    history: historyDb,
    liveRuns: () => dispatcher.list(),
    pendingReviews: () => cachedReviews,
    stoppedLoops: () => loops.stopped(),
  })
  registerTemplateRoutes(app, historyDb)
  registerScheduleRoutes(app, registry, scheduler, loops)
  scheduler.on('changed', (schedules: ScheduleJob[]) =>
    hub.broadcast({ type: 'schedule.updated', schedules }))

  // What a schedule does when its moment comes. A fired job is already gone
  // from the scheduler; a failed resume re-adds itself a few times, everything
  // else fails into the log — a missed schedule must never sink the server.
  const RESUME_RETRY_MS = 5 * 60_000
  const MAX_RESUME_ATTEMPTS = 6
  const resumeAttempts = new Map<string, number>()
  const loopDeferrals = new DeferralTracker()
  const executeSchedule = async (job: ScheduleJob): Promise<void> => {
    const project = registry.byId(job.projectId)
    if (!project) {
      app.log.warn(`schedule ${job.id} dropped: project ${job.projectId} is no longer registered`)
      loops.abort(job, `project ${job.projectId} is no longer registered`)
      return
    }
    if (job.kind === 'resume-run' && job.sessionId !== null) {
      try {
        await dispatcher.start({
          projectId: project.id, projectPath: project.path, taskId: null,
          prompt: job.prompt ?? 'continue', kind: 'resume', resumeSessionId: job.sessionId,
        })
        resumeAttempts.delete(job.sessionId)
      } catch (err) {
        // Usually the in-place 1-per-project guard: something else is running
        // there right now. Try again shortly, a bounded number of times.
        const attempts = (resumeAttempts.get(job.sessionId) ?? 0) + 1
        if (attempts >= MAX_RESUME_ATTEMPTS) {
          resumeAttempts.delete(job.sessionId)
          app.log.warn(`giving up on resuming session ${job.sessionId} after ${attempts} attempts: ${(err as Error).message}`)
          return
        }
        resumeAttempts.set(job.sessionId, attempts)
        scheduler.add({
          kind: 'resume-run', projectId: job.projectId, taskId: null,
          sessionId: job.sessionId, prompt: job.prompt,
          runAt: new Date(Date.now() + RESUME_RETRY_MS).toISOString(),
          note: `retry ${attempts + 1}/${MAX_RESUME_ATTEMPTS}`,
        })
      }
    } else if (job.kind === 'dispatch-task' && job.taskId !== null) {
      // The task text is read now, not at scheduling time, so edits made in
      // the meantime are what actually runs — same path as a manual dispatch.
      const taskStore = new TaskStore(project.path)
      const doc = await taskStore.read()
      const task = doc.tasks.find(t => t.id === job.taskId)
      if (!task) {
        app.log.warn(`schedule ${job.id} dropped: task ${job.taskId} no longer exists in ${project.name}`)
        loops.abort(job, `task ${job.taskId} no longer exists`)
        return
      }
      // A loop iteration facing a nearly exhausted 5h window is postponed —
      // re-added as the same iteration past the reset, capped so a stuck
      // window cannot defer forever. One-shots fire as the human scheduled.
      if (job.loopId !== null) {
        const shift = deferLoopIteration(job, getFiveHour(), Date.now())
        if (shift !== null && loopDeferrals.defer(job.loopId)) {
          scheduler.add({
            kind: job.kind, projectId: job.projectId, taskId: job.taskId,
            sessionId: job.sessionId, prompt: job.prompt,
            runAt: shift.runAt, note: shift.note,
            repeatEveryMs: job.repeatEveryMs, loopId: job.loopId,
            iteration: job.iteration,
            maxIterations: job.maxIterations, stopAfterFailures: job.stopAfterFailures,
          })
          return
        }
      }
      try {
        const input = {
          projectId: project.id, projectPath: project.path, taskId: task.id,
          prompt: buildTaskPrompt(task), loopId: job.loopId,
        }
        if (job.loopId !== null) {
          // A loop iteration goes through the queue so a busy project delays it
          // rather than killing the loop; the controller follows it from there.
          const result = await dispatchQueue.start(input)
          loopDeferrals.dispatched(job.loopId)
          if ('run' in result) loops.started(job, result.run.runId)
          else loops.queued(job, result.queued.queueId)
        } else {
          await dispatcher.start(input)
        }
        if (task.status === 'todo') {
          await taskStore.updateTask(task.id, { status: 'in-progress' })
          publishTasks(project.id)
        }
      } catch (err) {
        app.log.warn(`scheduled dispatch of ${job.taskId} failed: ${(err as Error).message}`)
        loops.startFailed(job)
      }
    } else {
      app.log.warn(`schedule ${job.id} dropped: unusable job (kind ${job.kind})`)
    }
  }
  scheduler.on('fire', (job: ScheduleJob) => {
    executeSchedule(job).catch(err =>
      app.log.warn(`schedule ${job.id} failed: ${(err as Error).message}`))
  })

  // Auto-continue: a run that died rate-limited is re-armed for just after the
  // window resets. Always on for such runs (SPEC section 8) — cancelling the
  // schedule from the dashboard is the opt-out.
  dispatcher.on('rate-limited', (run: RunHandle) => {
    if (!run.sessionId) return
    const resetsAtMs = run.lastRateLimit?.resetsAt != null ? run.lastRateLimit.resetsAt * 1000 : null
    const runAtMs = resetsAtMs !== null && resetsAtMs > Date.now()
      ? resetsAtMs + 60_000               // a minute of slack after the reset
      : Date.now() + 30 * 60_000          // no usable reset time: try in half an hour
    scheduler.add({
      kind: 'resume-run', projectId: run.projectId, taskId: null,
      sessionId: run.sessionId, prompt: 'continue',
      runAt: new Date(runAtMs).toISOString(),
      note: `auto-continue after ${run.lastRateLimit?.rateLimitType ?? 'rate limit'}`,
    })
  })

  // Started only now, with the fire listener attached: jobs left over from a
  // previous process may fire the moment they load.
  scheduler.start()
  registerHookRoutes(app, store, registry, session =>
    hub.broadcast({ type: 'session.updated', session }))
  registerPermissionRoutes(app, permissionBroker)
  registerStatuslineRoutes(
    app,
    store,
    session => hub.broadcast({ type: 'session.updated', session }),
    () => hub.broadcast({ type: 'plan.updated', planLimits: store.planLimits() }),
  )
  registerHookInstallRoutes(app, registry, HOOK_SCRIPT_PATH, STATUSLINE_SCRIPT_PATH, PERMISSION_SCRIPT_PATH)

  app.get('/ws', { websocket: true }, socket => {
    const send = (payload: string) => socket.send(payload)
    const disconnect = hub.addClient(send)
    socket.on('message', (raw: Buffer) => hub.handleClientMessage(raw.toString(), send))
    socket.on('close', disconnect)
    socket.on('error', disconnect)
  })

  // Status decays with wall-clock time, so quiet sessions need a nudge to stop
  // being reported as active in tabs that are already open.
  const sweep = setInterval(() => {
    for (const session of store.sweepStatusChanges()) {
      hub.broadcast({ type: 'session.updated', session })
    }
  }, 60_000)
  sweep.unref()

  const alerts = startAlerts({
    getSessions: () => store.all(),
    getFiveHour,
  })

  // In production the API also serves the built UI, so `npm start` is the whole
  // dashboard on one port. In dev the Vite server owns the UI and proxies here.
  await registerStatic(app)

  app.decorate('authToken', authToken)
  app.decorate('registry', registry)
  app.decorate('store', store)
  app.decorate('watcher', watcher)
  app.decorate('tasksWatcher', tasksWatcher)
  app.decorate('dispatcher', dispatcher)
  app.decorate('sessionsRegistry', sessionsRegistry)
  app.decorate('hub', hub)
  app.addHook('onClose', async () => {
    clearInterval(sweep)
    alerts.stop()
    if (spendTimer) clearTimeout(spendTimer)
    agentsPoller.stop()
    scheduler.stop()
    historyDb.close()
    await Promise.all([watcher.stop(), tasksWatcher.stop(), sessionsRegistry.stop()])
  })

  return app
}

// Only listen when run directly, so tests can import buildServer without binding a port.
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer()
  await app.listen({ host: HOST, port: PORT })
  if (!isLoopbackHost(HOST)) {
    app.log.warn(`MC_HOST=${HOST} exposes the dashboard beyond localhost; the ?token= URL is the only key`)
  }
  // The token reaches the browser through this URL once, then lives in
  // localStorage. In dev the UI is on the Vite port — same query works there.
  app.log.info(`dashboard: http://${HOST}:${PORT}/?token=${app.authToken} ` +
    `(dev UI: http://${HOST}:4518/?token=${app.authToken})`)
}
