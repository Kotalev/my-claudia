import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, writeFile, stat } from 'node:fs/promises'
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

  it('removes a registration without touching the directory', async () => {
    const store = join(dir, 'projects.json')
    const reg = new ProjectRegistry(store); await reg.load()
    const rec = await reg.add(dir)

    expect(await reg.remove(rec.id)).toBe(true)
    expect(reg.list()).toEqual([])
    expect((await stat(dir)).isDirectory()).toBe(true)

    const reloaded = new ProjectRegistry(store); await reloaded.load()
    expect(reloaded.list()).toEqual([])
  })

  it('reports nothing removed for an unknown id rather than throwing', async () => {
    const reg = new ProjectRegistry(join(dir, 'projects.json')); await reg.load()
    await reg.add(dir)
    expect(await reg.remove('nope')).toBe(false)
    expect(reg.list()).toHaveLength(1)
  })

  it('leaves the other registrations alone', async () => {
    const other = await mkdtemp(join(tmpdir(), 'mc-reg-'))
    const reg = new ProjectRegistry(join(dir, 'projects.json')); await reg.load()
    const a = await reg.add(dir)
    const b = await reg.add(other)
    await reg.remove(a.id)
    expect(reg.list().map(r => r.id)).toEqual([b.id])
  })
})
