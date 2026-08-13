import type { FastifyInstance } from 'fastify'
import { TaskStore } from '../../tasks/store.js'
import type { ProjectRegistry } from '../registry.js'
import type { SessionStore } from '../watcher/session-store.js'
import type { Dispatcher } from '../dispatcher/index.js'
import type { DispatchQueue } from '../dispatcher/queue.js'
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
  queue: DispatchQueue,
  sessions: SessionStore,
  onTasksChanged: (projectId: string) => void,
): void {
  app.get('/api/runs', async () => ({ runs: dispatcher.list() }))

  app.get('/api/queue', async () => ({ queue: queue.list() }))

  app.delete<{ Params: { queueId: string } }>('/api/queue/:queueId', async (req, reply) => {
    if (!queue.cancel(req.params.queueId)) {
      return reply.code(404).send({ error: 'unknown queued dispatch' })
    }
    return { ok: true }
  })

  app.post<{ Params: { id: string; taskId: string } }>(
    '/api/projects/:id/tasks/:taskId/dispatch', async (req, reply) => {
      const project = registry.byId(req.params.id)
      if (!project) return reply.code(404).send({ error: 'unknown project' })

      const store = new TaskStore(project.path)
      const doc = await store.read()
      const task = doc.tasks.find(t => t.id === req.params.taskId)
      if (!task) return reply.code(404).send({ error: `unknown task ${req.params.taskId}` })

      try {
        const started = await queue.start({
          projectId: project.id,
          projectPath: project.path,
          taskId: task.id,
          prompt: buildTaskPrompt(task),
        })
        // Reflect the run on the board straight away rather than waiting for the
        // agent to get round to editing TASKS.md itself. A queued dispatch is
        // committed work too, so it flips the task the same way.
        if (task.status === 'todo') {
          await store.updateTask(task.id, { status: 'in-progress' })
          onTasksChanged(project.id)
        }
        return started
      } catch (err) {
        return reply.code(409).send({ error: (err as Error).message })
      }
    })

  // A run from a free prompt: no task behind it, otherwise a normal dispatch
  // (worktree-isolated when the project is a git repo).
  app.post<{ Params: { id: string }; Body: { text?: unknown } | null }>(
    '/api/projects/:id/prompt', async (req, reply) => {
      const project = registry.byId(req.params.id)
      if (!project) return reply.code(404).send({ error: 'unknown project' })
      const text = req.body?.text
      if (typeof text !== 'string' || text.trim() === '') {
        return reply.code(400).send({ error: 'text must be a non-empty string' })
      }
      try {
        return await queue.start({
          projectId: project.id, projectPath: project.path, taskId: null,
          prompt: text, kind: 'prompt',
        })
      } catch (err) {
        return reply.code(409).send({ error: (err as Error).message })
      }
    })

  // Continue an existing session headlessly via `--resume`. Refused while the
  // session is live somewhere: steering someone's open terminal session from
  // behind their back is wrong.
  app.post<{ Params: { sessionId: string }; Body: { text?: unknown } | null }>(
    '/api/sessions/:sessionId/resume', async (req, reply) => {
      const summary = sessions.get(req.params.sessionId)
      if (!summary) return reply.code(404).send({ error: 'unknown session' })
      const project = summary.projectId === null ? undefined : registry.byId(summary.projectId)
      if (!project) return reply.code(404).send({ error: 'the session does not belong to a registered project' })
      if (summary.live) {
        return reply.code(409).send({ error: 'the session is live in another terminal — talk to it there instead' })
      }
      const text = req.body?.text
      if (typeof text !== 'string' || text.trim() === '') {
        return reply.code(400).send({ error: 'text must be a non-empty string' })
      }
      try {
        return await queue.start({
          projectId: project.id, projectPath: project.path, taskId: null,
          prompt: text, kind: 'resume', resumeSessionId: summary.sessionId,
        })
      } catch (err) {
        return reply.code(409).send({ error: (err as Error).message })
      }
    })

  // Re-dispatch an ended run with the same input. Task runs re-read the task
  // for fresh text, exactly like the original dispatch; prompt and resume runs
  // replay their stored prompt. Goes through the queue, so a busy project
  // answers { queued } rather than 409.
  app.post<{ Params: { runId: string } }>('/api/runs/:runId/retry', async (req, reply) => {
    const run = dispatcher.get(req.params.runId)
    const input = dispatcher.originalInput(req.params.runId)
    if (!run || !input) return reply.code(404).send({ error: 'unknown run' })
    if (run.status !== 'failed' && run.status !== 'cancelled') {
      return reply.code(409).send({ error: 'only a failed or cancelled run can be retried' })
    }
    if (run.taskId !== null) {
      const project = registry.byId(run.projectId)
      if (!project) return reply.code(404).send({ error: 'unknown project' })
      const doc = await new TaskStore(project.path).read()
      const task = doc.tasks.find(t => t.id === run.taskId)
      if (!task) return reply.code(404).send({ error: `task ${run.taskId} no longer exists` })
      input.prompt = buildTaskPrompt(task)
    }
    try {
      return await queue.start(input)
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message })
    }
  })

  app.post<{ Params: { runId: string }; Body: { text?: unknown } | null }>(
    '/api/runs/:runId/input', async (req, reply) => {
      if (!dispatcher.get(req.params.runId)) return reply.code(404).send({ error: 'unknown run' })
      const text = req.body?.text
      if (typeof text !== 'string' || text.trim() === '') {
        return reply.code(400).send({ error: 'text must be a non-empty string' })
      }
      if (!dispatcher.steer(req.params.runId, text)) {
        return reply.code(409).send({ error: 'the run has already ended — it cannot take more input' })
      }
      return { ok: true }
    })

  app.post<{ Params: { runId: string } }>('/api/runs/:runId/finish', async (req, reply) => {
    if (!dispatcher.get(req.params.runId)) return reply.code(404).send({ error: 'unknown run' })
    if (!dispatcher.finishInput(req.params.runId)) {
      return reply.code(409).send({ error: 'the run has already ended — nothing to finish' })
    }
    return { ok: true }
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
      return reply.code(409).send({ error: 'the run is still going — an awaiting-input run must be finished (or cancelled) before merging' })
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
      return reply.code(409).send({ error: 'the run is still going — an awaiting-input run must be finished (or cancelled) before discarding' })
    }
    const project = registry.byId(run.projectId)
    if (!project) return reply.code(404).send({ error: 'unknown project' })

    await removeWorktree(project.path, run.worktreeDir, true)
    dispatcher.markResolved(run.runId, 'discarded')
    return { ok: true, branch: run.branch }
  })
}
