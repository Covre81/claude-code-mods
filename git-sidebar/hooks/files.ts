// State and reads of the "Arquivos" tab; the pure parts live in ./filetree.ts.
import type { EngineInterface } from 'claude-code'
import { PREFIX, buildRows, parsePorcelain, recordTouch } from './filetree.ts'
import type { Entry, GitMarks, Row, Touched } from './filetree.ts'
import { STATUS } from './git.ts'

// Module level for the same reason as the pane state in register.tsx: one session draws one pane.
let filesCwd = ''
let listing = new Map<string, readonly Entry[]>()
let expanded = new Set<string>()
let gitMarks: GitMarks = new Map()
let rows: Row[] = []
// per cwd: the paths are relative to it, and a /cd must not mix two trees up
const touchedByCwd = new Map<string, Touched>()

export const fileRows = (): readonly Row[] => rows
export const filesRoot = (): string => filesCwd

async function listDir($: EngineInterface, dir: string): Promise<void> {
  try {
    const entries = await $.fs.list(dir || undefined)
    listing.set(dir, entries.map(({ name, kind }) => ({ name, kind })))
  } catch {
    listing.delete(dir) // fail open: the tree shows without this directory
  }
}

function redrawRows(): void {
  rows = buildRows(listing, expanded, gitMarks, touchedByCwd.get(filesCwd) ?? new Map())
}

/** Lists the session cwd again (and every open folder) and reads `git status` for the marks. */
export async function readFiles($: EngineInterface): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    if (cwd !== filesCwd) {
      filesCwd = cwd
      listing = new Map()
      expanded = new Set()
    }
    const [st, prefix] = await Promise.all([
      $.process.run(STATUS).catch(() => undefined),
      $.process.run(PREFIX).catch(() => undefined),
    ])
    const root = prefix?.exitCode === 0 ? prefix.stdout.trim() : ''
    gitMarks = st?.exitCode === 0 ? parsePorcelain(st.stdout, root) : new Map()
    await Promise.all(['', ...expanded].map(dir => listDir($, dir)))
  } catch {
    gitMarks = new Map()
  }
  redrawRows()
}

/** Opens or closes the folder at `path`; anything else is ignored. */
export async function toggleDir($: EngineInterface, path: string): Promise<void> {
  if (!rows.some(r => r.path === path && r.kind === 'dir')) return
  if (!expanded.delete(path)) {
    expanded.add(path)
    await listDir($, path)
  }
  redrawRows()
}

/** Records a Read/Edit/Write; true when the shown tree changed and needs a redraw. */
export function noteTouch(cwd: string, tool: string, file: unknown): boolean {
  const touched = touchedByCwd.get(cwd) ?? new Map()
  touchedByCwd.set(cwd, touched)
  recordTouch(touched, cwd, tool, file)
  if (cwd !== filesCwd) return false
  redrawRows()
  return true
}
