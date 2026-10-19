import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const isEnabledRef = atom({ plugin: 'atomic-commit-guard', key: 'isEnabled' } as const, true)

// ponytail: copy of guarda/hooks/register.tsx; plugins load in isolation
type Dir = string | null

function tokenize(text: string): string[] {
  const words: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(text); m; m = re.exec(text)) words.push(m[1] ?? m[2] ?? m[3] ?? '')
  return words
}

const isAbs = (p: string) => /^([A-Za-z]:[\\/]|[\\/]|~)/.test(p)
/** Git Bash spells `C:\Dev` as `/c/Dev`; the engine's fs wants `C:/Dev`. */
const toWin = (p: string) => p.replace(/^\/([a-zA-Z])(?=\/|$)/, (_, d: string) => `${d.toUpperCase()}:`)
const joinDir = (dir: Dir, arg: string | undefined): string => (!arg || arg === '~' ? '~' : isAbs(arg) || !dir ? arg : `${dir}/${arg}`)

const PREFIXES = new Set(['sudo', 'command', 'exec', 'env', 'nohup', 'time', 'then', 'do', 'else', '!'])

/** Each simple command of a shell line with the folder it runs in (after any cd). */
function* commands(command: string): Generator<{ cmd: string; args: string[]; dir: Dir }> {
  let dir: Dir = null
  for (const seg of command.split(/&&|\|\||;|\||\n/)) {
    const words = tokenize(seg.trim().replace(/^[({]+\s*/, '').replace(/\s*[)}]+$/, ''))
    while (words.length && (PREFIXES.has(words[0]!) || /^[A-Za-z_]\w*=/.test(words[0]!))) words.shift()
    const [first, ...args] = words
    if (!first) continue
    const cmd = first.replace(/^\\/, '').replace(/\.exe$/i, '')
    if (cmd === 'cd') {
      dir = joinDir(dir, args[0])
      continue
    }
    yield { cmd, args, dir }
  }
}

function gitParts(args: string[], dir: Dir) {
  let i = 0
  let gitDir = dir
  while (i < args.length && args[i]!.startsWith('-')) {
    if (args[i] === '-C') gitDir = joinDir(gitDir, args[i + 1])
    i += args[i] === '-C' || args[i] === '-c' ? 2 : 1
  }
  return { sub: args[i], rest: args.slice(i + 1), gitDir }
}

async function resolveDir($: EngineInterface, base: string, dir: Dir): Promise<string | null> {
  if (dir === null) return base
  if (dir.startsWith('~')) return null
  const path = isAbs(dir) ? toWin(dir) : `${base}/${dir}`
  const st = await $.fs.stat(path).catch(() => undefined)
  return st?.kind === 'dir' ? path : null
}

async function git($: EngineInterface, cwd: string, args: string[]) {
  return $.process.run(['git', ...args], { cwd, timeoutMs: 15000 })
}

export type CommitTarget = { args: string[]; dir: Dir }

export function commitTargets(command: string): CommitTarget[] {
  const found: CommitTarget[] = []
  for (const { cmd, args, dir } of commands(command)) {
    if (cmd !== 'git') continue
    const { sub, rest, gitDir } = gitParts(args, dir)
    if (sub === 'commit') found.push({ args: rest, dir: gitDir })
  }
  return found
}

export function commitMessage(command: string): string | null {
  const heredoc = /<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\s*\1\s*(\n|$)/.exec(command)
  if (heredoc?.[2] !== undefined) return heredoc[2]
  const words = tokenize(command)
  const start = words.indexOf('commit')
  const parts: string[] = []
  for (let i = start >= 0 ? start + 1 : 0; i < words.length; i++) {
    const w = words[i]!
    if (w === '-m' || w === '--message') {
      const next = words[++i]
      if (next !== undefined) parts.push(next)
    } else if (w.startsWith('--message=')) {
      parts.push(w.slice('--message='.length))
    } else if (/^-[^-FctuC]*m/.test(w)) {
      const rest = w.slice(w.indexOf('m') + 1)
      if (rest) parts.push(rest)
      else {
        const next = words[++i]
        if (next !== undefined) parts.push(next)
      }
    }
  }
  return parts.length ? parts.join('\n\n') : null
}

const CONVENTIONAL_RE = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w.\-\/]+\))?!?: \S/

export function messageProblems(msg: string): string[] {
  const problems: string[] = []
  const lines = msg.trim().split(/\r?\n/)
  const first = lines[0] ?? ''
  if (!CONVENTIONAL_RE.test(first)) {
    problems.push('a 1ª linha da mensagem deve seguir Conventional Commits (ex.: feat(escopo): descrição)')
  }
  if (!lines.some(l => /^co-authored-by:/i.test(l.trim()))) {
    problems.push('a mensagem deve conter uma linha iniciada por "Co-Authored-By:"')
  }
  return problems
}

// ponytail: domain = top-level dir; monorepos with src/+tests/ split will be flagged, refine per repo if it gets noisy
export function scopeDirs(files: string[]): string[] {
  const dirs = new Set<string>()
  for (const f of files) {
    const clean = f.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    const slash = clean.indexOf('/')
    if (slash > 0) dirs.add(clean.slice(0, slash))
  }
  return [...dirs].sort()
}

async function stagedDirs($: EngineInterface, target: CommitTarget, cwd: string): Promise<string[]> {
  // a root commit (an import) spans every directory by nature
  const head = await git($, cwd, ['rev-parse', '--verify', '-q', 'HEAD'])
  if (head.exitCode !== 0) return []
  const staged = await git($, cwd, ['diff', '--cached', '--name-only'])
  if (staged.exitCode !== 0) return []
  const files = staged.stdout.split('\n')
  const hasAll = target.args.includes('--all') || target.args.some(a => /^-[^-mFctuC]*a/.test(a))
  if (hasAll) {
    const unstaged = await git($, cwd, ['diff', '--name-only'])
    if (unstaged.exitCode !== 0) return []
    files.push(...unstaged.stdout.split('\n'))
  }
  return scopeDirs(files)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'commit-guard',
      description: 'Liga/desliga a validação de escopo único, Conventional Commits e Co-Authored-By.',
      argumentHint: '<on|off>',
    })
    return next(e)
  })

  on('command.run', { command: 'commit-guard' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') return { text: 'Uso: /commit-guard on|off' }
    await update($, isEnabledRef, () => arg === 'on')
    return { text: `atomic-commit-guard ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    if (!(await read($, isEnabledRef).catch(() => true))) return next(e)
    const command = String(e.command ?? '')
    let targets: CommitTarget[] = []
    let msg: string | null = null
    try {
      targets = commitTargets(command)
      if (!targets.length) return next(e)
      msg = commitMessage(command)
    } catch {
      return next(e)
    }

    const problems: string[] = []
    const base = toWin(await $.session.cwd().catch(() => ''))
    if (base) {
      for (const target of targets) {
        const cwd = await resolveDir($, base, target.dir).catch(() => null)
        const dirs = cwd === null ? [] : await stagedDirs($, target, cwd).catch(() => [])
        if (dirs.length > 1) {
          problems.push(
            `o escopo do commit cruza mais de um diretório de primeiro nível (${dirs.join(', ')}) — faça um commit separado por diretório`,
          )
        }
      }
    }

    if (msg !== null) {
      try {
        problems.push(...messageProblems(msg))
      } catch {
        // never block shell calls on a classifier bug
      }
    }

    if (problems.length) {
      return { deny: `Commit bloqueado: ${problems.join('; ')}. Corrija e rode de novo.` }
    }
    return next(e)
  })
}

