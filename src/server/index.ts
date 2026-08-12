import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { HOST, PORT } from '../shared/config.js'
import { ProjectRegistry } from './registry.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerTaskRoutes } from './routes/tasks.js'
import { TaskStore } from '../tasks/store.js'
import { SessionStore } from './watcher/session-store.js'
import { SessionWatcher } from './watcher/index.js'
import { TasksWatcher, type TasksChange } from './watcher/tasks-watcher.js'
import { EventHub } from './ws/hub.js'
import { isAllowedHost, isAllowedOrigin } from './origin-guard.js'
import { Dispatcher } from './dispatcher/index.js'
import { registerDispatchRoutes } from './routes/dispatch.js'
import { registerHookRoutes } from './routes/hooks.js'
import { registerStatuslineRoutes } from './routes/statusline.js'
import { registerHookInstallRoutes } from './routes/hook-install.js'
import { SessionsRegistry } from './live/sessions-registry.js'
import { AgentsPoller, mergeLive } from './live/agents-poller.js'

/** Absolute path to the forwarder, resolved once — a project's settings must not hold a relative path. */
const HOOK_SCRIPT_PATH = fileURLToPath(new URL('../../scripts/hook-post.sh', import.meta.url))
const STATUSLINE_SCRIPT_PATH = fileURLToPath(new URL('../../scripts/statusline.sh', import.meta.url))

declare module 'fastify' {
  interface FastifyInstance {
    registry: ProjectRegistry
    store: SessionStore
    watcher: SessionWatcher
    tasksWatcher: TasksWatcher
    dispatcher: Dispatcher
    sessionsRegistry: SessionsRegistry
    hub: EventHub
  }
}

export async function buildServer(
  storePath = join(process.cwd(), 'projects.json'),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' } })

  const registry = new ProjectRegistry(storePath)
  await registry.load()
  const store = new SessionStore()
  const watcher = new SessionWatcher(registry, store)
  await watcher.start()

  const dispatcher = new Dispatcher()

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

  const hub = new EventHub(() => ({
    projects: registry.list(),
    sessions: store.all(),
    tasks: cachedDocs,
    planLimits: store.planLimits(),
  }))
  watcher.on('session', session => hub.broadcast({ type: 'session.updated', session }))

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
  })

  app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }))
  registerProjectRoutes(app, registry, async () => {
    await tasksWatcher.restart()
    cachedDocs = await taskDocs()
  })
  registerSessionRoutes(app, store, registry)
  const publishTasks = (projectId: string): void => {
    const project = registry.byId(projectId)
    if (!project) return
    void new TaskStore(project.path).read().then(doc => {
      cachedDocs = { ...cachedDocs, [projectId]: doc }
      hub.broadcast({ type: 'task.updated', projectId, doc })
    })
  }

  registerTaskRoutes(app, registry, publishTasks)
  registerDispatchRoutes(app, registry, dispatcher, publishTasks)
  registerHookRoutes(app, store, registry, session =>
    hub.broadcast({ type: 'session.updated', session }))
  registerStatuslineRoutes(
    app,
    store,
    session => hub.broadcast({ type: 'session.updated', session }),
    () => hub.broadcast({ type: 'plan.updated', planLimits: store.planLimits() }),
  )
  registerHookInstallRoutes(app, registry, HOOK_SCRIPT_PATH, STATUSLINE_SCRIPT_PATH)

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

  // In production the API also serves the built UI, so `npm start` is the whole
  // dashboard on one port. In dev the Vite server owns the UI and proxies here.
  const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url))
  if (existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'not found' })
      }
      return reply.sendFile('index.html')
    })
  }

  app.decorate('registry', registry)
  app.decorate('store', store)
  app.decorate('watcher', watcher)
  app.decorate('tasksWatcher', tasksWatcher)
  app.decorate('dispatcher', dispatcher)
  app.decorate('sessionsRegistry', sessionsRegistry)
  app.decorate('hub', hub)
  app.addHook('onClose', async () => {
    clearInterval(sweep)
    agentsPoller.stop()
    await Promise.all([watcher.stop(), tasksWatcher.stop(), sessionsRegistry.stop()])
  })

  return app
}

// Only listen when run directly, so tests can import buildServer without binding a port.
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer()
  await app.listen({ host: HOST, port: PORT })
}
