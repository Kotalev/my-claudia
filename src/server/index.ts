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
import { Scheduler } from './scheduler/index.js'
import { registerScheduleRoutes } from './routes/schedules.js'
import { registerTemplateRoutes } from './routes/templates.js'
import { buildTaskPrompt } from './dispatcher/prompt.js'
import { readAccountEmail } from './usage/account.js'
import { isCountable } from './watcher/usage.js'
import { projectsDir } from '../shared/config.js'
import type { AccountInfo, ProjectRecord, QueuedDispatch, RunHandle, ScheduleJob } from '../shared/types.js'

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

  const dispatcher = new Dispatcher()
  const dispatchQueue = new DispatchQueue(dispatcher)
  // Runs are in-memory only, so after a restart every directory under
  // .worktrees is an orphan from a previous process. Prune before any dispatch
  // can create a fresh one.
  await pruneStaleWorktrees(join(process.cwd(), '.worktrees'), new Set(dispatcher.list().map(r => r.runId)))

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
  const historyDb = await openHistoryDb(join(process.cwd(), 'mission-control.db'))
  const historyRecorder = new HistoryRecorder(historyDb)
  historyRecorder.attach(dispatcher)

  const scheduler = new Scheduler(historyDb)

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
    permissions: permissionBroker.list(),
    schedules: scheduler.list(),
    queue: dispatchQueue.list(),
  }))
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
  dispatcher.on('update', run => hub.broadcast({ type: 'dispatch.updated', run }))
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
  registerDispatchRoutes(app, registry, dispatcher, dispatchQueue, store, publishTasks)
  registerHistoryRoutes(app, historyDb)
  registerTemplateRoutes(app, historyDb)
  registerScheduleRoutes(app, registry, scheduler)
  scheduler.on('changed', (schedules: ScheduleJob[]) =>
    hub.broadcast({ type: 'schedule.updated', schedules }))

  // What a schedule does when its moment comes. A fired job is already gone
  // from the scheduler; a failed resume re-adds itself a few times, everything
  // else fails into the log — a missed schedule must never sink the server.
  const RESUME_RETRY_MS = 5 * 60_000
  const MAX_RESUME_ATTEMPTS = 6
  const resumeAttempts = new Map<string, number>()
  const executeSchedule = async (job: ScheduleJob): Promise<void> => {
    const project = registry.byId(job.projectId)
    if (!project) {
      app.log.warn(`schedule ${job.id} dropped: project ${job.projectId} is no longer registered`)
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
        return
      }
      try {
        await dispatcher.start({
          projectId: project.id, projectPath: project.path, taskId: task.id, prompt: buildTaskPrompt(task),
        })
        if (task.status === 'todo') {
          await taskStore.updateTask(task.id, { status: 'in-progress' })
          publishTasks(project.id)
        }
      } catch (err) {
        app.log.warn(`scheduled dispatch of ${job.taskId} failed: ${(err as Error).message}`)
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
    getFiveHour: () => store.planLimits()?.fiveHour ?? null,
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
