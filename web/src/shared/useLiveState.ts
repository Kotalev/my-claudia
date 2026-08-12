import { useEffect, useRef, useState } from 'react'
import type { ProjectRecord, RunHandle, SessionSummary, TasksDoc } from './types.js'

export interface LiveState {
  projects: ProjectRecord[]
  sessions: SessionSummary[]
  tasks: Record<string, TasksDoc>
  runs: RunHandle[]
  runOutput: Record<string, string>
  connected: boolean
}

/** A long run can emit megabytes; keep only the tail so a tab cannot grow without bound. */
const MAX_OUTPUT_CHARS = 200_000

export function useLiveState(): LiveState {
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [tasks, setTasks] = useState<Record<string, TasksDoc>>({})
  const [runs, setRuns] = useState<RunHandle[]>([])
  const [runOutput, setRunOutput] = useState<Record<string, string>>({})
  const [connected, setConnected] = useState(false)
  const lastSeq = useRef(0)
  const seeded = useRef(false)

  useEffect(() => {
    let socket: WebSocket | null = null
    let heartbeat: number | undefined
    let retry: number | undefined
    let closed = false

    const connect = () => {
      socket = new WebSocket(`ws://${location.host}/ws`)

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
          setProjects(msg.projects)
          setSessions(msg.sessions)
          setTasks(msg.tasks ?? {})
        } else if (msg.type === 'dispatch.updated') {
          setRuns(prev => [msg.run, ...prev.filter(r => r.runId !== msg.run.runId)])
        } else if (msg.type === 'dispatch.output') {
          setRunOutput(prev => {
            const next = (prev[msg.runId] ?? '') + msg.chunk
            return { ...prev, [msg.runId]: next.slice(-MAX_OUTPUT_CHARS) }
          })
        } else if (msg.type === 'task.updated') {
          setTasks(prev => ({ ...prev, [msg.projectId]: msg.doc }))
        } else if (msg.type === 'session.updated') {
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

  return { projects, sessions, tasks, runs, runOutput, connected }
}
