import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import { join } from 'node:path'
import { HOST, PORT } from '../shared/config.js'
import { ProjectRegistry } from './registry.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerTaskRoutes } from './routes/tasks.js'
import { TaskStore } from '../tasks/store.js'
import { SessionStore } from './watcher/session-store.js'
import { SessionWatcher } from './watcher/index.js'
import { EventHub } from './ws/hub.js'

declare module 'fastify' {
  interface FastifyInstance {
    registry: ProjectRegistry
    store: SessionStore
    watcher: SessionWatcher
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

  const hub = new EventHub(() => ({
    projects: registry.list(),
    sessions: store.all(),
    tasks: {},
  }))
  watcher.on('session', session => hub.broadcast({ type: 'session.updated', session }))

  await app.register(websocket)

  app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }))
  registerProjectRoutes(app, registry)
  registerSessionRoutes(app, store, registry)
  registerTaskRoutes(app, registry, projectId => {
    const project = registry.byId(projectId)
    if (!project) return
    void new TaskStore(project.path).read()
      .then(doc => hub.broadcast({ type: 'task.updated', projectId, doc }))
  })

  app.get('/ws', { websocket: true }, socket => {
    const send = (payload: string) => socket.send(payload)
    const disconnect = hub.addClient(send)
    socket.on('message', (raw: Buffer) => hub.handleClientMessage(raw.toString(), send))
    socket.on('close', disconnect)
    socket.on('error', disconnect)
  })

  app.decorate('registry', registry)
  app.decorate('store', store)
  app.decorate('watcher', watcher)
  app.decorate('hub', hub)
  app.addHook('onClose', () => watcher.stop())

  return app
}

// Only listen when run directly, so tests can import buildServer without binding a port.
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer()
  await app.listen({ host: HOST, port: PORT })
}
