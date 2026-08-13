import type { FastifyInstance } from 'fastify'
import { installHooks, isInstalled } from '../hooks/installer.js'
import type { ProjectRegistry } from '../registry.js'

export function registerHookInstallRoutes(
  app: FastifyInstance,
  registry: ProjectRegistry,
  scriptPath: string,
  statuslineScript: string,
  permissionScript: string,
): void {
  app.get<{ Params: { id: string } }>('/api/projects/:id/hooks', async (req, reply) => {
    const project = registry.byId(req.params.id)
    if (!project) return reply.code(404).send({ error: 'unknown project' })
    return { installed: await isInstalled(project.path, scriptPath, permissionScript), scriptPath }
  })

  app.post<{ Params: { id: string } }>('/api/projects/:id/hooks/install', async (req, reply) => {
    const project = registry.byId(req.params.id)
    if (!project) return reply.code(404).send({ error: 'unknown project' })
    try {
      return { result: await installHooks(project.path, scriptPath, statuslineScript, permissionScript) }
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message })
    }
  })
}
