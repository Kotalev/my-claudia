import type { FastifyInstance } from 'fastify'
import { TaskStore } from '../../tasks/store.js'
import type { ProjectRegistry } from '../registry.js'
import type { Dispatcher } from '../dispatcher/index.js'
import { buildTaskPrompt } from '../dispatcher/prompt.js'
import { collectDiff, git, removeWorktree } from '../dispatcher/worktree.js'
import type { RunHandle } from '../../shared/types.js'

/** First few lines of git's complaint — enough for a 409 reason, not a wall of text. */
function gitReason(stdout: string, stderr: string): string {
  const text = `${stderr.trim()}\n${stdout.trim()}`.trim()
  return text.split('\n').slice(0, 4).join('\n') || 'git failed'
}

/** The run's worktree still exists, so a diff can be read and a merge attempted. */
function worktreeLive(run: RunHandle): run is RunHandle & { branch: string; worktreeDir: string } {
  return run.isolation === 'worktree' && run.diffAvailable === true
    && typeof run.branch === 'string' && typeof run.worktreeDir === 'string'
}

export function registerDispatchRoutes(
  app: FastifyInstance,
  registry: ProjectRegistry,
  dispatcher: Dispatcher,
  onTasksChanged: (projectId: string) => void,
): void {
  app.get('/api/runs', async () => ({ runs: dispatcher.list() }))

  app.post<{ Params: { id: string; taskId: string } }>(
    '/api/projects/:id/tasks/:taskId/dispatch', async (req, reply) => {
      const project = registry.byId(req.params.id)
      if (!project) return reply.code(404).send({ error: 'unknown project' })

      const store = new TaskStore(project.path)
      const doc = await store.read()
      const task = doc.tasks.find(t => t.id === req.params.taskId)
      if (!task) return reply.code(404).send({ error: `unknown task ${req.params.taskId}` })

      try {
        const run = await dispatcher.start({
          projectId: project.id,
          projectPath: project.path,
          taskId: task.id,
          prompt: buildTaskPrompt(task),
        })
        // Reflect the run on the board straight away rather than waiting for the
        // agent to get round to editing TASKS.md itself.
        if (task.status === 'todo') {
          await store.updateTask(task.id, { status: 'in-progress' })
          onTasksChanged(project.id)
        }
        return { run }
      } catch (err) {
        return reply.code(409).send({ error: (err as Error).message })
      }
    })

  app.post<{ Params: { runId: string } }>('/api/runs/:runId/cancel', async (req, reply) => {
    if (!dispatcher.cancel(req.params.runId)) {
      return reply.code(404).send({ error: 'no live run with that id' })
    }
    return { ok: true }
  })

  app.get<{ Params: { runId: string } }>('/api/runs/:runId/diff', async (req, reply) => {
    const run = dispatcher.get(req.params.runId)
    if (!run) return reply.code(404).send({ error: 'unknown run' })
    if (!worktreeLive(run)) {
      return reply.code(409).send({ error: 'no diff for this run — not worktree-isolated, or already merged/discarded' })
    }
    const { files, patch } = await collectDiff(run.worktreeDir, run.baseCommit ?? null)
    return { branch: run.branch, files, patch }
  })

  app.post<{ Params: { runId: string } }>('/api/runs/:runId/merge', async (req, reply) => {
    const run = dispatcher.get(req.params.runId)
    if (!run) return reply.code(404).send({ error: 'unknown run' })
    if (!worktreeLive(run)) {
      return reply.code(409).send({ error: 'nothing to merge — not worktree-isolated, or already merged/discarded' })
    }
    if (run.endedAt === null) {
      return reply.code(409).send({ error: 'the run is still going — wait for it to finish or cancel it' })
    }
    const project = registry.byId(run.projectId)
    if (!project) return reply.code(404).send({ error: 'unknown project' })

    // The ONLY git commands ever aimed at the user's own checkout: a status
    // check, the guarded merge, and — on conflict — its abort.
    const status = await git(['-C', project.path, 'status', '--porcelain'])
    if (status.code !== 0) {
      return reply.code(409).send({ error: `could not check the project tree: ${gitReason(status.stdout, status.stderr)}` })
    }
    if (status.stdout.trim() !== '') {
      return reply.code(409).send({ error: 'the project checkout has uncommitted changes — commit or stash them before merging' })
    }

    const merge = await git(['-C', project.path, 'merge', '--no-ff', run.branch])
    if (merge.code !== 0) {
      await git(['-C', project.path, 'merge', '--abort'])
      return reply.code(409).send({ error: `merge failed and was aborted: ${gitReason(merge.stdout, merge.stderr)}` })
    }

    // The merge landed, so a dirty worktree may be force-removed. The branch is
    // kept — branches are never deleted.
    await removeWorktree(project.path, run.worktreeDir, true)
    dispatcher.markResolved(run.runId, 'merged')
    return { ok: true, branch: run.branch }
  })

  app.post<{ Params: { runId: string } }>('/api/runs/:runId/discard', async (req, reply) => {
    const run = dispatcher.get(req.params.runId)
    if (!run) return reply.code(404).send({ error: 'unknown run' })
    if (!worktreeLive(run)) {
      return reply.code(409).send({ error: 'nothing to discard — not worktree-isolated, or already merged/discarded' })
    }
    if (run.endedAt === null) {
      return reply.code(409).send({ error: 'the run is still going — cancel it first' })
    }
    const project = registry.byId(run.projectId)
    if (!project) return reply.code(404).send({ error: 'unknown project' })

    await removeWorktree(project.path, run.worktreeDir, true)
    dispatcher.markResolved(run.runId, 'discarded')
    return { ok: true, branch: run.branch }
  })
}
