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

  /**
   * Unregisters a project. Only the registration is removed — the directory
   * itself is never touched, and neither is anything under the Claude data dir.
   * Returns false when there was nothing to remove, so removing twice is not an
   * error the caller has to handle.
   */
  async remove(id: string): Promise<boolean> {
    const before = this.#records.length
    this.#records = this.#records.filter(r => r.id !== id)
    if (this.#records.length === before) return false
    await this.#persist()
    return true
  }

  async #persist(): Promise<void> {
    await writeFile(this.storePath, JSON.stringify({ projects: this.#records }, null, 2) + '\n', 'utf8')
  }
}
