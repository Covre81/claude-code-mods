// Run with: claude plugin test git-sidebar
import { describe, expect, test } from 'claude-code/testing'
import { PREFIX, buildRows, mergeMark, parsePorcelain, recordTouch, relativeTo } from './filetree.ts'
import type { Touched } from './filetree.ts'

describe('relativeTo', () => {
  test('windows and posix paths become cwd-relative with forward slashes', () => {
    expect(relativeTo('C:\\Dev\\app', 'C:\\Dev\\app\\src\\a.ts')).toBe('src/a.ts')
    expect(relativeTo('c:/dev/app/', 'C:\\Dev\\app\\src\\a.ts')).toBe('src/a.ts')
    expect(relativeTo('/repo/app', '/repo/app/b.ts')).toBe('b.ts')
  })
  test('outside the cwd, the cwd itself, and sibling prefixes are not paths in the tree', () => {
    expect(relativeTo('/repo/app', '/repo/other/b.ts')).toBeUndefined()
    expect(relativeTo('/repo/app', '/repo/app-feature/b.ts')).toBeUndefined()
    expect(relativeTo('/repo/app', '/repo/app')).toBeUndefined()
  })
})

describe('recordTouch', () => {
  test('Read marks read, Edit/Write mark write, and write is never downgraded', () => {
    const t: Touched = new Map()
    recordTouch(t, '/r', 'Read', '/r/a.ts')
    recordTouch(t, '/r', 'Edit', '/r/b.ts')
    recordTouch(t, '/r', 'Write', '/r/a.ts')
    recordTouch(t, '/r', 'Read', '/r/b.ts')
    expect(Object.fromEntries(t)).toEqual({ 'a.ts': 'write', 'b.ts': 'write' })
  })
  test('ignores other tools, missing or non-string paths and paths outside the cwd', () => {
    const t: Touched = new Map()
    recordTouch(t, '/r', 'Bash', '/r/a.ts')
    recordTouch(t, '/r', 'Read', undefined)
    recordTouch(t, '/r', 'Read', 42)
    recordTouch(t, '/r', 'Read', '/elsewhere/a.ts')
    expect(t.size).toBe(0)
  })
})

describe('parsePorcelain', () => {
  test('maps status codes to marks', () => {
    const out = [' M src/a.ts', 'A  src/b.ts', '?? new.txt', ' D gone.ts', 'R  old.ts -> src/new.ts', 'UU clash.ts', ''].join('\n')
    expect(Object.fromEntries(parsePorcelain(out, ''))).toEqual({
      'src/a.ts': 'M',
      'src/b.ts': 'A',
      'new.txt': '?',
      'gone.ts': 'D',
      'src/new.ts': 'R',
      'clash.ts': 'U',
    })
  })
  test('unquotes paths and re-roots them under the cwd prefix', () => {
    const out = ' M "sub/with space.ts"\n M other/x.ts\n'
    expect(Object.fromEntries(parsePorcelain(out, 'sub/'))).toEqual({ 'with space.ts': 'M' })
  })
  test('empty output has no marks', () => {
    expect(parsePorcelain('', '').size).toBe(0)
    expect(PREFIX).toContain('--show-prefix')
  })
})

describe('mergeMark', () => {
  test('a conflict beats everything, then deletes, then the rest', () => {
    expect(mergeMark(undefined, 'M')).toBe('M')
    expect(mergeMark('M', 'D')).toBe('D')
    expect(mergeMark('D', 'U')).toBe('U')
    expect(mergeMark('U', 'M')).toBe('U')
  })
})

const LISTING = new Map([
  ['', [{ name: 'src', kind: 'dir' }, { name: '.git', kind: 'dir' }, { name: 'node_modules', kind: 'dir' }, { name: 'z.md', kind: 'file' }, { name: 'a.md', kind: 'file' }]],
  ['src', [{ name: 'b.ts', kind: 'file' }, { name: 'lib', kind: 'dir' }]],
] as const)

describe('buildRows', () => {
  const git = new Map([['src/b.ts', 'M' as const]])
  const touched: Touched = new Map([['a.md', 'read' as const]])

  test('collapsed: dirs first, then files by name, skipping .git and node_modules', () => {
    const rows = buildRows(LISTING, new Set(), git, touched)
    expect(rows.map(r => r.path)).toEqual(['src', 'a.md', 'z.md'])
    expect(rows[0]).toEqual(expect.objectContaining({ kind: 'dir', depth: 0, expanded: false }))
  })
  test('a collapsed dir carries the marks of what is inside it', () => {
    const rows = buildRows(LISTING, new Set(), git, touched)
    expect(rows[0]!.git).toBe('M')
    expect(rows[1]!.touch).toBe('read')
    expect(rows[2]!.git).toBeUndefined()
  })
  test('expanded dirs list their children one level deeper', () => {
    const rows = buildRows(LISTING, new Set(['src']), git, touched)
    expect(rows.map(r => `${r.depth}:${r.path}`)).toEqual(['0:src', '1:src/lib', '1:src/b.ts', '0:a.md', '0:z.md'])
    expect(rows[2]!.git).toBe('M')
  })
  test('a dir whose listing failed shows no children', () => {
    expect(buildRows(LISTING, new Set(['src/lib']), git, touched).length).toBe(3)
    expect(buildRows(new Map(), new Set(), git, touched)).toEqual([])
  })
  test('a touched file under a collapsed dir marks the dir', () => {
    const rows = buildRows(LISTING, new Set(), new Map(), new Map([['src/b.ts', 'write' as const]]))
    expect(rows[0]!.touch).toBe('write')
  })
})
