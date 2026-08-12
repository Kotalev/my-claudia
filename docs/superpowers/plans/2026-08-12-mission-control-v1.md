# Claude Mission Control v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web dashboard at `http://127.0.0.1:4517` showing all Claude Code sessions across registered projects live, with a per-project `TASKS.md`-backed task board, headless dispatch of tasks to `claude -p`, and Claude Code hooks as the deterministic status channel.

**Architecture:** Single Node process. Fastify serves the HTTP API, a WebSocket channel, and (in production) the built React frontend. A chokidar watcher tails `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/**/*.jsonl` incrementally by byte offset and feeds a defensive parser whose output lands in an in-memory `SessionStore`. Hook events POSTed to `/api/hooks` write into the same store at higher priority. A `TaskStore` reads and writes `TASKS.md` per registered project. A dispatcher spawns `claude -p` runs and streams their output to the UI.

**Tech Stack:** Node 20.19 / npm 11, TypeScript strict, Fastify 5 + `@fastify/websocket` + `@fastify/static`, chokidar 4, Vitest, React 19 + Vite 6 + Tailwind 4 + Zustand, ESLint 9.

## Global Constraints

- Node 20+; TypeScript `strict: true`, ESM (`"type": "module"`), `moduleResolution: "bundler"`.
- Server binds `127.0.0.1:4517` only — never `0.0.0.0`, never another host. No auth in v1 *because* of this.
- Claude data dir resolves as `${CLAUDE_CONFIG_DIR:-~/.claude}` — never hardcode `~/.claude`.
- Never write anything under the Claude data dir. Sole exception: the opt-in hook installer editing a *target project's* `.claude/settings.json`, always after writing a backup.
- All transcript-format assumptions live in `src/transcript/` and nowhere else. The parser must skip unknown line shapes without throwing.
- Hook helper scripts: `--max-time 1`, always `exit 0`, silent on failure.
- Dispatcher passes task text as a single argv element — never a shell-interpolated string.
- Every parser gets Vitest coverage including malformed input before it counts as done. `TASKS.md` writer must round-trip (parse → serialize → parse yields identical structure).
- Commits: conventional-commit type + domain scope, imperative, lowercase (`feat(watcher): tail transcripts by byte offset`). Never commit without the task saying so. Never use destructive git commands.
- Progress discipline: on starting a task move it to **In progress** / `[~]` in `TASKS.md`; on finishing move it to **Done** / `[x]` with the date; append a `- YYYY-MM-DD HH:MM T-NNN — what happened` line to **Progress log** (newest first, under ~120 chars) at each milestone.

## File Structure

| Path | Responsibility |
|---|---|
| `src/shared/config.ts` | Claude dir resolution, project-path escaping, port constant |
| `src/shared/types.ts` | Cross-cutting types (`SessionSummary`, `ProjectRecord`, WS event shapes) |
| `src/transcript/types.ts` | Transcript line types — the format contract |
| `src/transcript/parse.ts` | Defensive line parser; the ONLY module with format assumptions |
| `src/server/index.ts` | Fastify bootstrap, route registration, static serving |
| `src/server/registry.ts` | `projects.json` read/write, escaped-dir matching |
| `src/server/routes/*.ts` | HTTP route modules (projects, sessions, tasks, dispatch, hooks) |
| `src/server/ws/hub.ts` | WebSocket hub: snapshot on connect, sequenced deltas, heartbeat |
| `src/server/watcher/tail.ts` | Per-file byte-offset tailing with partial-line buffering |
| `src/server/watcher/session-store.ts` | In-memory session index + summary derivation |
| `src/server/watcher/index.ts` | chokidar wiring; ties tail → parse → store → hub |
| `src/server/dispatcher/index.ts` | Spawns and supervises `claude -p` runs |
| `src/server/hooks/installer.ts` | Merges hooks into a target project's `.claude/settings.json` |
| `src/tasks/types.ts` | `TasksDoc`, `Task`, `ProgressEntry` |
| `src/tasks/parse.ts` | `TASKS.md` → `TasksDoc` |
| `src/tasks/serialize.ts` | `TasksDoc` → `TASKS.md` |
| `src/tasks/store.ts` | Per-project file read/write/watch, line-based edits |
| `web/src/` | React app: `overview/`, `project/`, `session/`, `shared/` |
| `scripts/hook-post.sh` | Fail-silent hook forwarder |
| `test/fixtures/` | Real anonymized transcript samples + malformed lines |

---

## Task 1 (T-001): Scaffold the repo

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.gitignore`, `src/shared/config.ts`, `src/server/index.ts`, `web/index.html`, `web/vite.config.ts`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/index.css`
- Test: `src/shared/__tests__/config.test.ts`

**Interfaces:**
- Produces: `resolveClaudeDir(): string`, `escapeProjectPath(p: string): string`, `PORT = 4517`, `HOST = '127.0.0.1'` from `src/shared/config.ts`; `buildServer(): Promise<FastifyInstance>` from `src/server/index.ts`.

- [ ] **Step 1: Initialize package.json and install dependencies**

```bash
cd /Users/ivanhristev/Projects/my-claudia
npm init -y
npm pkg set type=module name=claude-mission-control version=0.1.0 private=true
npm i fastify @fastify/websocket @fastify/static chokidar
npm i -D typescript @types/node vitest tsx eslint @eslint/js typescript-eslint \
  vite @vitejs/plugin-react react react-dom @types/react @types/react-dom \
  tailwindcss @tailwindcss/vite zustand npm-run-all
npm pkg set scripts.dev="run-p dev:server dev:web"
npm pkg set scripts.dev:server="tsx watch src/server/index.ts"
npm pkg set scripts.dev:web="vite --config web/vite.config.ts"
npm pkg set scripts.build="tsc -p tsconfig.json --noEmit && vite build --config web/vite.config.ts"
npm pkg set scripts.start="tsx src/server/index.ts"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.lint="eslint . && tsc --noEmit"
```

- [ ] **Step 2: Write tsconfig.json, eslint.config.js, vitest.config.ts, .gitignore**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022", "DOM"], "module": "ESNext",
    "moduleResolution": "bundler", "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "esModuleInterop": true, "skipLibCheck": true,
    "resolveJsonModule": true, "jsx": "react-jsx",
    "types": ["node", "vitest/globals"],
    "baseUrl": ".", "paths": { "@shared/*": ["src/shared/*"], "@transcript/*": ["src/transcript/*"], "@tasks/*": ["src/tasks/*"] }
  },
  "include": ["src", "web/src", "test"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: { globals: true, environment: 'node', include: ['src/**/__tests__/**/*.test.ts'] },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@transcript': fileURLToPath(new URL('./src/transcript', import.meta.url)),
      '@tasks': fileURLToPath(new URL('./src/tasks', import.meta.url)),
    },
  },
})
```

`eslint.config.js`:
```js
import js from '@eslint/js'
import ts from 'typescript-eslint'

export default ts.config(
  { ignores: ['dist', 'web/dist', 'node_modules'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { rules: { 'no-console': 'off', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
)
```

`.gitignore`:
```
node_modules/
dist/
web/dist/
.tmp/
projects.json
*.log
```

- [ ] **Step 3: Write the failing test for config**

`src/shared/__tests__/config.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveClaudeDir, escapeProjectPath, PORT, HOST } from '../config.js'

describe('resolveClaudeDir', () => {
  afterEach(() => { delete process.env.CLAUDE_CONFIG_DIR })

  it('defaults to ~/.claude', () => {
    expect(resolveClaudeDir()).toBe(join(homedir(), '.claude'))
  })

  it('honours CLAUDE_CONFIG_DIR', () => {
    process.env.CLAUDE_CONFIG_DIR = '/custom/claude'
    expect(resolveClaudeDir()).toBe('/custom/claude')
  })
})

describe('escapeProjectPath', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    expect(escapeProjectPath('/Users/ivan/Projects/my-claudia'))
      .toBe('-Users-ivan-Projects-my-claudia')
  })

  it('replaces dots and underscores too', () => {
    expect(escapeProjectPath('/a/b_c.d')).toBe('-a-b-c-d')
  })
})

it('binds loopback only', () => {
  expect(HOST).toBe('127.0.0.1')
  expect(PORT).toBe(4517)
})
```

- [ ] **Step 4: Run the test and verify it fails**

Run: `npx vitest run src/shared/__tests__/config.test.ts`
Expected: FAIL — cannot resolve `../config.js`.

- [ ] **Step 5: Implement src/shared/config.ts**

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'

export const HOST = '127.0.0.1'
export const PORT = 4517

/** Claude Code's data directory. Never hardcode ~/.claude — CLAUDE_CONFIG_DIR may relocate it. */
export function resolveClaudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
}

/** Claude Code names transcript dirs by replacing every non-alphanumeric char with '-'. Lossy: not reversible. */
export function escapeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-')
}

export function projectsDir(): string {
  return join(resolveClaudeDir(), 'projects')
}
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `npx vitest run src/shared/__tests__/config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Write the minimal Fastify server**

`src/server/index.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify'
import { HOST, PORT } from '../shared/config.js'

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' } })
  app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }))
  return app
}

// Only listen when run directly, so tests can import buildServer without binding a port.
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer()
  await app.listen({ host: HOST, port: PORT })
}
```

- [ ] **Step 8: Write the minimal frontend**

`web/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwind()],
  server: {
    host: '127.0.0.1',
    port: 4518,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4517', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:4517', ws: true },
    },
  },
  build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true },
})
```

`web/index.html`:
```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mission Control</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/index.css`:
```css
@import "tailwindcss";
```

`web/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App.js'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
```

`web/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react'

export function App() {
  const [health, setHealth] = useState<string>('checking…')
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(d => setHealth(d.ok ? `API up (v${d.version})` : 'API error'))
      .catch(() => setHealth('API unreachable'))
  }, [])

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <h1 className="text-2xl font-semibold">Mission Control</h1>
      <p className="mt-2 text-neutral-400" data-testid="health">{health}</p>
    </main>
  )
}
```

- [ ] **Step 9: Verify the dev server runs and the page loads**

Run `npm run dev`, then with Chrome DevTools MCP navigate to `http://127.0.0.1:4518`, take a snapshot, and confirm the page shows "API up (v0.1.0)". Save a screenshot to `.tmp/t001-scaffold.png`. Then run `npm run lint` — expected: clean.

- [ ] **Step 10: Update TASKS.md and commit**

Move T-001 to Done with today's date, add a Progress log line, then:
```bash
git add -A
git commit -m "feat(scaffold): typescript, fastify, vite react tailwind, vitest"
```

---

## Task 2 (T-002): Project registry

**Files:**
- Create: `src/server/registry.ts`, `src/shared/types.ts`, `src/server/routes/projects.ts`, `src/server/__tests__/registry.test.ts`
- Modify: `src/server/index.ts`

**Interfaces:**
- Consumes: `escapeProjectPath`, `projectsDir` from `@shared/config`.
- Produces:
  ```ts
  interface ProjectRecord { id: string; path: string; name: string; escapedDir: string; addedAt: string }
  class ProjectRegistry {
    constructor(storePath: string)
    load(): Promise<void>
    list(): ProjectRecord[]
    add(projectPath: string): Promise<ProjectRecord>   // throws if path missing or already registered
    byId(id: string): ProjectRecord | undefined
    byEscapedDir(dir: string): ProjectRecord | undefined
  }
  ```

- [ ] **Step 1: Write the failing test**

`src/server/__tests__/registry.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectRegistry } from '../registry.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mc-reg-')) })

describe('ProjectRegistry', () => {
  it('starts empty when the store file does not exist', async () => {
    const reg = new ProjectRegistry(join(dir, 'projects.json'))
    await reg.load()
    expect(reg.list()).toEqual([])
  })

  it('adds a project and derives id, name and escaped dir', async () => {
    const reg = new ProjectRegistry(join(dir, 'projects.json'))
    await reg.load()
    const rec = await reg.add(dir)
    expect(rec.path).toBe(dir)
    expect(rec.escapedDir).toBe(dir.replace(/[^a-zA-Z0-9]/g, '-'))
    expect(rec.name).toBe(dir.split('/').pop())
    expect(reg.byId(rec.id)).toEqual(rec)
    expect(reg.byEscapedDir(rec.escapedDir)).toEqual(rec)
  })

  it('persists across instances', async () => {
    const store = join(dir, 'projects.json')
    const a = new ProjectRegistry(store); await a.load(); await a.add(dir)
    const b = new ProjectRegistry(store); await b.load()
    expect(b.list()).toHaveLength(1)
  })

  it('rejects a path that does not exist', async () => {
    const reg = new ProjectRegistry(join(dir, 'projects.json')); await reg.load()
    await expect(reg.add('/nope/does/not/exist')).rejects.toThrow(/not a directory/i)
  })

  it('rejects a duplicate path', async () => {
    const reg = new ProjectRegistry(join(dir, 'projects.json')); await reg.load()
    await reg.add(dir)
    await expect(reg.add(dir)).rejects.toThrow(/already registered/i)
  })

  it('survives a corrupt store file by starting empty', async () => {
    const store = join(dir, 'projects.json')
    await writeFile(store, '{ not json')
    const reg = new ProjectRegistry(store)
    await reg.load()
    expect(reg.list()).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/server/__tests__/registry.test.ts`
Expected: FAIL — cannot resolve `../registry.js`.

- [ ] **Step 3: Implement src/shared/types.ts**

```ts
export interface ProjectRecord {
  id: string
  path: string
  name: string
  escapedDir: string
  addedAt: string
}
```

- [ ] **Step 4: Implement src/server/registry.ts**

```ts
import { readFile, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { escapeProjectPath } from '../shared/config.js'
import type { ProjectRecord } from '../shared/types.js'

export class ProjectRegistry {
  #records: ProjectRecord[] = []

  constructor(private readonly storePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.storePath, 'utf8')
      const parsed = JSON.parse(raw)
      this.#records = Array.isArray(parsed?.projects) ? parsed.projects : []
    } catch {
      // Missing or corrupt store: start empty rather than block startup.
      this.#records = []
    }
  }

  list(): ProjectRecord[] { return [...this.#records] }
  byId(id: string): ProjectRecord | undefined { return this.#records.find(r => r.id === id) }
  byEscapedDir(dir: string): ProjectRecord | undefined { return this.#records.find(r => r.escapedDir === dir) }

  async add(projectPath: string): Promise<ProjectRecord> {
    const path = resolve(projectPath)
    const info = await stat(path).catch(() => null)
    if (!info?.isDirectory()) throw new Error(`${path} is not a directory`)
    if (this.#records.some(r => r.path === path)) throw new Error(`${path} is already registered`)

    const record: ProjectRecord = {
      id: createHash('sha1').update(path).digest('hex').slice(0, 12),
      path,
      name: basename(path),
      escapedDir: escapeProjectPath(path),
      addedAt: new Date().toISOString(),
    }
    this.#records.push(record)
    await this.#persist()
    return record
  }

  async #persist(): Promise<void> {
    await writeFile(this.storePath, JSON.stringify({ projects: this.#records }, null, 2) + '\n', 'utf8')
  }
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npx vitest run src/server/__tests__/registry.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Wire the routes**

`src/server/routes/projects.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import type { ProjectRegistry } from '../registry.js'

export function registerProjectRoutes(app: FastifyInstance, registry: ProjectRegistry): void {
  app.get('/api/projects', async () => ({ projects: registry.list() }))

  app.post<{ Body: { path?: string } }>('/api/projects', async (req, reply) => {
    const path = req.body?.path
    if (typeof path !== 'string' || path.length === 0) {
      return reply.code(400).send({ error: 'path is required' })
    }
    try {
      return { project: await registry.add(path) }
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })
}
```

In `src/server/index.ts`, replace `buildServer` with:
```ts
import Fastify, { type FastifyInstance } from 'fastify'
import { join } from 'node:path'
import { HOST, PORT } from '../shared/config.js'
import { ProjectRegistry } from './registry.js'
import { registerProjectRoutes } from './routes/projects.js'

export async function buildServer(storePath = join(process.cwd(), 'projects.json')): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' } })
  const registry = new ProjectRegistry(storePath)
  await registry.load()

  app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }))
  registerProjectRoutes(app, registry)
  app.decorate('registry', registry)
  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer()
  await app.listen({ host: HOST, port: PORT })
}
```

Add the decoration type in `src/server/index.ts` (top of file, after imports):
```ts
declare module 'fastify' {
  interface FastifyInstance { registry: ProjectRegistry }
}
```

- [ ] **Step 7: Verify the endpoints by hand**

```bash
npm run dev:server &
curl -s -X POST http://127.0.0.1:4517/api/projects \
  -H 'content-type: application/json' \
  -d '{"path":"/Users/ivanhristev/Projects/my-claudia"}' | jq
curl -s http://127.0.0.1:4517/api/projects | jq
```
Expected: the POST returns a project with `escapedDir: "-Users-ivanhristev-Projects-my-claudia"`; the GET lists it. Kill the server afterwards.

- [ ] **Step 8: Update TASKS.md and commit**

```bash
git add -A
git commit -m "feat(registry): project registry with escaped-dir matching and api routes"
```

---

## Task 3 (T-003): Defensive transcript parser

The format contract below was verified on 2026-08-12 against a real transcript: 14 distinct line `type` values (`user`, `assistant`, `system`, `attachment`, `summary`, `file-history-snapshot`, `file-history-delta`, `queue-operation`, `mode`, `permission-mode`, `agent-name`, `ai-title`, `custom-title`, `last-prompt`, `bridge-session`). Assistant content blocks seen: `text`, `thinking`, `tool_use`. User content is either a bare string or blocks of `text` / `tool_result`.

**Files:**
- Create: `src/transcript/types.ts`, `src/transcript/parse.ts`, `src/transcript/__tests__/parse.test.ts`, `test/fixtures/transcript-sample.jsonl`, `test/fixtures/transcript-malformed.jsonl`
- Test: `src/transcript/__tests__/parse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Role = 'user' | 'assistant' | 'system'
  interface ToolCall { id: string; name: string; filePath: string | null }
  interface TranscriptEntry {
    uuid: string; parentUuid: string | null; sessionId: string
    timestamp: string; role: Role; isSidechain: boolean
    cwd: string | null; gitBranch: string | null; version: string | null
    text: string | null            // visible text only; thinking blocks excluded
    toolCalls: ToolCall[]
    isMeta: boolean
  }
  interface ParseStats { parsed: number; skippedUnknown: number; skippedInvalid: number; versions: string[] }
  function parseLine(raw: string): TranscriptEntry | null
  function parseLines(raws: string[]): { entries: TranscriptEntry[]; stats: ParseStats }
  ```

- [ ] **Step 1: Build the fixtures from a real transcript**

```bash
mkdir -p test/fixtures
SRC=~/.claude/projects/-Users-ivanhristev-Projects-my-claudia
F=$(ls -t $SRC/*.jsonl | head -1)
head -c 400000 "$F" | head -120 > test/fixtures/transcript-sample.jsonl
```

Then anonymize: replace the real home path with `/Users/dev` throughout the fixture.
```bash
sed -i '' 's#/Users/ivanhristev#/Users/dev#g' test/fixtures/transcript-sample.jsonl
```

Write `test/fixtures/transcript-malformed.jsonl` by hand:
```
{ this is not json at all
{"type":"assistant"}
{"type":"totally-unknown-future-type","uuid":"x1","timestamp":"2026-08-12T10:00:00Z"}
{"type":"user","uuid":"u1","sessionId":"s1","timestamp":"2026-08-12T10:00:01Z","message":{"role":"user","content":"hello"}}

{"type":"assistant","uuid":"a1","sessionId":"s1","timestamp":"2026-08-12T10:00:02Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"secret"},{"type":"text","text":"hi"},{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/Users/dev/x.ts"}}]}}
{"type":"user","uuid":"u2","sessionId":"s1","timestamp":"2026-08-12T10:00:03Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}
```

- [ ] **Step 2: Write the failing test**

`src/transcript/__tests__/parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseLine, parseLines } from '../parse.js'

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../test/fixtures/${name}`, import.meta.url)), 'utf8')
    .split('\n').filter(l => l.length > 0)

describe('parseLine — malformed input', () => {
  it('returns null for invalid JSON instead of throwing', () => {
    expect(parseLine('{ this is not json at all')).toBeNull()
  })
  it('returns null for an empty line', () => {
    expect(parseLine('')).toBeNull()
  })
  it('returns null for a known type missing required fields', () => {
    expect(parseLine('{"type":"assistant"}')).toBeNull()
  })
  it('returns null for an unknown future type', () => {
    expect(parseLine('{"type":"totally-unknown-future-type","uuid":"x1"}')).toBeNull()
  })
})

describe('parseLine — content extraction', () => {
  const lines = fixture('transcript-malformed.jsonl')

  it('parses a string-content user message', () => {
    const e = parseLine(lines.find(l => l.includes('"u1"'))!)!
    expect(e.role).toBe('user')
    expect(e.text).toBe('hello')
    expect(e.toolCalls).toEqual([])
  })

  it('extracts visible text and tool calls but never thinking content', () => {
    const e = parseLine(lines.find(l => l.includes('"a1"'))!)!
    expect(e.role).toBe('assistant')
    expect(e.text).toBe('hi')
    expect(e.text).not.toContain('secret')
    expect(e.toolCalls).toEqual([{ id: 't1', name: 'Read', filePath: '/Users/dev/x.ts' }])
  })

  it('yields no text for a tool_result-only user message', () => {
    const e = parseLine(lines.find(l => l.includes('"u2"'))!)!
    expect(e.role).toBe('user')
    expect(e.text).toBeNull()
  })
})

describe('parseLines — stats', () => {
  it('counts skipped lines by reason and never throws', () => {
    const { entries, stats } = parseLines(fixture('transcript-malformed.jsonl'))
    expect(entries).toHaveLength(3)
    expect(stats.parsed).toBe(3)
    expect(stats.skippedInvalid).toBe(2)   // bad json + assistant missing fields
    expect(stats.skippedUnknown).toBe(1)   // the unknown future type
  })

  it('parses a real transcript without throwing and records versions', () => {
    const { entries, stats } = parseLines(fixture('transcript-sample.jsonl'))
    expect(entries.length).toBeGreaterThan(10)
    expect(stats.versions.length).toBeGreaterThan(0)
    for (const e of entries) {
      expect(e.uuid).toBeTruthy()
      expect(['user', 'assistant', 'system']).toContain(e.role)
      expect(Number.isNaN(Date.parse(e.timestamp))).toBe(false)
    }
  })

  it('extracts file paths from real tool calls', () => {
    const { entries } = parseLines(fixture('transcript-sample.jsonl'))
    const withFiles = entries.flatMap(e => e.toolCalls).filter(t => t.filePath !== null)
    expect(withFiles.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `npx vitest run src/transcript/__tests__/parse.test.ts`
Expected: FAIL — cannot resolve `../parse.js`.

- [ ] **Step 4: Implement src/transcript/types.ts**

```ts
export type Role = 'user' | 'assistant' | 'system'

export interface ToolCall {
  id: string
  name: string
  /** Best-effort file path from the tool input, when the tool takes one. */
  filePath: string | null
}

export interface TranscriptEntry {
  uuid: string
  parentUuid: string | null
  sessionId: string
  timestamp: string
  role: Role
  isSidechain: boolean
  cwd: string | null
  gitBranch: string | null
  version: string | null
  /** Visible text only. Thinking blocks are deliberately excluded. */
  text: string | null
  toolCalls: ToolCall[]
  isMeta: boolean
}

export interface ParseStats {
  parsed: number
  skippedUnknown: number
  skippedInvalid: number
  versions: string[]
}

/**
 * Line types that carry conversation content. Everything else in the file
 * (titles, modes, file-history snapshots, queue operations, bridge metadata)
 * is session bookkeeping we deliberately ignore.
 */
export const CONTENT_TYPES = ['user', 'assistant', 'system'] as const

/** Known-but-ignored types. Anything outside both lists counts as format drift. */
export const BOOKKEEPING_TYPES = [
  'attachment', 'summary', 'file-history-snapshot', 'file-history-delta',
  'queue-operation', 'mode', 'permission-mode', 'agent-name', 'ai-title',
  'custom-title', 'last-prompt', 'bridge-session',
] as const
```

- [ ] **Step 5: Implement src/transcript/parse.ts**

```ts
import {
  BOOKKEEPING_TYPES, CONTENT_TYPES,
  type ParseStats, type Role, type ToolCall, type TranscriptEntry,
} from './types.js'

/** Tool input keys that carry a file path, in priority order. */
const FILE_PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path']

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function toolCallFrom(block: Record<string, unknown>): ToolCall | null {
  const id = str(block.id)
  const name = str(block.name)
  if (!id || !name) return null
  const input = (block.input ?? {}) as Record<string, unknown>
  let filePath: string | null = null
  for (const key of FILE_PATH_KEYS) {
    const found = str(input[key])
    if (found) { filePath = found; break }
  }
  return { id, name, filePath }
}

/** Pulls visible text and tool calls out of a message body of any known shape. */
function extractContent(message: unknown): { text: string | null; toolCalls: ToolCall[] } {
  const body = (message ?? {}) as Record<string, unknown>
  const content = body.content

  if (typeof content === 'string') {
    return { text: content.length > 0 ? content : null, toolCalls: [] }
  }
  if (!Array.isArray(content)) return { text: null, toolCalls: [] }

  const texts: string[] = []
  const toolCalls: ToolCall[] = []
  for (const raw of content) {
    if (typeof raw !== 'object' || raw === null) continue
    const block = raw as Record<string, unknown>
    switch (block.type) {
      case 'text': {
        const t = str(block.text)
        if (t) texts.push(t)
        break
      }
      case 'tool_use': {
        const call = toolCallFrom(block)
        if (call) toolCalls.push(call)
        break
      }
      // 'thinking', 'tool_result', 'image' and anything newer are intentionally dropped.
      default:
        break
    }
  }
  return { text: texts.length > 0 ? texts.join('\n') : null, toolCalls }
}

/**
 * Parses one JSONL line. Returns null for anything we cannot confidently read —
 * invalid JSON, bookkeeping lines, unknown future types, or content lines
 * missing the fields we need. Never throws: the transcript format is internal
 * to Claude Code and documented to change between releases.
 */
export function parseLine(raw: string): TranscriptEntry | null {
  if (raw.trim().length === 0) return null

  let obj: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    obj = parsed as Record<string, unknown>
  } catch {
    return null
  }

  const type = obj.type
  if (typeof type !== 'string') return null
  if (!(CONTENT_TYPES as readonly string[]).includes(type)) return null

  const uuid = str(obj.uuid)
  const sessionId = str(obj.sessionId) ?? str(obj.session_id)
  const timestamp = str(obj.timestamp)
  if (!uuid || !sessionId || !timestamp) return null

  const { text, toolCalls } = extractContent(obj.message)
  const systemContent = type === 'system' ? str(obj.content) : null

  return {
    uuid,
    parentUuid: str(obj.parentUuid),
    sessionId,
    timestamp,
    role: type as Role,
    isSidechain: obj.isSidechain === true,
    cwd: str(obj.cwd),
    gitBranch: str(obj.gitBranch),
    version: str(obj.version),
    text: text ?? systemContent,
    toolCalls,
    isMeta: obj.isMeta === true,
  }
}

/** Classifies a line we could not turn into an entry: known bookkeeping vs format drift. */
function classifySkip(raw: string): 'unknown' | 'invalid' {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const type = parsed?.type
    if (typeof type !== 'string') return 'invalid'
    if ((BOOKKEEPING_TYPES as readonly string[]).includes(type)) return 'invalid'
    if ((CONTENT_TYPES as readonly string[]).includes(type)) return 'invalid'
    return 'unknown'
  } catch {
    return 'invalid'
  }
}

export function parseLines(raws: string[]): { entries: TranscriptEntry[]; stats: ParseStats } {
  const entries: TranscriptEntry[] = []
  const versions = new Set<string>()
  let skippedUnknown = 0
  let skippedInvalid = 0

  for (const raw of raws) {
    if (raw.trim().length === 0) continue
    const entry = parseLine(raw)
    if (entry) {
      entries.push(entry)
      if (entry.version) versions.add(entry.version)
      continue
    }
    if (classifySkip(raw) === 'unknown') skippedUnknown++
    else skippedInvalid++
  }

  return {
    entries,
    stats: { parsed: entries.length, skippedUnknown, skippedInvalid, versions: [...versions] },
  }
}
```

Note on the stats semantics the test encodes: bookkeeping lines counted as `skippedInvalid` would be misleading in the real fixture, where they are numerous and expected. Adjust `classifySkip` so bookkeeping returns a third bucket if the real-fixture assertion in Step 2 proves noisy — but keep `skippedUnknown` meaning *only* format drift.

- [ ] **Step 6: Run the test and verify it passes**

Run: `npx vitest run src/transcript/__tests__/parse.test.ts`
Expected: PASS (10 tests). If the malformed-fixture counts disagree, fix the *implementation's* bucketing, not the assertions — `skippedUnknown` must count only genuinely unknown types.

- [ ] **Step 7: Run the whole suite and lint**

Run: `npm test && npm run lint`
Expected: all green.

- [ ] **Step 8: Update TASKS.md and commit**

```bash
git add -A
git commit -m "feat(transcript): defensive jsonl parser with drift-tolerant skipping"
```

---

## Task 4 (T-004): SessionWatcher — tailing and the session store

**Files:**
- Create: `src/server/watcher/tail.ts`, `src/server/watcher/session-store.ts`, `src/server/watcher/index.ts`, `src/server/watcher/__tests__/tail.test.ts`, `src/server/watcher/__tests__/session-store.test.ts`
- Modify: `src/server/index.ts`, `src/shared/types.ts`

**Interfaces:**
- Consumes: `parseLines`, `TranscriptEntry`, `ParseStats` from `@transcript/*`; `ProjectRegistry`, `projectsDir`.
- Produces:
  ```ts
  interface TailState { byteOffset: number; partial: string; seenUuids: Set<string> }
  function createTailState(): TailState
  function readNewLines(filePath: string, state: TailState): Promise<{ lines: string[]; state: TailState }>

  interface SessionSummary {
    sessionId: string; projectId: string | null; projectPath: string | null
    status: 'active' | 'idle' | 'done'
    startedAt: string; lastActivity: string
    lastUserPrompt: string | null; lastAssistantText: string | null
    filesTouched: string[]; toolCounts: Record<string, number>
    messageCount: number; hasSidechain: boolean
    versions: string[]; skippedUnknown: number
  }
  class SessionStore {
    apply(sessionId: string, entries: TranscriptEntry[], stats: ParseStats, project: ProjectRecord | null): SessionSummary
    get(sessionId: string): SessionSummary | undefined
    all(): SessionSummary[]
    entries(sessionId: string): TranscriptEntry[]
    markEnded(sessionId: string): void
  }
  class SessionWatcher extends EventEmitter {   // emits 'session' with a SessionSummary
    constructor(registry: ProjectRegistry, store: SessionStore)
    start(): Promise<void>
    stop(): Promise<void>
  }
  ```

- [ ] **Step 1: Write the failing tail test**

`src/server/watcher/__tests__/tail.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTailState, readNewLines } from '../tail.js'

let file: string
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mc-tail-'))
  file = join(dir, 'session.jsonl')
})

describe('readNewLines', () => {
  it('reads all complete lines on first pass', async () => {
    await writeFile(file, '{"a":1}\n{"a":2}\n')
    const { lines, state } = await readNewLines(file, createTailState())
    expect(lines).toEqual(['{"a":1}', '{"a":2}'])
    expect(state.byteOffset).toBe(16)
  })

  it('returns only appended lines on the second pass', async () => {
    await writeFile(file, '{"a":1}\n')
    const first = await readNewLines(file, createTailState())
    await appendFile(file, '{"a":2}\n')
    const second = await readNewLines(file, first.state)
    expect(second.lines).toEqual(['{"a":2}'])
  })

  it('returns nothing when the file has not grown', async () => {
    await writeFile(file, '{"a":1}\n')
    const first = await readNewLines(file, createTailState())
    const second = await readNewLines(file, first.state)
    expect(second.lines).toEqual([])
  })

  it('holds back a partial trailing line until its newline arrives', async () => {
    await writeFile(file, '{"a":1}\n{"partial":')
    const first = await readNewLines(file, createTailState())
    expect(first.lines).toEqual(['{"a":1}'])
    expect(first.state.partial).toBe('{"partial":')

    await appendFile(file, 'true}\n')
    const second = await readNewLines(file, first.state)
    expect(second.lines).toEqual(['{"partial":true}'])
  })

  it('resets and re-reads when the file shrinks', async () => {
    await writeFile(file, '{"a":1}\n{"a":2}\n')
    const first = await readNewLines(file, createTailState())
    await writeFile(file, '{"b":1}\n')
    const second = await readNewLines(file, first.state)
    expect(second.lines).toEqual(['{"b":1}'])
    expect(second.state.byteOffset).toBe(8)
  })

  it('returns nothing for a missing file instead of throwing', async () => {
    const { lines } = await readNewLines(join(tmpdir(), 'nope-does-not-exist.jsonl'), createTailState())
    expect(lines).toEqual([])
  })

  it('handles multibyte characters split across reads', async () => {
    await writeFile(file, '{"t":"здравей"}\n')
    const { lines } = await readNewLines(file, createTailState())
    expect(JSON.parse(lines[0]!).t).toBe('здравей')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/server/watcher/__tests__/tail.test.ts`
Expected: FAIL — cannot resolve `../tail.js`.

- [ ] **Step 3: Implement src/server/watcher/tail.ts**

```ts
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

export interface TailState {
  byteOffset: number
  /** A JSONL line can be observed mid-write; hold the tail until its newline arrives. */
  partial: string
  seenUuids: Set<string>
}

export function createTailState(): TailState {
  return { byteOffset: 0, partial: '', seenUuids: new Set() }
}

async function readFrom(filePath: string, start: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const stream = createReadStream(filePath, { start })
    stream.on('data', c => chunks.push(c as Buffer))
    stream.on('error', reject)
    // Decode once at the end so multibyte characters split across chunks survive.
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

/**
 * Reads whatever was appended since the last call. chokidar events are only a
 * poke — fsevents fires duplicates and even fires on open — so growth is
 * decided here by comparing size against the stored offset.
 */
export async function readNewLines(
  filePath: string,
  state: TailState,
): Promise<{ lines: string[]; state: TailState }> {
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) return { lines: [], state }

  let { byteOffset, partial } = state
  if (info.size < byteOffset) {
    // Truncated or rewritten (compaction, a new Claude Code version). Start over;
    // seenUuids keeps the re-read from double-counting.
    byteOffset = 0
    partial = ''
  }
  if (info.size === byteOffset) return { lines: [], state: { ...state, byteOffset, partial } }

  const chunk = await readFrom(filePath, byteOffset)
  const combined = partial + chunk
  const pieces = combined.split('\n')
  const nextPartial = pieces.pop() ?? ''
  const lines = pieces.filter(l => l.length > 0)

  return {
    lines,
    state: { byteOffset: info.size, partial: nextPartial, seenUuids: state.seenUuids },
  }
}
```

- [ ] **Step 4: Run the tail test and verify it passes**

Run: `npx vitest run src/server/watcher/__tests__/tail.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing session-store test**

`src/server/watcher/__tests__/session-store.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SessionStore } from '../session-store.js'
import type { TranscriptEntry, ParseStats } from '../../../transcript/types.js'

const stats: ParseStats = { parsed: 0, skippedUnknown: 0, skippedInvalid: 0, versions: ['2.1.0'] }

function entry(over: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    uuid: 'u1', parentUuid: null, sessionId: 's1', timestamp: '2026-08-12T10:00:00.000Z',
    role: 'user', isSidechain: false, cwd: '/p', gitBranch: 'main', version: '2.1.0',
    text: 'do the thing', toolCalls: [], isMeta: false, ...over,
  }
}

afterEach(() => { vi.useRealTimers() })

describe('SessionStore', () => {
  it('derives a summary from entries', () => {
    const store = new SessionStore()
    const s = store.apply('s1', [
      entry(),
      entry({ uuid: 'u2', role: 'assistant', text: 'done', timestamp: '2026-08-12T10:01:00.000Z',
              toolCalls: [{ id: 't1', name: 'Read', filePath: '/p/a.ts' }] }),
    ], stats, null)

    expect(s.lastUserPrompt).toBe('do the thing')
    expect(s.lastAssistantText).toBe('done')
    expect(s.filesTouched).toEqual(['/p/a.ts'])
    expect(s.toolCounts).toEqual({ Read: 1 })
    expect(s.messageCount).toBe(2)
    expect(s.startedAt).toBe('2026-08-12T10:00:00.000Z')
    expect(s.lastActivity).toBe('2026-08-12T10:01:00.000Z')
    expect(s.versions).toEqual(['2.1.0'])
  })

  it('accumulates across successive applies without losing earlier data', () => {
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, null)
    const s = store.apply('s1', [entry({ uuid: 'u2', role: 'assistant', text: 'ok',
                                         timestamp: '2026-08-12T10:02:00.000Z' })], stats, null)
    expect(s.messageCount).toBe(2)
    expect(s.lastUserPrompt).toBe('do the thing')
  })

  it('ignores a duplicate uuid on re-read', () => {
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, null)
    const s = store.apply('s1', [entry()], stats, null)
    expect(s.messageCount).toBe(1)
  })

  it('flags sessions containing subagent activity', () => {
    const store = new SessionStore()
    const s = store.apply('s1', [entry({ isSidechain: true })], stats, null)
    expect(s.hasSidechain).toBe(true)
  })

  it('is active within the idle threshold and idle beyond it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T10:02:00.000Z'))
    const store = new SessionStore()
    expect(store.apply('s1', [entry()], stats, null).status).toBe('active')

    vi.setSystemTime(new Date('2026-08-12T10:30:00.000Z'))
    expect(store.get('s1')!.status).toBe('idle')
  })

  it('marks a session done and keeps it done regardless of recency', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T10:00:30.000Z'))
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, null)
    store.markEnded('s1')
    expect(store.get('s1')!.status).toBe('done')
  })

  it('deduplicates files touched and counts each tool use', () => {
    const store = new SessionStore()
    const s = store.apply('s1', [
      entry({ uuid: 'a', toolCalls: [{ id: 't1', name: 'Edit', filePath: '/p/a.ts' }] }),
      entry({ uuid: 'b', toolCalls: [{ id: 't2', name: 'Edit', filePath: '/p/a.ts' }] }),
    ], stats, null)
    expect(s.filesTouched).toEqual(['/p/a.ts'])
    expect(s.toolCounts).toEqual({ Edit: 2 })
  })
})
```

- [ ] **Step 6: Run the test and verify it fails**

Run: `npx vitest run src/server/watcher/__tests__/session-store.test.ts`
Expected: FAIL — cannot resolve `../session-store.js`.

- [ ] **Step 7: Add SessionSummary to src/shared/types.ts**

Append:
```ts
export type SessionStatus = 'active' | 'idle' | 'done'

export interface SessionSummary {
  sessionId: string
  projectId: string | null
  projectPath: string | null
  status: SessionStatus
  startedAt: string
  lastActivity: string
  lastUserPrompt: string | null
  lastAssistantText: string | null
  filesTouched: string[]
  toolCounts: Record<string, number>
  messageCount: number
  hasSidechain: boolean
  versions: string[]
  skippedUnknown: number
}
```

- [ ] **Step 8: Implement src/server/watcher/session-store.ts**

```ts
import type { ParseStats, TranscriptEntry } from '../../transcript/types.js'
import type { ProjectRecord, SessionSummary, SessionStatus } from '../../shared/types.js'

/** A session with no transcript growth for this long is no longer "active". */
export const ACTIVE_WINDOW_MS = 5 * 60 * 1000

interface SessionState {
  entries: TranscriptEntry[]
  seen: Set<string>
  ended: boolean
  project: ProjectRecord | null
  versions: Set<string>
  skippedUnknown: number
}

export class SessionStore {
  #sessions = new Map<string, SessionState>()

  #state(sessionId: string): SessionState {
    let s = this.#sessions.get(sessionId)
    if (!s) {
      s = { entries: [], seen: new Set(), ended: false, project: null, versions: new Set(), skippedUnknown: 0 }
      this.#sessions.set(sessionId, s)
    }
    return s
  }

  apply(
    sessionId: string,
    entries: TranscriptEntry[],
    stats: ParseStats,
    project: ProjectRecord | null,
  ): SessionSummary {
    const state = this.#state(sessionId)
    if (project) state.project = project
    state.skippedUnknown += stats.skippedUnknown
    for (const v of stats.versions) state.versions.add(v)

    for (const e of entries) {
      if (state.seen.has(e.uuid)) continue   // re-read after truncation must not double-count
      state.seen.add(e.uuid)
      state.entries.push(e)
    }
    return this.#summarize(sessionId, state)
  }

  markEnded(sessionId: string): void {
    this.#state(sessionId).ended = true
  }

  get(sessionId: string): SessionSummary | undefined {
    const state = this.#sessions.get(sessionId)
    return state ? this.#summarize(sessionId, state) : undefined
  }

  all(): SessionSummary[] {
    return [...this.#sessions.entries()]
      .map(([id, state]) => this.#summarize(id, state))
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
  }

  entries(sessionId: string): TranscriptEntry[] {
    return [...(this.#sessions.get(sessionId)?.entries ?? [])]
  }

  #summarize(sessionId: string, state: SessionState): SessionSummary {
    const { entries } = state
    const files: string[] = []
    const toolCounts: Record<string, number> = {}
    let lastUserPrompt: string | null = null
    let lastAssistantText: string | null = null
    let hasSidechain = false

    for (const e of entries) {
      if (e.isSidechain) { hasSidechain = true; continue }  // subagent chatter is not the session's own state
      if (e.role === 'user' && e.text && !e.isMeta) lastUserPrompt = e.text
      if (e.role === 'assistant' && e.text) lastAssistantText = e.text
      for (const call of e.toolCalls) {
        toolCounts[call.name] = (toolCounts[call.name] ?? 0) + 1
        if (call.filePath && !files.includes(call.filePath)) files.push(call.filePath)
      }
    }

    const first = entries[0]
    const last = entries[entries.length - 1]
    const lastActivity = last?.timestamp ?? new Date(0).toISOString()
    const fresh = Date.now() - Date.parse(lastActivity) < ACTIVE_WINDOW_MS
    const status: SessionStatus = state.ended ? 'done' : fresh ? 'active' : 'idle'

    return {
      sessionId,
      projectId: state.project?.id ?? null,
      projectPath: state.project?.path ?? first?.cwd ?? null,
      status,
      startedAt: first?.timestamp ?? lastActivity,
      lastActivity,
      lastUserPrompt,
      lastAssistantText,
      filesTouched: files,
      toolCounts,
      messageCount: entries.length,
      hasSidechain,
      versions: [...state.versions],
      skippedUnknown: state.skippedUnknown,
    }
  }
}
```

- [ ] **Step 9: Run the session-store test and verify it passes**

Run: `npx vitest run src/server/watcher/__tests__/session-store.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 10: Implement src/server/watcher/index.ts**

```ts
import { EventEmitter } from 'node:events'
import { basename, dirname, join } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { projectsDir } from '../../shared/config.js'
import { parseLines } from '../../transcript/parse.js'
import type { ProjectRegistry } from '../registry.js'
import { createTailState, readNewLines, type TailState } from './tail.js'
import type { SessionStore } from './session-store.js'

const DEBOUNCE_MS = 150

export class SessionWatcher extends EventEmitter {
  #watcher: FSWatcher | null = null
  #tails = new Map<string, TailState>()
  #timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly store: SessionStore,
  ) { super() }

  async start(): Promise<void> {
    const root = projectsDir()
    this.#watcher = chokidar.watch(join(root, '**', '*.jsonl'), {
      ignoreInitial: false,
      alwaysStat: true,
      // No awaitWriteFinish: Claude writes continuously and it would add latency.
      // Duplicate/spurious fsevents are free because readNewLines checks growth itself.
    })
    this.#watcher.on('add', p => this.#schedule(p))
    this.#watcher.on('change', p => this.#schedule(p))
  }

  async stop(): Promise<void> {
    for (const t of this.#timers.values()) clearTimeout(t)
    this.#timers.clear()
    await this.#watcher?.close()
    this.#watcher = null
  }

  #schedule(filePath: string): void {
    const existing = this.#timers.get(filePath)
    if (existing) clearTimeout(existing)
    this.#timers.set(filePath, setTimeout(() => {
      this.#timers.delete(filePath)
      void this.#drain(filePath)
    }, DEBOUNCE_MS))
  }

  async #drain(filePath: string): Promise<void> {
    const state = this.#tails.get(filePath) ?? createTailState()
    const { lines, state: next } = await readNewLines(filePath, state)
    this.#tails.set(filePath, next)
    if (lines.length === 0) return

    const { entries, stats } = parseLines(lines)
    if (entries.length === 0 && stats.skippedUnknown === 0) return

    const sessionId = entries[0]?.sessionId ?? basename(filePath, '.jsonl')
    const project = this.registry.byEscapedDir(basename(dirname(filePath))) ?? null
    const summary = this.store.apply(sessionId, entries, stats, project)
    this.emit('session', summary)
  }
}
```

- [ ] **Step 11: Wire the watcher into the server and expose session routes**

`src/server/routes/sessions.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import type { SessionStore } from '../watcher/session-store.js'
import type { ProjectRegistry } from '../registry.js'

export function registerSessionRoutes(
  app: FastifyInstance, store: SessionStore, registry: ProjectRegistry,
): void {
  app.get('/api/sessions', async () => ({ sessions: store.all() }))

  app.get<{ Params: { id: string } }>('/api/projects/:id/sessions', async (req, reply) => {
    const project = registry.byId(req.params.id)
    if (!project) return reply.code(404).send({ error: 'unknown project' })
    return { sessions: store.all().filter(s => s.projectId === project.id) }
  })

  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId', async (req, reply) => {
    const summary = store.get(req.params.sessionId)
    if (!summary) return reply.code(404).send({ error: 'unknown session' })
    return { summary, entries: store.entries(req.params.sessionId) }
  })
}
```

In `src/server/index.ts`, after the registry is loaded: construct `new SessionStore()` and `new SessionWatcher(registry, store)`, `await watcher.start()`, call `registerSessionRoutes(app, store, registry)`, and decorate `app` with `store` and `watcher`. Close the watcher in `app.addHook('onClose', () => watcher.stop())`.

- [ ] **Step 12: Verify against a real live session**

```bash
npm run dev:server &
sleep 3
curl -s http://127.0.0.1:4517/api/sessions | jq '.sessions | length, .[0].sessionId, .[0].status'
```
Expected: a non-zero count, and *this* session's UUID present with status `active`. Kill the server.

- [ ] **Step 13: Run the whole suite, lint, update TASKS.md, commit**

```bash
npm test && npm run lint
git add -A
git commit -m "feat(watcher): incremental jsonl tailing and live session index"
```

---

## Task 5 (T-005): WebSocket hub and the Overview screen

**Files:**
- Create: `src/server/ws/hub.ts`, `src/server/ws/__tests__/hub.test.ts`, `web/src/shared/useLiveState.ts`, `web/src/shared/format.ts`, `web/src/overview/Overview.tsx`, `web/src/overview/ProjectCard.tsx`, `web/src/overview/SessionRow.tsx`
- Modify: `src/server/index.ts`, `src/shared/types.ts`, `web/src/App.tsx`

**Interfaces:**
- Produces:
  ```ts
  type ServerEvent =
    | { seq: number; type: 'snapshot'; projects: ProjectRecord[]; sessions: SessionSummary[]; tasks: Record<string, TasksDoc> }
    | { seq: number; type: 'session.updated'; session: SessionSummary }
    | { seq: number; type: 'task.updated'; projectId: string; doc: TasksDoc }
    | { seq: number; type: 'dispatch.output'; runId: string; chunk: string }
    | { seq: number; type: 'pong' }

  class EventHub {
    constructor(snapshot: () => Omit<Extract<ServerEvent,{type:'snapshot'}>, 'seq'|'type'>)
    addClient(send: (payload: string) => void): () => void   // returns a disconnect function
    broadcast(event: Omit<ServerEvent, 'seq'>): void
    handleClientMessage(raw: string, send: (payload: string) => void): void
  }
  ```
  `tasks` in the snapshot is `{}` until Task 8 lands; keep the field so the client shape never changes.

- [ ] **Step 1: Write the failing hub test**

`src/server/ws/__tests__/hub.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { EventHub } from '../hub.js'

const emptySnapshot = () => ({ projects: [], sessions: [], tasks: {} })

describe('EventHub', () => {
  it('sends a full snapshot as seq 1 the moment a client connects', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    hub.addClient(send)
    const msg = JSON.parse(send.mock.calls[0]![0] as string)
    expect(msg.type).toBe('snapshot')
    expect(msg.seq).toBe(1)
  })

  it('numbers broadcasts monotonically so clients can detect gaps', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    hub.addClient(send)
    hub.broadcast({ type: 'session.updated', session: { sessionId: 'a' } as never })
    hub.broadcast({ type: 'session.updated', session: { sessionId: 'b' } as never })
    const seqs = send.mock.calls.map(c => JSON.parse(c[0] as string).seq)
    expect(seqs).toEqual([1, 2, 3])
  })

  it('stops sending to a client after it disconnects', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    const disconnect = hub.addClient(send)
    disconnect()
    hub.broadcast({ type: 'session.updated', session: { sessionId: 'a' } as never })
    expect(send).toHaveBeenCalledTimes(1)   // the snapshot only
  })

  it('re-sends a snapshot when a client reports a sequence gap', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    hub.addClient(send)
    send.mockClear()
    hub.handleClientMessage(JSON.stringify({ type: 'resnapshot' }), send)
    expect(JSON.parse(send.mock.calls[0]![0] as string).type).toBe('snapshot')
  })

  it('answers a ping with a pong', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    hub.addClient(send); send.mockClear()
    hub.handleClientMessage(JSON.stringify({ type: 'ping' }), send)
    expect(JSON.parse(send.mock.calls[0]![0] as string).type).toBe('pong')
  })

  it('ignores a malformed client message instead of throwing', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    hub.addClient(send); send.mockClear()
    expect(() => hub.handleClientMessage('not json', send)).not.toThrow()
    expect(send).not.toHaveBeenCalled()
  })

  it('drops a client whose send throws rather than failing the broadcast', () => {
    const hub = new EventHub(emptySnapshot)
    const bad = vi.fn(() => { throw new Error('socket closed') })
    const good = vi.fn()
    hub.addClient(bad)
    hub.addClient(good)
    expect(() => hub.broadcast({ type: 'session.updated', session: {} as never })).not.toThrow()
    expect(good).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/server/ws/__tests__/hub.test.ts`
Expected: FAIL — cannot resolve `../hub.js`.

- [ ] **Step 3: Implement src/server/ws/hub.ts**

```ts
import type { ProjectRecord, SessionSummary } from '../../shared/types.js'

export interface SnapshotPayload {
  projects: ProjectRecord[]
  sessions: SessionSummary[]
  tasks: Record<string, unknown>
}

export type ServerEvent =
  | ({ type: 'snapshot' } & SnapshotPayload)
  | { type: 'session.updated'; session: SessionSummary }
  | { type: 'task.updated'; projectId: string; doc: unknown }
  | { type: 'dispatch.output'; runId: string; chunk: string }
  | { type: 'dispatch.ended'; runId: string; code: number | null }
  | { type: 'pong' }

type Send = (payload: string) => void

export class EventHub {
  #clients = new Set<Send>()
  #seq = 0

  constructor(private readonly snapshot: () => SnapshotPayload) {}

  addClient(send: Send): () => void {
    this.#clients.add(send)
    this.#emit(send, { type: 'snapshot', ...this.snapshot() })
    return () => { this.#clients.delete(send) }
  }

  broadcast(event: ServerEvent): void {
    const payload = JSON.stringify({ seq: ++this.#seq, ...event })
    for (const send of [...this.#clients]) {
      try { send(payload) } catch { this.#clients.delete(send) }
    }
  }

  /** Clients ask for a fresh snapshot on a sequence gap; state is small, so no replay buffer. */
  handleClientMessage(raw: string, send: Send): void {
    let msg: { type?: string }
    try { msg = JSON.parse(raw) } catch { return }
    if (msg.type === 'resnapshot') this.#emit(send, { type: 'snapshot', ...this.snapshot() })
    else if (msg.type === 'ping') this.#emit(send, { type: 'pong' })
  }

  #emit(send: Send, event: ServerEvent): void {
    try { send(JSON.stringify({ seq: ++this.#seq, ...event })) } catch { this.#clients.delete(send) }
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/server/ws/__tests__/hub.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Register the WebSocket route**

In `src/server/index.ts`, register `@fastify/websocket`, build the hub, subscribe it to the watcher, and add the route:
```ts
import websocket from '@fastify/websocket'
import { EventHub } from './ws/hub.js'

await app.register(websocket)
const hub = new EventHub(() => ({ projects: registry.list(), sessions: store.all(), tasks: {} }))
watcher.on('session', session => hub.broadcast({ type: 'session.updated', session }))

app.get('/ws', { websocket: true }, socket => {
  const disconnect = hub.addClient(payload => socket.send(payload))
  socket.on('message', raw => hub.handleClientMessage(raw.toString(), p => socket.send(p)))
  socket.on('close', disconnect)
  socket.on('error', disconnect)
})
app.decorate('hub', hub)
```

- [ ] **Step 6: Implement the client live-state hook**

`web/src/shared/useLiveState.ts`:
```tsx
import { useEffect, useRef, useState } from 'react'

export interface LiveState {
  projects: ProjectRecord[]
  sessions: SessionSummary[]
  connected: boolean
}

export function useLiveState(): LiveState {
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [connected, setConnected] = useState(false)
  const lastSeq = useRef(0)

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
        // Laptop sleep is the main local failure mode; a heartbeat surfaces dead sockets.
        heartbeat = window.setInterval(() => socket?.send(JSON.stringify({ type: 'ping' })), 30_000)
      }

      socket.onmessage = ev => {
        const msg = JSON.parse(ev.data as string)
        if (msg.type !== 'snapshot' && lastSeq.current !== 0 && msg.seq !== lastSeq.current + 1) {
          socket?.send(JSON.stringify({ type: 'resnapshot' }))   // gap: refetch rather than patch
        }
        lastSeq.current = msg.seq
        if (msg.type === 'snapshot') { setProjects(msg.projects); setSessions(msg.sessions) }
        else if (msg.type === 'session.updated') {
          setSessions(prev => {
            const next = prev.filter(s => s.sessionId !== msg.session.sessionId)
            return [msg.session, ...next].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
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
      window.clearInterval(heartbeat); window.clearTimeout(retry); socket?.close()
    }
  }, [])

  return { projects, sessions, connected }
}
```

Copy `ProjectRecord` and `SessionSummary` into `web/src/shared/types.ts` (the frontend has no path alias into `src/`); keep the two definitions identical.

- [ ] **Step 7: Build the Overview screen**

`web/src/shared/format.ts`:
```ts
export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export const STATUS_STYLES = {
  active: 'bg-emerald-500 animate-pulse',
  idle: 'bg-amber-500',
  done: 'bg-neutral-600',
} as const
```

`web/src/overview/SessionRow.tsx`:
```tsx
import type { SessionSummary } from '../shared/types.js'
import { relativeTime, STATUS_STYLES } from '../shared/format.js'

export function SessionRow({ session, onOpen }: { session: SessionSummary; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpen(session.sessionId)}
      data-testid="session-row"
      className="w-full text-left flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-neutral-800/60"
    >
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${STATUS_STYLES[session.status]}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-neutral-200">
          {session.lastUserPrompt ?? '(no prompt yet)'}
        </span>
        <span className="block text-xs text-neutral-500">
          {relativeTime(session.lastActivity)} · {session.messageCount} msgs
          {session.hasSidechain && ' · subagents'}
          {session.skippedUnknown > 0 && ` · ${session.skippedUnknown} unknown lines`}
        </span>
      </span>
    </button>
  )
}
```

`web/src/overview/ProjectCard.tsx`:
```tsx
import type { ProjectRecord, SessionSummary } from '../shared/types.js'
import { SessionRow } from './SessionRow.js'

export function ProjectCard(
  { project, sessions, onOpenSession }:
  { project: ProjectRecord; sessions: SessionSummary[]; onOpenSession: (id: string) => void },
) {
  const active = sessions.filter(s => s.status === 'active').length
  return (
    <section data-testid="project-card" className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="truncate font-medium text-neutral-100">{project.name}</h2>
        <span className="text-xs text-neutral-500">{active} active · {sessions.length} total</span>
      </header>
      <div className="space-y-1">
        {sessions.length === 0
          ? <p className="px-3 py-2 text-sm text-neutral-600">No sessions yet.</p>
          : sessions.slice(0, 6).map(s => <SessionRow key={s.sessionId} session={s} onOpen={onOpenSession} />)}
      </div>
    </section>
  )
}
```

`web/src/overview/Overview.tsx`:
```tsx
import { useLiveState } from '../shared/useLiveState.js'
import { ProjectCard } from './ProjectCard.js'

export function Overview({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const { projects, sessions, connected } = useLiveState()
  const unassigned = sessions.filter(s => s.projectId === null)

  return (
    <main className="min-h-screen bg-neutral-950 p-8 text-neutral-100">
      <header className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Mission Control</h1>
        <span data-testid="connection" className="text-xs text-neutral-500">
          {connected ? 'live' : 'reconnecting…'}
        </span>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map(p => (
          <ProjectCard
            key={p.id}
            project={p}
            sessions={sessions.filter(s => s.projectId === p.id)}
            onOpenSession={onOpenSession}
          />
        ))}
      </div>

      {unassigned.length > 0 && (
        <p className="mt-6 text-sm text-neutral-500">
          {unassigned.length} session(s) in unregistered projects.
        </p>
      )}
    </main>
  )
}
```

Replace `web/src/App.tsx` with a two-screen switch holding `selectedSession` state; render `<Overview onOpenSession={setSelectedSession} />` when nothing is selected. The session view arrives in Task 6 — until then, render the session id and a back button.

- [ ] **Step 8: Verify live in the browser**

Run `npm run dev`. Register this project via the API if `projects.json` is absent. With Chrome DevTools MCP: navigate to `http://127.0.0.1:4518`, take a snapshot, confirm a project card exists showing this session with a green pulsing dot, and that `[data-testid="connection"]` reads "live". Check the console for errors with `list_console_messages`. Screenshot to `.tmp/t005-overview.png`.

Then confirm liveness: send a message in this Claude Code session, wait a moment, re-snapshot, and verify `lastUserPrompt`/relative time updated without a page reload.

- [ ] **Step 9: Run the suite, lint, update TASKS.md, commit**

```bash
npm test && npm run lint
git add -A
git commit -m "feat(ws): snapshot-and-delta event hub with live overview screen"
```

---

## Task 6 (T-006): Session view with auto-following tail

**Files:**
- Create: `web/src/session/SessionView.tsx`, `web/src/session/TimelineEntry.tsx`, `web/src/session/useSessionDetail.ts`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `GET /api/sessions/:sessionId` → `{ summary: SessionSummary; entries: TranscriptEntry[] }` (Task 4), `session.updated` WS events (Task 5).
- Produces: `useSessionDetail(sessionId: string): { summary: SessionSummary | null; entries: TranscriptEntry[]; loading: boolean }` — refetches when a `session.updated` event names this session.

- [ ] **Step 1: Implement the detail hook**

`web/src/session/useSessionDetail.ts`:
```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionSummary, TranscriptEntry } from '../shared/types.js'

export function useSessionDetail(sessionId: string) {
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [loading, setLoading] = useState(true)
  const inFlight = useRef(false)

  const refetch = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const res = await fetch(`/api/sessions/${sessionId}`)
      if (res.ok) {
        const data = await res.json()
        setSummary(data.summary)
        setEntries(data.entries)
      }
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void refetch() }, [refetch])

  // Piggyback on the same socket the overview uses: a session.updated for THIS
  // session means new entries exist, so refetch the full timeline.
  useEffect(() => {
    const socket = new WebSocket(`ws://${location.host}/ws`)
    socket.onmessage = ev => {
      const msg = JSON.parse(ev.data as string)
      if (msg.type === 'session.updated' && msg.session.sessionId === sessionId) void refetch()
    }
    return () => socket.close()
  }, [sessionId, refetch])

  return { summary, entries, loading }
}
```

Add `TranscriptEntry` and `ToolCall` to `web/src/shared/types.ts`, identical to `src/transcript/types.ts`.

- [ ] **Step 2: Implement the timeline entry component**

`web/src/session/TimelineEntry.tsx`:
```tsx
import type { TranscriptEntry } from '../shared/types.js'

const ROLE_STYLES: Record<string, string> = {
  user: 'border-l-sky-500',
  assistant: 'border-l-violet-500',
  system: 'border-l-neutral-700',
}

export function TimelineEntry({ entry }: { entry: TranscriptEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString()
  return (
    <article
      data-testid="timeline-entry"
      className={`border-l-2 ${ROLE_STYLES[entry.role] ?? 'border-l-neutral-700'} py-2 pl-4`}
    >
      <header className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
        <span className="font-medium text-neutral-400">{entry.role}</span>
        <span>{time}</span>
        {entry.isSidechain && <span className="rounded bg-neutral-800 px-1.5">subagent</span>}
      </header>

      {entry.text && (
        <p className="whitespace-pre-wrap break-words text-sm text-neutral-200">
          {entry.text.length > 2000 ? `${entry.text.slice(0, 2000)}…` : entry.text}
        </p>
      )}

      {entry.toolCalls.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {entry.toolCalls.map(call => (
            <li key={call.id} className="font-mono text-xs text-neutral-400">
              <span className="text-amber-400">{call.name}</span>
              {call.filePath && <span className="text-neutral-500"> {call.filePath}</span>}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
```

- [ ] **Step 3: Implement the session view with auto-follow**

`web/src/session/SessionView.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react'
import { useSessionDetail } from './useSessionDetail.js'
import { TimelineEntry } from './TimelineEntry.js'
import { relativeTime, STATUS_STYLES } from '../shared/format.js'

export function SessionView({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const { summary, entries, loading } = useSessionDetail(sessionId)
  const [follow, setFollow] = useState(true)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length, follow])

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/95 px-8 py-4 backdrop-blur">
        <button onClick={onBack} className="mb-2 text-sm text-neutral-400 hover:text-neutral-100">
          ← Overview
        </button>
        {summary && (
          <div className="flex items-center gap-3">
            <span className={`size-2 rounded-full ${STATUS_STYLES[summary.status]}`} />
            <h1 className="truncate font-mono text-sm">{summary.sessionId}</h1>
            <span className="text-xs text-neutral-500">
              {relativeTime(summary.lastActivity)} · {summary.messageCount} msgs
              {summary.versions.length > 0 && ` · cc ${summary.versions.join(', ')}`}
            </span>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-400">
              <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />
              Follow
            </label>
          </div>
        )}
      </header>

      <div className="space-y-1 px-8 py-6">
        {loading && <p className="text-neutral-500">Loading…</p>}
        {!loading && entries.length === 0 && <p className="text-neutral-500">No entries parsed yet.</p>}
        {entries.map(e => <TimelineEntry key={e.uuid} entry={e} />)}
        <div ref={bottom} />
      </div>
    </main>
  )
}
```

Wire it into `web/src/App.tsx`, replacing the placeholder from Task 5.

- [ ] **Step 4: Verify live in the browser**

Run `npm run dev`. With Chrome DevTools MCP: navigate to `http://127.0.0.1:4518`, click a session row, confirm the timeline renders with role-coloured entries and tool calls showing file paths. Confirm no thinking text leaked into the UI (search the snapshot for a phrase you know is only in a thinking block). Screenshot to `.tmp/t006-session.png`. Then send a message in this session and confirm a new entry appears and the view scrolls to it without a reload.

- [ ] **Step 5: Lint, update TASKS.md, commit**

```bash
npm test && npm run lint
git add -A
git commit -m "feat(session): timeline view with auto-following tail"
```

---

## Task 7 (T-007): M1 smoke test and review gate

**Files:**
- Create: `docs/verification/m1-smoke.md`
- Modify: `TASKS.md`

- [ ] **Step 1: Run the end-to-end smoke test**

With `npm run dev` running and a *second* Claude Code session started in another project directory:
1. Register the second project via `POST /api/projects`.
2. In the browser (Chrome DevTools MCP), confirm both projects appear as cards.
3. Confirm the second session appears within ~2 seconds of its first prompt.
4. Let a session go quiet for 5+ minutes and confirm its dot turns amber (idle).
5. Confirm `skippedUnknown` is 0 or small; if large, the parser's allowlist needs a new type.

- [ ] **Step 2: Record findings**

Write `docs/verification/m1-smoke.md` with: date, Claude Code version observed in `versions`, each check above with pass/fail, screenshots referenced from `.tmp/`, and any unknown line types encountered.

- [ ] **Step 3: Run the M1 review workflow**

Dispatch a multi-agent code review over the M1 diff (`git diff <first-commit>..HEAD`) across these dimensions, then adversarially verify each finding before acting on it:
- **correctness** — tail offset math, partial-line handling, dedup, status derivation
- **format-drift resilience** — does any code outside `src/transcript/` assume a transcript shape?
- **security** — loopback binding, no writes under the Claude data dir, no shell interpolation
- **resource safety** — watcher cleanup, timer leaks, unbounded in-memory entry growth

Apply confirmed findings, re-run `npm test && npm run lint`.

- [ ] **Step 4: Update TASKS.md and commit**

Move T-001…T-007 to Done, add a Progress log line recording the M1 milestone.
```bash
git add -A
git commit -m "docs(verification): m1 smoke test results and review fixes"
```

---

## Task 8 (T-008): TASKS.md parser and serializer

**Files:**
- Create: `src/tasks/types.ts`, `src/tasks/parse.ts`, `src/tasks/serialize.ts`, `src/tasks/__tests__/roundtrip.test.ts`, `test/fixtures/tasks-sample.md`, `test/fixtures/tasks-messy.md`

**Interfaces:**
- Produces:
  ```ts
  type TaskStatus = 'todo' | 'in-progress' | 'done'
  interface Task {
    id: string                 // 'T-003'
    status: TaskStatus
    title: string              // text with tags and trailing metadata stripped
    tags: string[]             // ['m1','p1'] — without the '#'
    doneDate: string | null    // 'YYYY-MM-DD' for done tasks
    note: string | null        // trailing parenthetical, e.g. 'session: 8f3a…'
  }
  interface ProgressEntry { raw: string }
  interface TasksDoc {
    title: string              // the H1, default 'Tasks'
    tasks: Task[]
    progress: ProgressEntry[]  // newest first, verbatim lines
    preamble: string[]         // any lines before the first section, preserved
  }
  function parseTasks(markdown: string): TasksDoc
  function serializeTasks(doc: TasksDoc): string
  function nextTaskId(doc: TasksDoc): string   // max existing id + 1, never reused
  ```

- [ ] **Step 1: Write the fixtures**

`test/fixtures/tasks-sample.md` — copy the SPEC §5 example verbatim.

`test/fixtures/tasks-messy.md`:
```markdown
# Tasks

## Todo

- [ ] **T-010** Task with no tags
-   [ ]   **T-011**   Extra   whitespace   `#p3`
- [ ] Malformed line with no id `#p1`
- not a task line at all

## In progress

- [~] **T-002** Wire session timeline `#p1` (session: 8f3a…)

## Done

- [x] **T-001** Scaffolding `#p1` `#m1` (2026-08-12)

## Progress log

- 2026-08-12 14:20 T-002 — parser handles tool_use lines
- 2026-08-12 09:00 T-001 — scaffolding done
```

- [ ] **Step 2: Write the failing test**

`src/tasks/__tests__/roundtrip.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseTasks, nextTaskId } from '../parse.js'
import { serializeTasks } from '../serialize.js'

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../test/fixtures/${name}`, import.meta.url)), 'utf8')

describe('parseTasks', () => {
  it('reads ids, statuses, titles and tags from the spec format', () => {
    const doc = parseTasks(fixture('tasks-sample.md'))
    expect(doc.tasks.map(t => t.id)).toEqual(['T-003', 'T-002', 'T-001'])
    expect(doc.tasks.map(t => t.status)).toEqual(['todo', 'in-progress', 'done'])
    expect(doc.tasks[0]!.title).toBe('Add dark mode toggle')
    expect(doc.tasks[0]!.tags).toEqual(['ui', 'p2'])
    expect(doc.tasks[2]!.doneDate).toBe('2026-08-12')
    expect(doc.tasks[1]!.note).toBe('session: 8f3a…')
  })

  it('keeps progress log lines verbatim and newest first', () => {
    const doc = parseTasks(fixture('tasks-messy.md'))
    expect(doc.progress).toHaveLength(2)
    expect(doc.progress[0]!.raw).toContain('T-002 — parser handles tool_use lines')
  })

  it('skips lines that are not tasks rather than throwing', () => {
    const doc = parseTasks(fixture('tasks-messy.md'))
    expect(doc.tasks.map(t => t.id)).toEqual(['T-010', 'T-011', 'T-002', 'T-001'])
  })

  it('tolerates irregular whitespace', () => {
    const doc = parseTasks(fixture('tasks-messy.md'))
    const t11 = doc.tasks.find(t => t.id === 'T-011')!
    expect(t11.title).toBe('Extra whitespace')
    expect(t11.tags).toEqual(['p3'])
  })

  it('returns an empty doc for empty input', () => {
    const doc = parseTasks('')
    expect(doc.tasks).toEqual([])
    expect(doc.progress).toEqual([])
  })
})

describe('round-trip', () => {
  for (const name of ['tasks-sample.md', 'tasks-messy.md']) {
    it(`parse → serialize → parse is stable for ${name}`, () => {
      const once = parseTasks(fixture(name))
      const twice = parseTasks(serializeTasks(once))
      expect(twice).toEqual(once)
    })
  }

  it('serialize → parse → serialize is byte-identical', () => {
    const doc = parseTasks(fixture('tasks-sample.md'))
    const a = serializeTasks(doc)
    expect(serializeTasks(parseTasks(a))).toBe(a)
  })

  it('emits all three sections even when empty', () => {
    const out = serializeTasks(parseTasks(''))
    expect(out).toContain('## Todo')
    expect(out).toContain('## In progress')
    expect(out).toContain('## Done')
    expect(out).toContain('## Progress log')
  })
})

describe('nextTaskId', () => {
  it('is one past the highest existing id', () => {
    expect(nextTaskId(parseTasks(fixture('tasks-messy.md')))).toBe('T-012')
  })
  it('starts at T-001 for an empty doc', () => {
    expect(nextTaskId(parseTasks(''))).toBe('T-001')
  })
})
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `npx vitest run src/tasks/__tests__/roundtrip.test.ts`
Expected: FAIL — cannot resolve `../parse.js`.

- [ ] **Step 4: Implement src/tasks/types.ts**

```ts
export type TaskStatus = 'todo' | 'in-progress' | 'done'

export interface Task {
  id: string
  status: TaskStatus
  title: string
  tags: string[]
  doneDate: string | null
  note: string | null
}

export interface ProgressEntry { raw: string }

export interface TasksDoc {
  title: string
  tasks: Task[]
  progress: ProgressEntry[]
  preamble: string[]
}

export const SECTION_FOR_STATUS: Record<TaskStatus, string> = {
  todo: 'Todo',
  'in-progress': 'In progress',
  done: 'Done',
}

export const CHECKBOX_FOR_STATUS: Record<TaskStatus, string> = {
  todo: ' ',
  'in-progress': '~',
  done: 'x',
}
```

- [ ] **Step 5: Implement src/tasks/parse.ts**

```ts
import type { Task, TaskStatus, TasksDoc } from './types.js'

const STATUS_FOR_CHECKBOX: Record<string, TaskStatus> = { ' ': 'todo', '~': 'in-progress', x: 'done', X: 'done' }

/** `- [ ] **T-003** Title `#tag` (note)` — checkbox and id are the only required parts. */
const TASK_RE = /^-\s*\[([ ~xX])\]\s*\*\*(T-\d+)\*\*\s*(.*)$/
const TAG_RE = /`#([a-zA-Z0-9_-]+)`/g
const DATE_RE = /\((\d{4}-\d{2}-\d{2})\)\s*$/
const NOTE_RE = /\(([^)]*)\)\s*$/

function parseTaskLine(line: string, sectionStatus: TaskStatus | null): Task | null {
  const m = TASK_RE.exec(line.trim())
  if (!m) return null
  const [, box, id, rest = ''] = m

  const tags = [...rest.matchAll(TAG_RE)].map(t => t[1]!)
  let body = rest.replace(TAG_RE, ' ')

  const dateMatch = DATE_RE.exec(body)
  let doneDate: string | null = null
  let note: string | null = null
  if (dateMatch) {
    doneDate = dateMatch[1]!
    body = body.slice(0, dateMatch.index)
  } else {
    const noteMatch = NOTE_RE.exec(body)
    if (noteMatch) { note = noteMatch[1]!.trim(); body = body.slice(0, noteMatch.index) }
  }

  return {
    id: id!,
    // The checkbox is authoritative; the section heading is a fallback for hand-edited files.
    status: STATUS_FOR_CHECKBOX[box!] ?? sectionStatus ?? 'todo',
    title: body.replace(/\s+/g, ' ').trim(),
    tags,
    doneDate,
    note,
  }
}

export function parseTasks(markdown: string): TasksDoc {
  const doc: TasksDoc = { title: 'Tasks', tasks: [], progress: [], preamble: [] }
  let section: 'todo' | 'in-progress' | 'done' | 'progress' | null = null
  let sawSection = false

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()

    if (trimmed.startsWith('# ')) { doc.title = trimmed.slice(2).trim(); continue }

    if (trimmed.startsWith('## ')) {
      sawSection = true
      const heading = trimmed.slice(3).trim().toLowerCase()
      section = heading === 'todo' ? 'todo'
        : heading === 'in progress' ? 'in-progress'
        : heading === 'done' ? 'done'
        : heading === 'progress log' ? 'progress'
        : null
      continue
    }

    if (trimmed.length === 0) continue

    if (section === 'progress') {
      if (trimmed.startsWith('- ')) doc.progress.push({ raw: trimmed.slice(2).trim() })
      continue
    }
    if (section === null) {
      if (!sawSection) doc.preamble.push(trimmed)
      continue
    }

    const task = parseTaskLine(line, section)
    if (task) doc.tasks.push(task)
  }

  return doc
}

export function nextTaskId(doc: TasksDoc): string {
  const highest = doc.tasks.reduce((max, t) => Math.max(max, Number(t.id.slice(2))), 0)
  return `T-${String(highest + 1).padStart(3, '0')}`
}
```

- [ ] **Step 6: Implement src/tasks/serialize.ts**

```ts
import { CHECKBOX_FOR_STATUS, SECTION_FOR_STATUS, type Task, type TaskStatus, type TasksDoc } from './types.js'

const ORDER: TaskStatus[] = ['todo', 'in-progress', 'done']

function serializeTask(task: Task): string {
  const parts = [`- [${CHECKBOX_FOR_STATUS[task.status]}] **${task.id}** ${task.title}`.trimEnd()]
  for (const tag of task.tags) parts.push(`\`#${tag}\``)
  if (task.doneDate) parts.push(`(${task.doneDate})`)
  else if (task.note) parts.push(`(${task.note})`)
  return parts.join(' ')
}

export function serializeTasks(doc: TasksDoc): string {
  const out: string[] = [`# ${doc.title}`, '']

  for (const line of doc.preamble) out.push(line, '')

  for (const status of ORDER) {
    out.push(`## ${SECTION_FOR_STATUS[status]}`, '')
    for (const task of doc.tasks.filter(t => t.status === status)) out.push(serializeTask(task))
    out.push('')
  }

  out.push('## Progress log', '')
  for (const entry of doc.progress) out.push(`- ${entry.raw}`)
  out.push('')

  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}
```

- [ ] **Step 7: Run the test and verify it passes**

Run: `npx vitest run src/tasks/__tests__/roundtrip.test.ts`
Expected: PASS (11 tests). If round-trip fails, the fix belongs in `serialize.ts` — the parser must stay tolerant. Note that round-trip reorders tasks into section order and normalizes whitespace; that is intended and is why the test compares *parsed structures*, not raw text, for the messy fixture.

- [ ] **Step 8: Lint, update TASKS.md, commit**

```bash
npm test && npm run lint
git add -A
git commit -m "feat(tasks): tasks.md parser and serializer with round-trip guarantee"
```

---

## Task 9 (T-009): Task store, task API, and the task board

**Files:**
- Create: `src/tasks/store.ts`, `src/tasks/__tests__/store.test.ts`, `src/server/routes/tasks.ts`, `web/src/project/ProjectView.tsx`, `web/src/project/TaskBoard.tsx`, `web/src/project/NewTaskForm.tsx`
- Modify: `src/server/index.ts`, `web/src/App.tsx`, `web/src/overview/ProjectCard.tsx`

**Interfaces:**
- Consumes: `parseTasks`, `serializeTasks`, `nextTaskId`, `TasksDoc`, `Task`.
- Produces:
  ```ts
  class TaskStore {
    constructor(projectPath: string)                       // reads/writes <projectPath>/TASKS.md
    read(): Promise<TasksDoc>
    addTask(input: { title: string; tags?: string[] }): Promise<Task>
    updateTask(id: string, patch: { status?: TaskStatus; title?: string; tags?: string[]; note?: string | null }): Promise<Task>
    appendProgress(line: string): Promise<void>
  }
  ```
  Every mutation re-reads the file first (an agent may have edited it), applies the change, and writes the whole document back. Last-writer-wins with a re-read immediately before the write is the documented v1 behaviour (SPEC §7).

- [ ] **Step 1: Write the failing store test**

`src/tasks/__tests__/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskStore } from '../store.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mc-tasks-')) })

describe('TaskStore', () => {
  it('returns an empty doc when TASKS.md does not exist', async () => {
    const doc = await new TaskStore(dir).read()
    expect(doc.tasks).toEqual([])
  })

  it('creates TASKS.md on first add with a sequential id', async () => {
    const store = new TaskStore(dir)
    const task = await store.addTask({ title: 'First thing', tags: ['p1'] })
    expect(task.id).toBe('T-001')
    expect(task.status).toBe('todo')
    const raw = await readFile(join(dir, 'TASKS.md'), 'utf8')
    expect(raw).toContain('- [ ] **T-001** First thing `#p1`')
  })

  it('never reuses an id, even after a task is deleted from the file by hand', async () => {
    const store = new TaskStore(dir)
    await store.addTask({ title: 'One' })
    await store.addTask({ title: 'Two' })
    await writeFile(join(dir, 'TASKS.md'), `# Tasks\n\n## Todo\n\n- [ ] **T-002** Two\n\n## In progress\n\n## Done\n\n## Progress log\n`)
    const third = await store.addTask({ title: 'Three' })
    expect(third.id).toBe('T-003')
  })

  it('moves a task between sections when its status changes', async () => {
    const store = new TaskStore(dir)
    await store.addTask({ title: 'Move me' })
    const updated = await store.updateTask('T-001', { status: 'in-progress' })
    expect(updated.status).toBe('in-progress')
    const raw = await readFile(join(dir, 'TASKS.md'), 'utf8')
    expect(raw).toMatch(/## In progress\n\n- \[~\] \*\*T-001\*\* Move me/)
  })

  it('stamps a date when a task is marked done', async () => {
    const store = new TaskStore(dir)
    await store.addTask({ title: 'Finish me' })
    const done = await store.updateTask('T-001', { status: 'done' })
    expect(done.doneDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('rejects an unknown task id', async () => {
    const store = new TaskStore(dir)
    await expect(store.updateTask('T-999', { status: 'done' })).rejects.toThrow(/unknown task/i)
  })

  it('prepends progress log lines so newest is first', async () => {
    const store = new TaskStore(dir)
    await store.addTask({ title: 'X' })
    await store.appendProgress('2026-08-12 10:00 T-001 — started')
    await store.appendProgress('2026-08-12 11:00 T-001 — finished')
    const doc = await store.read()
    expect(doc.progress[0]!.raw).toContain('finished')
  })

  it('picks up an external edit made between two reads', async () => {
    const store = new TaskStore(dir)
    await store.addTask({ title: 'Mine' })
    const raw = await readFile(join(dir, 'TASKS.md'), 'utf8')
    await writeFile(join(dir, 'TASKS.md'), raw.replace('- [ ] **T-001** Mine', '- [ ] **T-001** Mine\n- [ ] **T-005** Theirs'))
    const added = await store.addTask({ title: 'Next' })
    expect(added.id).toBe('T-006')          // respects the externally added T-005
    const doc = await store.read()
    expect(doc.tasks.map(t => t.id)).toContain('T-005')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/tasks/__tests__/store.test.ts`
Expected: FAIL — cannot resolve `../store.js`.

- [ ] **Step 3: Implement src/tasks/store.ts**

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nextTaskId, parseTasks } from './parse.js'
import { serializeTasks } from './serialize.js'
import type { Task, TaskStatus, TasksDoc } from './types.js'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export class TaskStore {
  readonly filePath: string

  constructor(projectPath: string) {
    this.filePath = join(projectPath, 'TASKS.md')
  }

  async read(): Promise<TasksDoc> {
    const raw = await readFile(this.filePath, 'utf8').catch(() => '')
    return parseTasks(raw)
  }

  async addTask(input: { title: string; tags?: string[] }): Promise<Task> {
    // Re-read first: a Claude Code session may have edited the file since we last looked.
    const doc = await this.read()
    const task: Task = {
      id: nextTaskId(doc),
      status: 'todo',
      title: input.title.trim(),
      tags: input.tags ?? [],
      doneDate: null,
      note: null,
    }
    doc.tasks.push(task)
    await this.#write(doc)
    return task
  }

  async updateTask(
    id: string,
    patch: { status?: TaskStatus; title?: string; tags?: string[]; note?: string | null },
  ): Promise<Task> {
    const doc = await this.read()
    const task = doc.tasks.find(t => t.id === id)
    if (!task) throw new Error(`unknown task ${id}`)

    if (patch.title !== undefined) task.title = patch.title.trim()
    if (patch.tags !== undefined) task.tags = patch.tags
    if (patch.note !== undefined) task.note = patch.note
    if (patch.status !== undefined) {
      task.status = patch.status
      task.doneDate = patch.status === 'done' ? (task.doneDate ?? today()) : null
      if (patch.status === 'done') task.note = null   // the date takes the trailing slot
    }

    await this.#write(doc)
    return task
  }

  async appendProgress(line: string): Promise<void> {
    const doc = await this.read()
    doc.progress.unshift({ raw: line.trim() })   // newest first, per the format rules
    await this.#write(doc)
  }

  async #write(doc: TasksDoc): Promise<void> {
    await writeFile(this.filePath, serializeTasks(doc), 'utf8')
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/tasks/__tests__/store.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Add the task routes**

`src/server/routes/tasks.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { TaskStore } from '../../tasks/store.js'
import type { TaskStatus } from '../../tasks/types.js'
import type { ProjectRegistry } from '../registry.js'

const VALID_STATUS: TaskStatus[] = ['todo', 'in-progress', 'done']

export function registerTaskRoutes(
  app: FastifyInstance,
  registry: ProjectRegistry,
  onChange: (projectId: string) => void,
): void {
  const storeFor = (id: string) => {
    const project = registry.byId(id)
    return project ? new TaskStore(project.path) : null
  }

  app.get<{ Params: { id: string } }>('/api/projects/:id/tasks', async (req, reply) => {
    const store = storeFor(req.params.id)
    if (!store) return reply.code(404).send({ error: 'unknown project' })
    return { doc: await store.read() }
  })

  app.post<{ Params: { id: string }; Body: { title?: string; tags?: string[] } }>(
    '/api/projects/:id/tasks', async (req, reply) => {
      const store = storeFor(req.params.id)
      if (!store) return reply.code(404).send({ error: 'unknown project' })
      const title = req.body?.title
      if (typeof title !== 'string' || title.trim().length === 0) {
        return reply.code(400).send({ error: 'title is required' })
      }
      const task = await store.addTask({ title, tags: req.body?.tags ?? [] })
      onChange(req.params.id)
      return { task }
    })

  app.patch<{ Params: { id: string; taskId: string }; Body: { status?: string; title?: string; tags?: string[] } }>(
    '/api/projects/:id/tasks/:taskId', async (req, reply) => {
      const store = storeFor(req.params.id)
      if (!store) return reply.code(404).send({ error: 'unknown project' })
      const status = req.body?.status
      if (status !== undefined && !VALID_STATUS.includes(status as TaskStatus)) {
        return reply.code(400).send({ error: `status must be one of ${VALID_STATUS.join(', ')}` })
      }
      try {
        const task = await store.updateTask(req.params.taskId, {
          ...(status !== undefined ? { status: status as TaskStatus } : {}),
          ...(req.body?.title !== undefined ? { title: req.body.title } : {}),
          ...(req.body?.tags !== undefined ? { tags: req.body.tags } : {}),
        })
        onChange(req.params.id)
        return { task }
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message })
      }
    })
}
```

Register it in `src/server/index.ts`, passing an `onChange` that reads the doc and broadcasts `task.updated`.

- [ ] **Step 6: Build the task board UI**

`web/src/project/NewTaskForm.tsx`:
```tsx
import { useState } from 'react'

export function NewTaskForm({ onCreate }: { onCreate: (title: string, tags: string[]) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = title.trim()
    if (trimmed.length === 0 || busy) return
    setBusy(true)
    // Tags are typed inline as #tag and stripped out of the title.
    const tags = [...trimmed.matchAll(/#([a-zA-Z0-9_-]+)/g)].map(m => m[1]!)
    try {
      await onCreate(trimmed.replace(/#[a-zA-Z0-9_-]+/g, '').replace(/\s+/g, ' ').trim(), tags)
      setTitle('')
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        data-testid="new-task-input"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="New task… (use #tags)"
        className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
      />
      <button
        data-testid="new-task-submit"
        disabled={busy || title.trim().length === 0}
        className="rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
      >
        Add
      </button>
    </form>
  )
}
```

`web/src/project/TaskBoard.tsx`:
```tsx
import type { Task, TaskStatus, TasksDoc } from '../shared/types.js'

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'Todo' },
  { status: 'in-progress', label: 'In progress' },
  { status: 'done', label: 'Done' },
]

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: 'in-progress', 'in-progress': 'done', done: 'todo',
}

export function TaskBoard(
  { doc, onAdvance, onDispatch }:
  { doc: TasksDoc; onAdvance: (task: Task) => void; onDispatch?: (task: Task) => void },
) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {COLUMNS.map(col => (
        <section key={col.status} data-testid={`column-${col.status}`}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">{col.label}</h3>
          <div className="space-y-2">
            {doc.tasks.filter(t => t.status === col.status).map(task => (
              <article key={task.id} data-testid="task-card"
                className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => onAdvance(task)}
                    title={`Move to ${NEXT_STATUS[task.status]}`}
                    className="mt-0.5 font-mono text-xs text-neutral-500 hover:text-neutral-200"
                  >
                    {task.status === 'done' ? '[x]' : task.status === 'in-progress' ? '[~]' : '[ ]'}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-200">
                      <span className="font-mono text-xs text-neutral-500">{task.id}</span> {task.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {task.tags.map(tag => (
                        <span key={tag} className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">#{tag}</span>
                      ))}
                      {task.doneDate && <span className="text-xs text-neutral-600">{task.doneDate}</span>}
                    </div>
                  </div>
                  {onDispatch && task.status !== 'done' && (
                    <button
                      data-testid="dispatch-button"
                      onClick={() => onDispatch(task)}
                      className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                    >
                      Run
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
export { NEXT_STATUS }
```

`web/src/project/ProjectView.tsx` fetches `GET /api/projects/:id/tasks`, renders `NewTaskForm` + `TaskBoard` on the left and the project's session list on the right, and calls `PATCH`/`POST` then refetches. Wire navigation from `ProjectCard` (make the card header clickable) through `App.tsx`.

- [ ] **Step 7: Verify live in the browser**

Run `npm run dev`. With Chrome DevTools MCP: open a project, type `Test task from dashboard #p3` into `[data-testid="new-task-input"]`, click Add, and confirm a card appears in the Todo column with the `#p3` chip and the title without the tag. Then click the checkbox to advance it to In progress. Confirm on disk:
```bash
grep -n 'Test task from dashboard' TASKS.md
```
Expected: a `- [~] **T-0NN** Test task from dashboard \`#p3\`` line under `## In progress`. Screenshot to `.tmp/t009-taskboard.png`. Remove the test task afterwards.

- [ ] **Step 8: Lint, update TASKS.md, commit**

```bash
npm test && npm run lint
git add -A
git commit -m "feat(tasks): task store, rest endpoints and board ui"
```

---

## Task 10 (T-010): Watch TASKS.md and push task.updated

**Files:**
- Create: `src/server/watcher/tasks-watcher.ts`
- Modify: `src/server/index.ts`, `web/src/shared/useLiveState.ts`, `web/src/project/ProjectView.tsx`

**Interfaces:**
- Produces:
  ```ts
  class TasksWatcher extends EventEmitter {   // emits 'tasks' with { projectId, doc }
    constructor(registry: ProjectRegistry)
    start(): Promise<void>
    stop(): Promise<void>
  }
  ```

- [ ] **Step 1: Implement the watcher**

`src/server/watcher/tasks-watcher.ts`:
```ts
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { TaskStore } from '../../tasks/store.js'
import type { ProjectRegistry } from '../registry.js'

const DEBOUNCE_MS = 200

export class TasksWatcher extends EventEmitter {
  #watcher: FSWatcher | null = null
  #timers = new Map<string, NodeJS.Timeout>()

  constructor(private readonly registry: ProjectRegistry) { super() }

  async start(): Promise<void> {
    const paths = this.registry.list().map(p => join(p.path, 'TASKS.md'))
    if (paths.length === 0) return
    this.#watcher = chokidar.watch(paths, { ignoreInitial: true, alwaysStat: true })
    this.#watcher.on('add', p => this.#schedule(p))
    this.#watcher.on('change', p => this.#schedule(p))
  }

  /** Registry changes at runtime, so the watch set is rebuilt rather than patched. */
  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async stop(): Promise<void> {
    for (const t of this.#timers.values()) clearTimeout(t)
    this.#timers.clear()
    await this.#watcher?.close()
    this.#watcher = null
  }

  #schedule(filePath: string): void {
    const existing = this.#timers.get(filePath)
    if (existing) clearTimeout(existing)
    this.#timers.set(filePath, setTimeout(() => {
      this.#timers.delete(filePath)
      void this.#emitDoc(filePath)
    }, DEBOUNCE_MS))
  }

  async #emitDoc(filePath: string): Promise<void> {
    const project = this.registry.list().find(p => join(p.path, 'TASKS.md') === filePath)
    if (!project) return
    const doc = await new TaskStore(project.path).read()
    this.emit('tasks', { projectId: project.id, doc })
  }
}
```

- [ ] **Step 2: Wire it into the server**

In `src/server/index.ts`: construct `new TasksWatcher(registry)`, `await tasksWatcher.start()`, subscribe `tasksWatcher.on('tasks', ({ projectId, doc }) => hub.broadcast({ type: 'task.updated', projectId, doc }))`, call `tasksWatcher.restart()` after a successful `POST /api/projects`, and stop it in the `onClose` hook. Also make the snapshot include tasks: read each registered project's doc at snapshot time.

Note: the dashboard's own writes (Task 9) already broadcast via `onChange`; the watcher will fire a second, identical event moments later. That is harmless — the client replaces the doc wholesale.

- [ ] **Step 3: Consume task.updated on the client**

Extend `useLiveState` to hold `tasks: Record<string, TasksDoc>`, populate it from the snapshot, and replace one project's doc on `task.updated`. `ProjectView` reads from that state instead of refetching after every mutation.

- [ ] **Step 4: Verify live in the browser**

Run `npm run dev` and open a project view in the browser. In a terminal, hand-edit that project's `TASKS.md` (add a task line under `## Todo`). Within a second the card must appear in the browser without a reload — verify with a Chrome DevTools MCP snapshot. Screenshot to `.tmp/t010-tasks-live.png`. Revert the hand edit.

- [ ] **Step 5: Lint, update TASKS.md, commit**

```bash
npm test && npm run lint
git add -A
git commit -m "feat(tasks): watch tasks.md and push task.updated over websocket"
```

---

## Task 11 (T-011): Dispatcher

**Files:**
- Create: `src/server/dispatcher/index.ts`, `src/server/dispatcher/__tests__/dispatcher.test.ts`, `src/server/routes/dispatch.ts`, `test/fixtures/fake-claude.mjs`
- Modify: `src/server/index.ts`

**Interfaces:**
- Produces:
  ```ts
  interface RunHandle {
    runId: string; projectId: string; taskId: string
    sessionId: string | null; status: 'starting' | 'running' | 'succeeded' | 'failed' | 'cancelled'
    startedAt: string; endedAt: string | null; exitCode: number | null
  }
  class Dispatcher extends EventEmitter {   // emits 'output' {runId, chunk}, 'update' RunHandle
    constructor(opts?: { claudeBin?: string; timeoutMs?: number })
    start(input: { projectId: string; projectPath: string; taskId: string; prompt: string }): RunHandle
    cancel(runId: string): boolean
    list(): RunHandle[]
  }
  ```
  One concurrent run per project — `start` throws if that project already has a live run.

- [ ] **Step 1: Write a fake claude binary for tests**

`test/fixtures/fake-claude.mjs`:
```js
#!/usr/bin/env node
// Stands in for `claude -p --output-format stream-json` in tests.
// Emits startup noise BEFORE the init event, so the dispatcher must scan for it.
const args = process.argv.slice(2)
const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok'

console.log(JSON.stringify({ type: 'system', subtype: 'hook_started', hook: 'SessionStart' }))
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-session-123', model: 'claude-fable-5' }))
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `args:${args.length}` }] } }))

if (mode === 'crash') { process.exit(3) }
if (mode === 'hang') { setInterval(() => {}, 1000); return }

console.log(JSON.stringify({ type: 'result', subtype: 'success', session_id: 'fake-session-123', total_cost_usd: 0.01 }))
process.exit(0)
```

- [ ] **Step 2: Write the failing test**

`src/server/dispatcher/__tests__/dispatcher.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { Dispatcher } from '../index.js'

const FAKE = fileURLToPath(new URL('../../../../test/fixtures/fake-claude.mjs', import.meta.url))

function makeDispatcher(timeoutMs = 5000) {
  return new Dispatcher({ claudeBin: process.execPath, extraArgs: [FAKE], timeoutMs })
}

const input = { projectId: 'p1', projectPath: tmpdir(), taskId: 'T-001', prompt: 'do the thing' }

function ended(d: Dispatcher, runId: string) {
  return new Promise<void>(resolve => {
    d.on('update', (h: { runId: string; endedAt: string | null }) => {
      if (h.runId === runId && h.endedAt !== null) resolve()
    })
  })
}

describe('Dispatcher', () => {
  it('captures the session id from the init event, not the first line', async () => {
    const d = makeDispatcher()
    const handle = d.start(input)
    await ended(d, handle.runId)
    expect(d.list()[0]!.sessionId).toBe('fake-session-123')
  })

  it('streams output chunks as they arrive', async () => {
    const d = makeDispatcher()
    const chunks: string[] = []
    d.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const handle = d.start(input)
    await ended(d, handle.runId)
    expect(chunks.join('')).toContain('fake-session-123')
  })

  it('marks a clean exit as succeeded', async () => {
    const d = makeDispatcher()
    const handle = d.start(input)
    await ended(d, handle.runId)
    expect(d.list()[0]!.status).toBe('succeeded')
    expect(d.list()[0]!.exitCode).toBe(0)
  })

  it('marks a non-zero exit as failed', async () => {
    process.env.FAKE_CLAUDE_MODE = 'crash'
    const d = makeDispatcher()
    const handle = d.start(input)
    await ended(d, handle.runId)
    expect(d.list()[0]!.status).toBe('failed')
    delete process.env.FAKE_CLAUDE_MODE
  })

  it('refuses a second concurrent run for the same project', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher()
    const first = d.start(input)
    expect(() => d.start(input)).toThrow(/already running/i)
    d.cancel(first.runId)
    delete process.env.FAKE_CLAUDE_MODE
  })

  it('allows a run in a different project at the same time', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher()
    const a = d.start(input)
    const b = d.start({ ...input, projectId: 'p2' })
    expect(d.list()).toHaveLength(2)
    d.cancel(a.runId); d.cancel(b.runId)
    delete process.env.FAKE_CLAUDE_MODE
  })

  it('cancels a hanging run', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher()
    const handle = d.start(input)
    const done = ended(d, handle.runId)
    expect(d.cancel(handle.runId)).toBe(true)
    await done
    expect(d.list()[0]!.status).toBe('cancelled')
    delete process.env.FAKE_CLAUDE_MODE
  })

  it('kills a run that exceeds the supervisor timeout', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher(300)
    const handle = d.start(input)
    await ended(d, handle.runId)
    expect(d.list()[0]!.status).toBe('cancelled')
    delete process.env.FAKE_CLAUDE_MODE
  }, 10_000)

  it('passes the prompt as a single argv element', async () => {
    const d = makeDispatcher()
    const chunks: string[] = []
    d.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const handle = d.start({ ...input, prompt: 'rm -rf / ; echo pwned' })
    await ended(d, handle.runId)
    // fake-claude echoes its argv count; the prompt must be exactly one element.
    expect(chunks.join('')).toContain('args:')
  })
})
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `npx vitest run src/server/dispatcher/__tests__/dispatcher.test.ts`
Expected: FAIL — cannot resolve `../index.js`.

- [ ] **Step 4: Implement src/server/dispatcher/index.ts**

```ts
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export type RunStatus = 'starting' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface RunHandle {
  runId: string
  projectId: string
  taskId: string
  sessionId: string | null
  status: RunStatus
  startedAt: string
  endedAt: string | null
  exitCode: number | null
}

interface Run extends RunHandle {
  child: ChildProcess
  timer: NodeJS.Timeout
  buffer: string
}

export interface DispatcherOptions {
  claudeBin?: string
  /** Injected before the real flags — the test harness uses it to run a fake binary. */
  extraArgs?: string[]
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

export class Dispatcher extends EventEmitter {
  #runs = new Map<string, Run>()
  #bin: string
  #extraArgs: string[]
  #timeoutMs: number

  constructor(opts: DispatcherOptions = {}) {
    super()
    this.#bin = opts.claudeBin ?? 'claude'
    this.#extraArgs = opts.extraArgs ?? []
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  list(): RunHandle[] {
    return [...this.#runs.values()].map(({ child: _c, timer: _t, buffer: _b, ...handle }) => handle)
  }

  start(input: { projectId: string; projectPath: string; taskId: string; prompt: string }): RunHandle {
    const live = [...this.#runs.values()].find(
      r => r.projectId === input.projectId && r.endedAt === null,
    )
    if (live) throw new Error(`a run is already running for project ${input.projectId}`)

    const runId = randomUUID()
    // Prompt is a single argv element — never interpolated into a shell string.
    // No --bare: the target project's CLAUDE.md and hooks must load.
    const args = [
      ...this.#extraArgs,
      '-p', input.prompt,
      '--output-format', 'stream-json',
      '--verbose',
    ]
    const child = spawn(this.#bin, args, {
      cwd: input.projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    const run: Run = {
      runId,
      projectId: input.projectId,
      taskId: input.taskId,
      sessionId: null,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      child,
      buffer: '',
      timer: setTimeout(() => this.cancel(runId), this.#timeoutMs),
    }
    this.#runs.set(runId, run)

    // Consume stdout eagerly: a slow consumer stalls claude's output.
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      this.emit('output', { runId, chunk })
      this.#scanForSessionId(run, chunk)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => this.emit('output', { runId, chunk }))

    child.on('error', () => this.#finish(run, null, 'failed'))
    child.on('close', code => {
      if (run.status === 'cancelled') this.#finish(run, code, 'cancelled')
      else this.#finish(run, code, code === 0 ? 'succeeded' : 'failed')
    })

    this.#update(run)
    return this.#handle(run)
  }

  cancel(runId: string): boolean {
    const run = this.#runs.get(runId)
    if (!run || run.endedAt !== null) return false
    run.status = 'cancelled'
    // SIGTERM aborts the turn cleanly, kills the child's process tree and runs SessionEnd hooks.
    run.child.kill('SIGTERM')
    return true
  }

  /** The init event carries session_id but is NOT guaranteed to be the first line. */
  #scanForSessionId(run: Run, chunk: string): void {
    if (run.sessionId !== null) return
    run.buffer += chunk
    const lines = run.buffer.split('\n')
    run.buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim().length === 0) continue
      try {
        const msg = JSON.parse(line) as { type?: string; subtype?: string; session_id?: string }
        if (msg.session_id && (msg.subtype === 'init' || run.sessionId === null)) {
          run.sessionId = msg.session_id
          this.#update(run)
          return
        }
      } catch { /* partial or non-JSON output is expected; keep scanning */ }
    }
  }

  #finish(run: Run, code: number | null, status: RunStatus): void {
    if (run.endedAt !== null) return
    clearTimeout(run.timer)
    run.endedAt = new Date().toISOString()
    run.exitCode = code
    run.status = status
    this.#update(run)
  }

  #handle(run: Run): RunHandle {
    const { child: _c, timer: _t, buffer: _b, ...handle } = run
    return handle
  }

  #update(run: Run): void {
    this.emit('update', this.#handle(run))
  }
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npx vitest run src/server/dispatcher/__tests__/dispatcher.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Add the dispatch route and stream to the UI**

`src/server/routes/dispatch.ts` exposes:
- `POST /api/projects/:id/tasks/:taskId/dispatch` — looks up the project and task, builds the prompt (Task 12 owns the template), calls `dispatcher.start`, returns the `RunHandle`; 409 if a run is already live for the project.
- `GET /api/runs` — `dispatcher.list()`.
- `POST /api/runs/:runId/cancel` — `dispatcher.cancel`.

In `src/server/index.ts`, forward dispatcher events to the hub:
```ts
dispatcher.on('output', ({ runId, chunk }) => hub.broadcast({ type: 'dispatch.output', runId, chunk }))
dispatcher.on('update', handle => hub.broadcast({ type: 'dispatch.updated', run: handle }))
```
Add `dispatch.updated` to the `ServerEvent` union.

- [ ] **Step 7: Lint, update TASKS.md, commit**

```bash
npm test && npm run lint
git add -A
git commit -m "feat(dispatcher): headless claude runs with session capture and cancellation"
```

---

## Task 12 (T-012): "Run with Claude" button and live run output

**Files:**
- Create: `src/server/dispatcher/prompt.ts`, `src/server/dispatcher/__tests__/prompt.test.ts`, `web/src/project/RunPanel.tsx`
- Modify: `src/server/routes/dispatch.ts`, `web/src/project/ProjectView.tsx`, `web/src/shared/useLiveState.ts`

**Interfaces:**
- Produces: `buildTaskPrompt(task: Task): string` from `src/server/dispatcher/prompt.ts`.

- [ ] **Step 1: Write the failing prompt test**

`src/server/dispatcher/__tests__/prompt.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildTaskPrompt } from '../prompt.js'
import type { Task } from '../../../tasks/types.js'

const task: Task = {
  id: 'T-042', status: 'todo', title: 'Add dark mode toggle',
  tags: ['ui', 'p2'], doneDate: null, note: null,
}

describe('buildTaskPrompt', () => {
  it('names the task id so the agent can find it in TASKS.md', () => {
    expect(buildTaskPrompt(task)).toContain('T-042')
  })

  it('includes the title as context', () => {
    expect(buildTaskPrompt(task)).toContain('Add dark mode toggle')
  })

  it('instructs the agent to update TASKS.md when done', () => {
    const prompt = buildTaskPrompt(task).toLowerCase()
    expect(prompt).toContain('tasks.md')
    expect(prompt).toContain('progress log')
  })

  it('is a single string with no shell metacharacter escaping needed', () => {
    const nasty: Task = { ...task, title: 'Fix `rm -rf $(pwd)` handling; see #1' }
    const prompt = buildTaskPrompt(nasty)
    expect(typeof prompt).toBe('string')
    expect(prompt).toContain('Fix `rm -rf $(pwd)` handling; see #1')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/server/dispatcher/__tests__/prompt.test.ts`
Expected: FAIL — cannot resolve `../prompt.js`.

- [ ] **Step 3: Implement src/server/dispatcher/prompt.ts**

```ts
import type { Task } from '../../tasks/types.js'

/**
 * The prompt is passed to claude as a single argv element, so the task text
 * needs no escaping — it is never interpreted by a shell.
 */
export function buildTaskPrompt(task: Task): string {
  const tags = task.tags.length > 0 ? ` (tags: ${task.tags.map(t => `#${t}`).join(' ')})` : ''
  return [
    `Work on task ${task.id} from TASKS.md in this repository.`,
    ``,
    `${task.id}: ${task.title}${tags}`,
    ``,
    `Follow the task workflow in CLAUDE.md: move ${task.id} to In progress with [~] before you start,`,
    `append a line to the Progress log after each meaningful milestone, and when the work is finished`,
    `move ${task.id} to Done with [x] and today's date plus a final Progress log line.`,
  ].join('\n')
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/server/dispatcher/__tests__/prompt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Use it in the dispatch route**

In `src/server/routes/dispatch.ts`, read the project's `TasksDoc`, find the task by id (404 if absent), and pass `buildTaskPrompt(task)` to `dispatcher.start`. Before starting, set the task to `in-progress` via `TaskStore.updateTask` so the board reflects the run immediately.

- [ ] **Step 6: Build the run panel**

`web/src/project/RunPanel.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import type { RunHandle } from '../shared/types.js'

const STATUS_LABEL: Record<string, string> = {
  running: 'running', succeeded: 'succeeded', failed: 'failed',
  cancelled: 'cancelled', starting: 'starting',
}

export function RunPanel(
  { run, output, onCancel }:
  { run: RunHandle; output: string; onCancel: (runId: string) => void },
) {
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => { bottom.current?.scrollIntoView() }, [output])

  return (
    <section data-testid="run-panel" className="rounded-xl border border-neutral-800 bg-neutral-900/60">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-xs">
        <span className="font-mono text-neutral-400">{run.taskId}</span>
        <span data-testid="run-status" className="text-neutral-500">{STATUS_LABEL[run.status] ?? run.status}</span>
        {run.sessionId && <span className="truncate font-mono text-neutral-600">{run.sessionId}</span>}
        {run.endedAt === null && (
          <button onClick={() => onCancel(run.runId)}
            className="ml-auto rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800">
            Cancel
          </button>
        )}
      </header>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs text-neutral-400">
        {output || '(waiting for output…)'}
        <div ref={bottom} />
      </pre>
    </section>
  )
}
```

Extend `useLiveState` with `runs: RunHandle[]` and `runOutput: Record<string, string>`, appending on `dispatch.output` and replacing on `dispatch.updated`. Cap each run's retained output at ~200 KB (slice from the front) so a long run cannot grow the tab's memory without bound. `ProjectView` renders a `RunPanel` per live run and passes `onDispatch` into `TaskBoard`.

- [ ] **Step 7: Verify a real dispatch end to end**

Create a throwaway task in a scratch project (not this repo) — e.g. `Create a file HELLO.md containing the word hello`. Run `npm run dev`, open that project, click Run. With Chrome DevTools MCP confirm: the task moves to In progress, a run panel appears, output streams in, the session id fills in, and the status ends `succeeded`. Confirm `HELLO.md` exists and the agent updated that project's `TASKS.md`. Screenshot to `.tmp/t012-dispatch.png`.

Then test cancellation: dispatch a long task, click Cancel, confirm the status becomes `cancelled` and the `claude` process is gone (`pgrep -f 'claude -p'` returns nothing).

- [ ] **Step 8: Lint, update TASKS.md, commit**

```bash
npm test && npm run lint
git add -A
git commit -m "feat(dispatch): run-with-claude button with streamed run output"
```

---

## Task 13 (T-013): Hook sink and the fail-silent forwarder

**Files:**
- Create: `scripts/hook-post.sh`, `src/server/routes/hooks.ts`, `src/server/hooks/ingest.ts`, `src/server/hooks/__tests__/ingest.test.ts`
- Modify: `src/server/index.ts`, `src/server/watcher/session-store.ts`

**Interfaces:**
- Produces:
  ```ts
  interface HookEvent {
    hook_event_name: string; session_id: string
    cwd?: string; transcript_path?: string; permission_mode?: string
  }
  function normalizeHookEvent(body: unknown): HookEvent | null
  function applyHookEvent(store: SessionStore, registry: ProjectRegistry, event: HookEvent): SessionSummary | null
  ```
- Modifies `SessionStore` with `markActive(sessionId: string, project: ProjectRecord | null): void` — records a hook-sourced activity timestamp that outranks transcript recency.

- [ ] **Step 1: Write the failing test**

`src/server/hooks/__tests__/ingest.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { normalizeHookEvent, applyHookEvent } from '../ingest.js'
import { SessionStore } from '../../watcher/session-store.js'

afterEach(() => { vi.useRealTimers() })

describe('normalizeHookEvent', () => {
  it('accepts a well-formed hook payload', () => {
    const e = normalizeHookEvent({
      hook_event_name: 'SessionStart', session_id: 's1',
      cwd: '/p', transcript_path: '/t.jsonl',
    })
    expect(e?.session_id).toBe('s1')
    expect(e?.hook_event_name).toBe('SessionStart')
  })

  it('rejects a payload with no session id', () => {
    expect(normalizeHookEvent({ hook_event_name: 'Stop' })).toBeNull()
  })

  it('rejects a payload with no event name', () => {
    expect(normalizeHookEvent({ session_id: 's1' })).toBeNull()
  })

  it('rejects non-object bodies instead of throwing', () => {
    expect(normalizeHookEvent(null)).toBeNull()
    expect(normalizeHookEvent('nope')).toBeNull()
  })

  it('tolerates unknown future event names', () => {
    const e = normalizeHookEvent({ hook_event_name: 'SomeFutureEvent', session_id: 's1' })
    expect(e?.hook_event_name).toBe('SomeFutureEvent')
  })
})

describe('applyHookEvent', () => {
  const registry = { byEscapedDir: () => undefined, list: () => [], byId: () => undefined } as never

  it('makes a session active even with no transcript entries yet', () => {
    const store = new SessionStore()
    const summary = applyHookEvent(store, registry, {
      hook_event_name: 'SessionStart', session_id: 's-new', cwd: '/p',
    })!
    expect(summary.sessionId).toBe('s-new')
    expect(summary.status).toBe('active')
  })

  it('keeps a session active on a hook even when its transcript looks stale', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T12:00:00.000Z'))
    const store = new SessionStore()
    store.apply('s1', [{
      uuid: 'u1', parentUuid: null, sessionId: 's1', timestamp: '2026-08-12T10:00:00.000Z',
      role: 'user', isSidechain: false, cwd: '/p', gitBranch: null, version: null,
      text: 'hi', toolCalls: [], isMeta: false,
    }], { parsed: 1, skippedUnknown: 0, skippedInvalid: 0, versions: [] }, null)
    expect(store.get('s1')!.status).toBe('idle')

    applyHookEvent(store, registry, { hook_event_name: 'PostToolUse', session_id: 's1' })
    expect(store.get('s1')!.status).toBe('active')
  })

  it('marks the session done on SessionEnd', () => {
    const store = new SessionStore()
    applyHookEvent(store, registry, { hook_event_name: 'SessionStart', session_id: 's1' })
    applyHookEvent(store, registry, { hook_event_name: 'SessionEnd', session_id: 's1' })
    expect(store.get('s1')!.status).toBe('done')
  })

  it('does not mark done on Stop — a stopped turn is not a finished session', () => {
    const store = new SessionStore()
    applyHookEvent(store, registry, { hook_event_name: 'SessionStart', session_id: 's1' })
    applyHookEvent(store, registry, { hook_event_name: 'Stop', session_id: 's1' })
    expect(store.get('s1')!.status).toBe('active')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/server/hooks/__tests__/ingest.test.ts`
Expected: FAIL — cannot resolve `../ingest.js`.

- [ ] **Step 3: Extend SessionStore with hook-sourced activity**

In `src/server/watcher/session-store.ts`, add `hookActivity: string | null` to `SessionState` (initialized `null`), add the method:
```ts
  /** A hook fired for this session: authoritative liveness, ahead of transcript recency. */
  markActive(sessionId: string, project: ProjectRecord | null): void {
    const state = this.#state(sessionId)
    if (project) state.project = project
    state.hookActivity = new Date().toISOString()
    state.ended = false
  }
```
and in `#summarize`, compute liveness from the later of the two clocks:
```ts
    const transcriptActivity = last?.timestamp ?? new Date(0).toISOString()
    const lastActivity = state.hookActivity && state.hookActivity > transcriptActivity
      ? state.hookActivity
      : transcriptActivity
```
Then derive `fresh`/`status` from that `lastActivity` as before, and use `first?.timestamp ?? lastActivity` for `startedAt` unchanged.

- [ ] **Step 4: Implement src/server/hooks/ingest.ts**

```ts
import { escapeProjectPath } from '../../shared/config.js'
import type { SessionSummary } from '../../shared/types.js'
import type { ProjectRegistry } from '../registry.js'
import type { SessionStore } from '../watcher/session-store.js'

export interface HookEvent {
  hook_event_name: string
  session_id: string
  cwd?: string
  transcript_path?: string
  permission_mode?: string
}

/** Hook payloads are a documented public interface, but tolerate unknown event names. */
export function normalizeHookEvent(body: unknown): HookEvent | null {
  if (typeof body !== 'object' || body === null) return null
  const obj = body as Record<string, unknown>
  const name = obj.hook_event_name
  const session = obj.session_id
  if (typeof name !== 'string' || name.length === 0) return null
  if (typeof session !== 'string' || session.length === 0) return null

  return {
    hook_event_name: name,
    session_id: session,
    ...(typeof obj.cwd === 'string' ? { cwd: obj.cwd } : {}),
    ...(typeof obj.transcript_path === 'string' ? { transcript_path: obj.transcript_path } : {}),
    ...(typeof obj.permission_mode === 'string' ? { permission_mode: obj.permission_mode } : {}),
  }
}

export function applyHookEvent(
  store: SessionStore,
  registry: ProjectRegistry,
  event: HookEvent,
): SessionSummary | null {
  const project = event.cwd ? registry.byEscapedDir(escapeProjectPath(event.cwd)) ?? null : null

  // SessionEnd is the only event that means the session is finished. Stop merely
  // ends a turn — the session stays alive waiting for the next prompt.
  if (event.hook_event_name === 'SessionEnd') {
    store.markEnded(event.session_id)
  } else {
    store.markActive(event.session_id, project)
  }
  return store.get(event.session_id) ?? null
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npx vitest run src/server/hooks/__tests__/ingest.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Add the sink route**

`src/server/routes/hooks.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { applyHookEvent, normalizeHookEvent } from '../hooks/ingest.js'
import type { ProjectRegistry } from '../registry.js'
import type { SessionStore } from '../watcher/session-store.js'
import type { SessionSummary } from '../../shared/types.js'

export function registerHookRoutes(
  app: FastifyInstance,
  store: SessionStore,
  registry: ProjectRegistry,
  onSession: (summary: SessionSummary) => void,
): void {
  // Always 200, even on garbage: a hook must never see an error that could slow
  // or break the user's Claude Code session.
  app.post('/api/hooks', async (req, reply) => {
    const event = normalizeHookEvent(req.body)
    if (!event) return reply.code(200).send({ ok: false })
    const summary = applyHookEvent(store, registry, event)
    if (summary) onSession(summary)
    return { ok: true }
  })
}
```

Register it in `src/server/index.ts` with `onSession` broadcasting `session.updated`.

- [ ] **Step 7: Write the fail-silent forwarder**

`scripts/hook-post.sh`:
```bash
#!/usr/bin/env bash
# Forwards a Claude Code hook payload to Mission Control.
#
# Non-negotiable: this must never slow down or break a Claude Code session.
# SessionEnd hooks get roughly 1.5s in total, so the 1s cap leaves headroom.
# Every failure path — dashboard down, network hiccup, missing curl — exits 0.

payload=$(cat)

curl -s -o /dev/null --max-time 1 \
  -X POST http://127.0.0.1:4517/api/hooks \
  -H 'content-type: application/json' \
  --data-binary "$payload" 2>/dev/null &

exit 0
```

```bash
chmod +x scripts/hook-post.sh
```

- [ ] **Step 8: Verify the forwarder's failure behaviour**

With **no** server running:
```bash
echo '{"hook_event_name":"Stop","session_id":"x"}' | ./scripts/hook-post.sh; echo "exit=$?"
time (echo '{"hook_event_name":"Stop","session_id":"x"}' | ./scripts/hook-post.sh)
```
Expected: `exit=0`, and real time well under 1 second — the request is backgrounded.

With the server running:
```bash
npm run dev:server &
echo '{"hook_event_name":"SessionStart","session_id":"hook-test-1","cwd":"/Users/ivanhristev/Projects/my-claudia"}' | ./scripts/hook-post.sh
sleep 1
curl -s http://127.0.0.1:4517/api/sessions | jq '.sessions[] | select(.sessionId=="hook-test-1") | .status'
```
Expected: `"active"`. Also confirm a garbage payload still returns 200:
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:4517/api/hooks -H 'content-type: application/json' -d '{"junk":true}'
```
Expected: `200`.

- [ ] **Step 9: Lint, update TASKS.md, commit**

```bash
npm test && npm run lint
git add -A
git commit -m "feat(hooks): fail-silent hook forwarder and event sink"
```

---

## Task 14 (T-014): Hook installer

**Files:**
- Create: `src/server/hooks/installer.ts`, `src/server/hooks/__tests__/installer.test.ts`, `src/server/routes/hook-install.ts`
- Modify: `src/server/index.ts`, `web/src/project/ProjectView.tsx`

**Interfaces:**
- Produces:
  ```ts
  const HOOK_EVENTS = ['SessionStart', 'SessionEnd', 'Stop', 'PostToolUse'] as const
  interface InstallResult { settingsPath: string; backupPath: string | null; installed: string[]; alreadyPresent: string[] }
  function buildHookEntry(scriptPath: string): { type: 'command'; command: string; timeout: number }
  function mergeHooks(existing: unknown, scriptPath: string): { settings: Record<string, unknown>; installed: string[]; alreadyPresent: string[] }
  function installHooks(projectPath: string, scriptPath: string): Promise<InstallResult>
  function isInstalled(projectPath: string, scriptPath: string): Promise<boolean>
  ```

- [ ] **Step 1: Write the failing test**

`src/server/hooks/__tests__/installer.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeHooks, installHooks, isInstalled, HOOK_EVENTS } from '../installer.js'

const SCRIPT = '/opt/mc/scripts/hook-post.sh'
let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mc-install-')) })

describe('mergeHooks', () => {
  it('adds every hook event to empty settings', () => {
    const { settings, installed } = mergeHooks({}, SCRIPT)
    expect(installed).toEqual([...HOOK_EVENTS])
    for (const event of HOOK_EVENTS) {
      expect((settings.hooks as Record<string, unknown>)[event]).toBeDefined()
    }
  })

  it('preserves unrelated settings keys', () => {
    const { settings } = mergeHooks({ model: 'opus', permissions: { allow: ['Bash'] } }, SCRIPT)
    expect(settings.model).toBe('opus')
    expect(settings.permissions).toEqual({ allow: ['Bash'] })
  })

  it("preserves the user's existing hooks for the same event", () => {
    const existing = {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'afplay done.mp3' }] }] },
    }
    const { settings } = mergeHooks(existing, SCRIPT)
    const stop = (settings.hooks as Record<string, { hooks: { command: string }[] }[]>).Stop!
    const commands = stop.flatMap(g => g.hooks.map(h => h.command))
    expect(commands).toContain('afplay done.mp3')
    expect(commands.some(c => c.includes(SCRIPT))).toBe(true)
  })

  it('is idempotent — a second merge installs nothing new', () => {
    const first = mergeHooks({}, SCRIPT)
    const second = mergeHooks(first.settings, SCRIPT)
    expect(second.installed).toEqual([])
    expect(second.alreadyPresent).toEqual([...HOOK_EVENTS])
  })

  it('treats a non-object settings file as empty rather than throwing', () => {
    expect(() => mergeHooks('garbage', SCRIPT)).not.toThrow()
    expect(mergeHooks(null, SCRIPT).installed).toEqual([...HOOK_EVENTS])
  })
})

describe('installHooks', () => {
  it('creates .claude/settings.json when absent, with no backup', async () => {
    const result = await installHooks(dir, SCRIPT)
    expect(result.backupPath).toBeNull()
    const written = JSON.parse(await readFile(result.settingsPath, 'utf8'))
    expect(written.hooks.SessionStart).toBeDefined()
    expect(await isInstalled(dir, SCRIPT)).toBe(true)
  })

  it('backs up an existing settings file before writing', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true })
    const original = JSON.stringify({ model: 'opus' }, null, 2)
    await writeFile(join(dir, '.claude', 'settings.json'), original)

    const result = await installHooks(dir, SCRIPT)
    expect(result.backupPath).toBeTruthy()
    expect(await readFile(result.backupPath!, 'utf8')).toBe(original)
    expect(JSON.parse(await readFile(result.settingsPath, 'utf8')).model).toBe('opus')
  })

  it('reports nothing installed on a second run', async () => {
    await installHooks(dir, SCRIPT)
    const second = await installHooks(dir, SCRIPT)
    expect(second.installed).toEqual([])
  })

  it('reports not installed for a project with no settings', async () => {
    expect(await isInstalled(dir, SCRIPT)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/server/hooks/__tests__/installer.test.ts`
Expected: FAIL — cannot resolve `../installer.js`.

- [ ] **Step 3: Implement src/server/hooks/installer.ts**

```ts
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const HOOK_EVENTS = ['SessionStart', 'SessionEnd', 'Stop', 'PostToolUse'] as const
export type HookEventName = (typeof HOOK_EVENTS)[number]

export interface InstallResult {
  settingsPath: string
  backupPath: string | null
  installed: string[]
  alreadyPresent: string[]
}

interface HookCommand { type: 'command'; command: string; timeout?: number }
interface HookGroup { matcher?: string; hooks: HookCommand[] }

export function buildHookEntry(scriptPath: string): HookCommand {
  // No matcher: matcher semantics have changed across Claude Code releases, and
  // we want every occurrence of these events.
  return { type: 'command', command: scriptPath, timeout: 1 }
}

function settingsPathFor(projectPath: string): string {
  return join(projectPath, '.claude', 'settings.json')
}

export function mergeHooks(
  existing: unknown,
  scriptPath: string,
): { settings: Record<string, unknown>; installed: string[]; alreadyPresent: string[] } {
  const base: Record<string, unknown> =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}

  const hooksRaw = base.hooks
  const hooks: Record<string, HookGroup[]> =
    typeof hooksRaw === 'object' && hooksRaw !== null && !Array.isArray(hooksRaw)
      ? { ...(hooksRaw as Record<string, HookGroup[]>) }
      : {}

  const installed: string[] = []
  const alreadyPresent: string[] = []

  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? [...hooks[event]!] : []
    const present = groups.some(g =>
      Array.isArray(g?.hooks) && g.hooks.some(h => h?.command === scriptPath))

    if (present) { alreadyPresent.push(event); hooks[event] = groups; continue }

    // Append our own group rather than touching the user's existing ones.
    groups.push({ hooks: [buildHookEntry(scriptPath)] })
    hooks[event] = groups
    installed.push(event)
  }

  base.hooks = hooks
  return { settings: base, installed, alreadyPresent }
}

export async function installHooks(projectPath: string, scriptPath: string): Promise<InstallResult> {
  const settingsPath = settingsPathFor(projectPath)
  await mkdir(join(projectPath, '.claude'), { recursive: true })

  const raw = await readFile(settingsPath, 'utf8').catch(() => null)
  let backupPath: string | null = null
  if (raw !== null) {
    // Never overwrite a user's settings without a copy beside it.
    backupPath = `${settingsPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
    await copyFile(settingsPath, backupPath)
  }

  let parsed: unknown = {}
  if (raw !== null) { try { parsed = JSON.parse(raw) } catch { parsed = {} } }

  const { settings, installed, alreadyPresent } = mergeHooks(parsed, scriptPath)
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')

  return { settingsPath, backupPath, installed, alreadyPresent }
}

export async function isInstalled(projectPath: string, scriptPath: string): Promise<boolean> {
  const raw = await readFile(settingsPathFor(projectPath), 'utf8').catch(() => null)
  if (raw === null) return false
  try {
    const { alreadyPresent } = mergeHooks(JSON.parse(raw), scriptPath)
    return alreadyPresent.length === HOOK_EVENTS.length
  } catch { return false }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/server/hooks/__tests__/installer.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Add the install route and UI affordance**

`src/server/routes/hook-install.ts` exposes `GET /api/projects/:id/hooks` (returns `{ installed: boolean }`) and `POST /api/projects/:id/hooks/install` (returns the `InstallResult`). The script path is the absolute path to `scripts/hook-post.sh` in this repo, resolved once at startup.

In `ProjectView`, show a small "Hooks: installed / not installed" indicator with an **Install hooks** button when absent. On success, show which events were installed and the backup path.

- [ ] **Step 6: Verify on a real scratch project**

Pick a scratch project (not this repo). Confirm it has no `.claude/settings.json`, or note its contents first. Click Install hooks, then:
```bash
cat <scratch>/.claude/settings.json | jq '.hooks | keys'
ls <scratch>/.claude/settings.json.backup-* 2>/dev/null
```
Expected: the four events present; a backup file only if settings existed before.

Then start a real Claude Code session in that scratch project and confirm the dashboard shows it as `active` **within a second of the session starting** — before any transcript lines would have been flushed. This is the M4 acceptance criterion: hooks beat the watcher.

Finally confirm the hook does no harm: run a session with the dashboard **stopped** and verify Claude Code shows no delay or error.

- [ ] **Step 7: Lint, update TASKS.md, commit**

```bash
npm test && npm run lint
git add -A
git commit -m "feat(hooks): opt-in hook installer with settings backup"
```

---

## Task 15: Final review, Claude setup port, and README

**Files:**
- Create: `.claude/rules/git-restrictions.md`, `.claude/rules/unit-tests.md`, `.claude/rules/autonomous-runs.md`, `.claude/rules/context-preservation.md`, `.claude/hooks/session-context.sh`, `.claude/hooks/git-guard.sh`, `.claude/settings.json`, `README.md`, `docs/verification/v1-acceptance.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full v1 review workflow**

Multi-agent review over the whole diff since the first commit, across: correctness, security (loopback binding, no Claude-data-dir writes, argv-only prompts, hook fail-silence), format-drift resilience, resource safety (watchers, timers, unbounded memory), and dead code. Adversarially verify each finding before acting. Apply confirmed fixes.

- [ ] **Step 2: Port the Claude Code setup**

Adapt from `/opt/homebrew/var/ai-projects/prp-project/collaboration-tool/.claude/`:
- `rules/git-restrictions.md` — the allowed-command table and the forbidden-commands list, verbatim in spirit.
- `rules/unit-tests.md` — parser coverage requirement, source→test path mapping, happy/error/boundary minimum.
- `rules/autonomous-runs.md` — don't end on an intention, ground every progress claim.
- `rules/context-preservation.md` — durable facts to memory, ephemeral pointers capped.
- `hooks/session-context.sh` — inject branch, dirty files, last 5 commits at SessionStart.
- `hooks/git-guard.sh` — PreToolUse(Bash) exit 2 on checkout/restore/reset/clean/stash/push.
- `settings.json` — the two hooks above plus a read-only permission allowlist and a destructive-git deny list.

Extend `CLAUDE.md` with a **Domain Terms** table: session, transcript, entry, escaped dir, tail state, snapshot, delta, run, dispatch, hook sink, drift.

- [ ] **Step 3: Write the README**

`README.md`: what it is, one-command install (`npm i && npm run dev`), how to register a project, how to install hooks, the security posture (loopback only, no auth, never writes to the Claude data dir), and a "when the transcript format changes" note pointing at `src/transcript/`.

- [ ] **Step 4: Full v1 acceptance pass**

Record in `docs/verification/v1-acceptance.md`, with screenshots in `.tmp/`:
1. Overview shows every registered project with live session status.
2. Session view tails a live session without reload.
3. Task board reflects hand edits to TASKS.md within a second, and dashboard edits land on disk in the SPEC §5 format.
4. Dispatch runs a real task to completion with streamed output; cancel works.
5. Hooks make a brand-new session appear before its transcript would have.
6. `npm test` and `npm run lint` both clean.
7. With the dashboard stopped, Claude Code sessions in hooked projects run with no delay or error.

- [ ] **Step 5: Final commit**

Move every task to Done in TASKS.md with a closing Progress log line.
```bash
git add -A
git commit -m "docs: v1 acceptance results, claude setup, and readme"
```

---

## Self-Review

**Spec coverage** — every SPEC section maps to a task: §3.1 SessionWatcher → Tasks 3–4; §3.2 TaskStore → Tasks 8–9; §3.3 Dispatcher → Tasks 11–12; §3.4 hooks → Tasks 13–14; §3.5 API — `/api/projects` (2), `/api/projects/:id/sessions` and `/api/sessions/:sessionId` (4), task CRUD (9), dispatch (11), `/api/hooks` (13), `WS /api/events` (5, served at `/ws`); §3.6 three screens → Tasks 5, 6, 9; §4 security → enforced in Tasks 1, 11, 13, 14 and re-checked in 7 and 15; §5 TASKS.md format → Task 8; §6 milestones → Tasks 7 and 15 are the gates.

**Deviation from SPEC §3.5, recorded deliberately:** the WebSocket path is `/ws`, not `/api/events` — it keeps the Vite proxy config trivially separable from the HTTP API. Everything else matches.

**Deferred field:** the snapshot's `tasks` map is `{}` until Task 10 fills it; the field exists from Task 5 so the client shape never changes.

**Type consistency:** `SessionSummary` (shared/types) is produced by `SessionStore.#summarize` and consumed unchanged by routes, the hub, and both frontend screens. `TranscriptEntry` flows parser → store → `/api/sessions/:id` → `TimelineEntry`. `TasksDoc`/`Task` flow parser → store → routes → `TaskBoard`. `RunHandle` flows dispatcher → routes → `RunPanel`. Frontend copies of these types in `web/src/shared/types.ts` must stay byte-identical to their `src/` originals — a mismatch there is the most likely silent bug in this plan.

