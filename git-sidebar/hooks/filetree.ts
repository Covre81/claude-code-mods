// Pure parts of the "Arquivos" tab: paths -> tree rows, `git status --porcelain` -> marks,
// tool calls -> the set of files Claude touched. No engine calls, so the tests run it as is.
// Adapted from kurtbuhler/claude-code-filetree @003545c (MIT)

export type Mark = 'M' | 'A' | 'D' | 'R' | 'U' | '?'
export type Touch = 'read' | 'write'
export type GitMarks = ReadonlyMap<string, Mark>
export type Touched = Map<string, Touch>
export type Entry = { name: string; kind: 'file' | 'dir' | 'other' }
/** directory (cwd-relative, '' for the root) -> its entries; a dir that failed to list is absent */
export type Listing = ReadonlyMap<string, readonly Entry[]>

export type Row = {
  /** cwd-relative, forward slashes: the key git status and the touched set use */
  path: string
  name: string
  depth: number
  kind: 'file' | 'dir'
  expanded: boolean
  git?: Mark
  touch?: Touch
}

export const PREFIX = ['git', 'rev-parse', '--show-prefix']
const SKIP = new Set(['.git', 'node_modules'])
const TRACKED = ['Read', 'Edit', 'Write']

const slashes = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** `file` as a path under `cwd` (forward slashes), or undefined when it is outside or is the cwd. */
export function relativeTo(cwd: string, file: string): string | undefined {
  const base = slashes(cwd)
  const path = slashes(file)
  const fold = /^[a-z]:/i.test(base) // Windows drive paths compare case-insensitively
  const head = path.slice(0, base.length + 1)
  const want = `${base}/`
  if (fold ? head.toLowerCase() !== want.toLowerCase() : head !== want) return undefined
  return path.slice(want.length) || undefined
}

/** Notes a Read/Edit/Write on `file`; a write is never downgraded to a read. */
export function recordTouch(touched: Touched, cwd: string, tool: string, file: unknown): void {
  if (!TRACKED.includes(tool) || typeof file !== 'string') return
  const rel = relativeTo(cwd, file)
  if (!rel) return
  if (tool === 'Read') {
    if (!touched.has(rel)) touched.set(rel, 'read')
  } else touched.set(rel, 'write')
}

const unquote = (p: string) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p)

function markOf(xy: string): Mark {
  if (xy === '??') return '?'
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'U'
  if (xy.includes('D')) return 'D'
  if (xy.includes('R')) return 'R'
  if (xy.includes('A')) return 'A'
  return 'M'
}

/** Parses `git status --porcelain` (paths are repo-relative); `prefix` is the cwd's `--show-prefix`. */
export function parsePorcelain(out: string, prefix: string): Map<string, Mark> {
  const marks = new Map<string, Mark>()
  for (const line of out.split('\n')) {
    if (line.length < 4) continue
    const raw = line.slice(3)
    const path = unquote(raw.includes(' -> ') ? raw.slice(raw.indexOf(' -> ') + 4) : raw)
    if (!path.startsWith(prefix)) continue
    marks.set(path.slice(prefix.length), markOf(line.slice(0, 2)))
  }
  return marks
}

const RANK: Record<Mark, number> = { U: 3, D: 2, R: 1, A: 1, M: 1, '?': 1 }

/** The mark a folder shows for what is inside it: conflict, then delete, then the first seen. */
export function mergeMark(a: Mark | undefined, b: Mark): Mark {
  return a && RANK[a] >= RANK[b] ? a : b
}

function inside<T>(map: ReadonlyMap<string, T>, dir: string): T[] {
  const head = `${dir}/`
  return [...map].filter(([k]) => k.startsWith(head)).map(([, v]) => v)
}

/** Flattens the listing into the visible rows: dirs first, then files, both by name. */
export function buildRows(listing: Listing, expanded: ReadonlySet<string>, git: GitMarks, touched: ReadonlyMap<string, Touch>): Row[] {
  const rows: Row[] = []
  const walk = (dir: string, depth: number) => {
    const entries = (listing.get(dir) ?? []).filter(e => !SKIP.has(e.name))
    const isDir = (e: Entry) => e.kind === 'dir'
    entries.sort((a, b) => Number(isDir(b)) - Number(isDir(a)) || a.name.localeCompare(b.name))
    for (const e of entries) {
      const path = dir ? `${dir}/${e.name}` : e.name
      const row: Row = { path, name: e.name, depth, kind: isDir(e) ? 'dir' : 'file', expanded: isDir(e) && expanded.has(path) }
      if (isDir(e)) {
        row.git = inside(git, path).reduce<Mark | undefined>(mergeMark, undefined)
        const t = inside(touched, path)
        row.touch = t.includes('write') ? 'write' : t.includes('read') ? 'read' : undefined
      } else {
        row.git = git.get(path)
        row.touch = touched.get(path)
      }
      rows.push(row)
      if (row.expanded) walk(path, depth + 1)
    }
  }
  walk('', 0)
  return rows
}
