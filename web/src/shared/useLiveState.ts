import { useEffect, useRef, useState } from 'react'
import type { AccountInfo, PermissionRequestInfo, ProjectRecord, QueuedDispatch, RunHandle, ScheduleJob, SessionStatus, SessionSummary, SpendSummary, TasksDoc } from './types.js'
import type { PlanLimits } from '@server/live/statusline.js'
import { dismiss, fire, isEnabled, permission, reconcile, shouldNotify } from './notifications.js'
import { wsUrl } from './api.js'

export interface LiveState {
  projects: ProjectRecord[]
  sessions: SessionSummary[]
  tasks: Record<string, TasksDoc>
  planLimits: PlanLimits | null
  spend: SpendSummary | null
  account: AccountInfo | null
  runs: RunHandle[]
  runOutput: Record<string, string>
  permissions: PermissionRequestInfo[]
  schedules: ScheduleJob[]
  queue: QueuedDispatch[]
  connected: boolean
}

/** A long run can emit megabytes; keep only the tail so a tab cannot grow without bound. */
const MAX_OUTPUT_CHARS = 200_000

export interface LiveStateOptions {
  /** The session on screen right now, if any. It never notifies. */
  focusedSessionId: string | null
  onOpenSession: (sessionId: string) => void
}

export function useLiveState({ focusedSessionId, onOpenSession }: LiveStateOptions): LiveState {
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [tasks, setTasks] = useState<Record<string, TasksDoc>>({})
  const [planLimits, setPlanLimits] = useState<PlanLimits | null>(null)
  const [spend, setSpend] = useState<SpendSummary | null>(null)
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [runs, setRuns] = useState<RunHandle[]>([])
  const [runOutput, setRunOutput] = useState<Record<string, string>>({})
  const [permissions, setPermissions] = useState<PermissionRequestInfo[]>([])
  const [schedules, setSchedules] = useState<ScheduleJob[]>([])
  const [queue, setQueue] = useState<QueuedDispatch[]>([])
  const [connected, setConnected] = useState(false)
  const lastSeq = useRef(0)
  const seeded = useRef(false)
  /** Last status seen per session — the only way to tell a transition from a repeat. */
  const statuses = useRef(new Map<string, SessionStatus>())
  const notifiedAt = useRef(new Map<string, number>())
  // Read inside a socket handler that must not be re-created on every render, so
  // the current values arrive by ref rather than through the dependency array.
  const focusedRef = useRef(focusedSessionId)
  focusedRef.current = focusedSessionId
  const openRef = useRef(onOpenSession)
  openRef.current = onOpenSession

  useEffect(() => {
    let socket: WebSocket | null = null
    let heartbeat: number | undefined
    let retry: number | undefined
    let closed = false

    const connect = () => {
      socket = new WebSocket(wsUrl())

      socket.onopen = () => {
        setConnected(true)
        lastSeq.current = 0
        seeded.current = false
        // Laptop sleep is the main local failure mode; a heartbeat surfaces dead sockets.
        heartbeat = window.setInterval(() => socket?.send(JSON.stringify({ type: 'ping' })), 30_000)
      }

      socket.onmessage = ev => {
        const msg = JSON.parse(ev.data as string)

        // Snapshots and pongs are unicast: they carry the current sequence rather
        // than advancing it, so they are a baseline, never a gap.
        if (msg.type === 'snapshot' || msg.type === 'pong') {
          lastSeq.current = msg.seq
        } else {
          if (seeded.current && msg.seq !== lastSeq.current + 1) {
            socket?.send(JSON.stringify({ type: 'resnapshot' }))   // gap: refetch rather than patch
          }
          lastSeq.current = msg.seq
          seeded.current = true
        }
        if (msg.type === 'snapshot') {
          // Seed silently. A snapshot arrives on connect, on every reconnect after
          // a laptop wakes, and after a sequence gap — announcing what it contains
          // would notify about blocks the user has already seen, repeatedly.
          const snapshot = msg.sessions as SessionSummary[]
          for (const s of snapshot) statuses.current.set(s.sessionId, s.status)
          // Seeding silently is right for firing, but withdrawing must still
          // happen: the answer may have landed while this tab was disconnected.
          reconcile(snapshot.filter(s => s.status === 'waiting').map(s => s.sessionId))
          setProjects(msg.projects)
          setSessions(msg.sessions)
          setTasks(msg.tasks ?? {})
          setPlanLimits(msg.planLimits ?? null)
          setSpend(msg.spend ?? null)
          setAccount(msg.account ?? null)
          setPermissions(msg.permissions ?? [])
          setSchedules(msg.schedules ?? [])
          setQueue(msg.queue ?? [])
        } else if (msg.type === 'schedule.updated') {
          setSchedules(msg.schedules ?? [])
        } else if (msg.type === 'queue.updated') {
          setQueue(msg.queue ?? [])
        } else if (msg.type === 'dispatch.updated') {
          setRuns(prev => [msg.run, ...prev.filter(r => r.runId !== msg.run.runId)])
        } else if (msg.type === 'dispatch.output') {
          setRunOutput(prev => {
            const next = (prev[msg.runId] ?? '') + msg.chunk
            return { ...prev, [msg.runId]: next.slice(-MAX_OUTPUT_CHARS) }
          })
        } else if (msg.type === 'projects.updated') {
          setProjects(msg.projects)
        } else if (msg.type === 'plan.updated') {
          setPlanLimits(msg.planLimits ?? null)
        } else if (msg.type === 'spend.updated') {
          setSpend(msg.spend ?? null)
        } else if (msg.type === 'task.updated') {
          setTasks(prev => ({ ...prev, [msg.projectId]: msg.doc }))
        } else if (msg.type === 'permission.requested') {
          const request = msg.request as PermissionRequestInfo
          setPermissions(prev => [request, ...prev.filter(p => p.id !== request.id)])
        } else if (msg.type === 'permission.resolved') {
          setPermissions(prev => prev.filter(p => p.id !== msg.id))
        } else if (msg.type === 'session.updated') {
          // Decided out here, never inside the setSessions updater: StrictMode
          // invokes updaters twice, which would fire two notifications.
          const session = msg.session as SessionSummary
          const id = session.sessionId
          const prevStatus = statuses.current.get(id)
          const focused = focusedRef.current === id && !document.hidden && document.hasFocus()
          const now = Date.now()
          if (shouldNotify({
            prev: prevStatus,
            next: session.status,
            kind: session.live?.kind ?? null,
            statusUpdatedAt: session.live?.statusUpdatedAt ?? null,
            enabled: isEnabled(),
            permission: permission(),
            lastNotifiedAt: notifiedAt.current.get(id),
            now,
            focused,
          })) {
            fire(session, sid => openRef.current(sid))
            notifiedAt.current.set(id, now)
          }
          // Answered, or the process is gone: withdraw the notification rather
          // than leave the tray insisting it still needs you.
          if (prevStatus === 'waiting' && session.status !== 'waiting') dismiss(id)
          statuses.current.set(id, session.status)
          setSessions(prev => {
            const rest = prev.filter(s => s.sessionId !== msg.session.sessionId)
            return [msg.session, ...rest].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
          })
        }
      }

      socket.onclose = () => {
        setConnected(false)
        window.clearInterval(heartbeat)
        if (!closed) retry = window.setTimeout(connect, 1500)
      }
    }

    connect()
    return () => {
      closed = true
      window.clearInterval(heartbeat)
      window.clearTimeout(retry)
      if (!socket) return
      // Closing a socket that is still handshaking logs a console warning, which
      // StrictMode's double-mount would produce on every dev reload.
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener('open', () => socket?.close())
      } else {
        socket.close()
      }
    }
  }, [])

  return { projects, sessions, tasks, planLimits, spend, account, runs, runOutput, permissions, schedules, queue, connected }
}
