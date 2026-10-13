import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Report } from '../types'

// Visual pattern from anthropics/claude-code-playground mods/blast-radius @569c528 (Apache-2.0),
// rewritten for Windows: only `git` is spawned, never bash (on PATH it can be WSL's), and rm is measured with $.fs.

const PANE = 'guarda'
const LIST_MAX = 8
const HOLD_MS = 10 * 60 * 1000
const NET_MS = 2500

const held = atom({ plugin: 'guarda', key: 'held' } as const, null)

type Dir = string | null
export type Risk =
  | { kind: 'rm'; label: string; targets: string[]; dir: Dir }
  | { kind: 'git-reset' | 'git-clean' | 'git-push-force' | 'git-checkout'; label: string; args: string[]; dir: Dir }
  | { kind: 'deps'; label: string; manager: 'npm' | 'pip'; packages: string[]; dir: Dir }
  | { kind: 'secret-commit'; label: string; args: string[]; dir: Dir }

const EXPLAIN: Record<Risk['kind'], string> = {
  rm: 'Apaga arquivos ou pastas com tudo dentro. Com o mod lixeira ligado vão para a Lixeira do Windows; sem ele, não tem Ctrl+Z.',
  'git-reset': 'Joga fora tudo que foi alterado e ainda não virou commit. O git não guarda cópia disso.',
  'git-clean': 'Apaga arquivos que o git nunca registrou (os novos). Como não estão no histórico, somem de vez.',
  'git-push-force': 'Reescreve o histórico no GitHub. Commits que só existem lá podem desaparecer.',
  'git-checkout': 'Descarta as alterações ainda não commitadas de todos os arquivos.',
  'secret-commit': 'Coloca um arquivo de segredo no histórico do git. Mesmo apagado depois, continua nos commits antigos.',
  deps: 'Instala código de terceiros no projeto. Ele passa a rodar na sua máquina e dentro do app: vale ver se é conhecido e mantido.',
}

// ---- What counts as risky (pure, tested) ---------------------------------

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
const NODE_ADD: Record<string, readonly string[]> = { npm: ['install', 'i', 'add'], pnpm: ['add', 'install', 'i'], yarn: ['add'], bun: ['add', 'install', 'i'] }
const PIP_VALUE_FLAGS = new Set(['-r', '--requirement', '-e', '--editable', '-c', '--constraint', '-i', '--index-url', '--extra-index-url', '-t', '--target'])

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

/** The first risky segment of a shell command, or null. A bare `npm install` / `pip install -r` adds nothing new and passes. */
export function classify(command: string): Risk | null {
  for (const { cmd, args, dir } of commands(command)) {
    const risk = classifyCmd(cmd, args, dir)
    if (risk) return risk
  }
  return null
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

type Candidate = Extract<Risk, { kind: 'secret-commit' }>

/** Every git add/commit of the line that may carry a secret file; only git itself can tell, so the hook asks it before holding. */
export function commitCandidates(command: string): Candidate[] {
  const found: Candidate[] = []
  for (const { cmd, args, dir } of commands(command)) {
    if (cmd !== 'git') continue
    const { sub, rest, gitDir } = gitParts(args, dir)
    if (sub === 'add' || sub === 'commit') found.push({ kind: 'secret-commit', label: `git ${sub}`, args: rest, dir: gitDir })
  }
  return found
}

export const commitCandidate = (command: string): Candidate | null => commitCandidates(command)[0] ?? null

function classifyCmd(cmd: string, args: string[], dir: Dir): Risk | null {
  if (cmd === 'rm' || cmd.endsWith('/rm')) {
    const flags = args.filter(a => a.startsWith('-'))
    const short = flags.filter(f => /^-[^-]/.test(f)).join('')
    const isRecursive = flags.includes('--recursive') || /[rR]/.test(short)
    const isForce = flags.includes('--force') || short.includes('f')
    return isRecursive || isForce ? { kind: 'rm', label: `rm ${flags.join(' ')}`, targets: args.filter(a => !a.startsWith('-')), dir } : null
  }
  if (cmd === 'git') {
    const { sub, rest, gitDir } = gitParts(args, dir)
    const short = rest.filter(a => /^-[^-]/.test(a)).join('')
    if (sub === 'reset' && rest.includes('--hard')) return { kind: 'git-reset', label: 'git reset --hard', args: rest, dir: gitDir }
    // Without -f git refuses to clean (clean.requireForce), and -n is the dry run.
    if (sub === 'clean' && (short.includes('f') || rest.includes('--force')) && !short.includes('n') && !rest.includes('--dry-run'))
      return { kind: 'git-clean', label: 'git clean', args: rest, dir: gitDir }
    if (sub === 'push' && rest.some(a => a === '--force' || a === '-f' || a.startsWith('--force-with-lease') || a.startsWith('+')))
      return { kind: 'git-push-force', label: 'git push --force', args: rest, dir: gitDir }
    const isStagedOnly = sub === 'restore' && rest.includes('--staged') && !rest.includes('--worktree') && !rest.includes('-W')
    if ((sub === 'checkout' || sub === 'restore') && rest.includes('.') && !isStagedOnly)
      return { kind: 'git-checkout', label: `git ${sub} .`, args: rest, dir: gitDir }
    return null
  }
  const adds = NODE_ADD[cmd]
  if (adds || (cmd === 'npx' && args[0] === 'expo')) {
    const [sub, ...rest] = adds ? args : args.slice(1)
    if (!sub || !(adds ?? ['install']).includes(sub)) return null
    const packages = rest.filter(a => !a.startsWith('-'))
    return packages.length ? { kind: 'deps', label: `${adds ? cmd : 'npx expo'} ${sub}`, manager: 'npm', packages, dir } : null
  }
  const pip =
    cmd === 'pip' || cmd === 'pip3'
      ? args
      : /^(python3?|py)$/.test(cmd) && args[0] === '-m' && args[1] === 'pip'
        ? args.slice(2)
        : cmd === 'uv' && args[0] === 'pip'
          ? args.slice(1)
          : cmd === 'uv' && args[0] === 'add'
            ? ['install', ...args.slice(1)]
            : null
  if (pip?.[0] !== 'install') return null
  const packages: string[] = []
  const rest = pip.slice(1)
  for (let k = 0; k < rest.length; k++) {
    const a = rest[k]!
    if (PIP_VALUE_FLAGS.has(a)) k++
    else if (!a.startsWith('-') && !/^[./\\~]/.test(a) && !/^[A-Za-z]:/.test(a)) packages.push(a)
  }
  return packages.length ? { kind: 'deps', label: 'pip install', manager: 'pip', packages, dir } : null
}

/** Registry name of a package spec, or null for a git/URL/file source. */
export function packageName(manager: 'npm' | 'pip', spec: string): string | null {
  if (manager === 'pip') return /^[A-Za-z0-9][\w.-]*/.exec(spec)?.[0] ?? null
  const name = spec.replace(/(?<=.)@.*$/, '')
  return /^(@[\w.-]+\/)?[\w.-]+$/.test(name) ? name : null
}

// ---- Measuring ------------------------------------------------------------

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let n = bytes / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`
}

const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n))
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

type Measured = Pick<Report, 'summary' | 'lines' | 'note'>

/** Never resolves past NET_MS: $.http.fetch has no timeout of its own. */
function within<T>($: EngineInterface, p: Promise<T>): Promise<T | null> {
  return Promise.race([p.catch(() => null), $.clock.sleep(NET_MS).then(() => null)])
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

// ponytail: copy of cofre/hooks/secrets.ts isSecretFile; plugins load in isolation, a ../../cofre import leaves the plugin root.
function isSecretFile(path: string): boolean {
  const base = (path.replace(/["']/g, '').split(/[\\/]/).pop() ?? '').toLowerCase()
  if (/^\.env(\..+)?$/.test(base)) return !/\.(example|sample|template)$/.test(base)
  if (base.endsWith('.pub')) return false
  return /\.(pem|key)$/.test(base) || /^credentials.*\.json$/.test(base) || /^id_(rsa|ed25519)/.test(base)
}

/** Secret files this add/commit would put in history: `git add -n` for add, the index (+ worktree with -a) for commit. */
async function stagedSecrets($: EngineInterface, risk: Extract<Risk, { kind: 'secret-commit' }>, cwd: string): Promise<string[]> {
  const out = async (args: string[]) => (await git($, cwd, args)).stdout.split('\n')
  const files =
    risk.label === 'git add'
      ? (await out(['add', '-n', ...risk.args])).map(l => /^add '(.+)'$/.exec(l.trim())?.[1] ?? '')
      : [
          ...(await out(['diff', '--cached', '--name-only', '--diff-filter=d'])),
          ...(risk.args.includes('--all') || risk.args.some(a => /^-[^-]*a/.test(a)) ? await out(['diff', '--name-only', '--diff-filter=d']) : []),
        ]
  return [...new Set(files.map(f => f.trim()).filter(f => f && isSecretFile(f)))]
}

async function measureRm($: EngineInterface, targets: string[], cwd: string): Promise<Measured> {
  const lines: string[] = []
  let found = 0
  let bytes = 0
  for (const t of targets.slice(0, LIST_MAX)) {
    if (/[*?[]/.test(t) || t.startsWith('~') || t.includes('$')) {
      lines.push(`${t}  (padrão ou variável: não consegui medir)`)
      continue
    }
    const path = isAbs(t) ? toWin(t) : `${cwd}/${t}`
    const st = await $.fs.stat(path).catch(() => undefined)
    if (!st) {
      lines.push(`${t}  (não existe)`)
      continue
    }
    found++
    if (st.kind === 'dir') lines.push(`${t}/  pasta com ${(await $.fs.list(path).catch(() => [])).length} itens dentro`)
    else {
      bytes += st.size
      lines.push(`${t}  ${size(st.size)}`)
    }
  }
  if (targets.length > LIST_MAX) lines.push(`+ ${targets.length - LIST_MAX} outros caminhos`)
  return {
    summary: targets.length === 0 ? 'rm sem caminho' : found === 0 ? 'apagar nada: nenhum caminho medido existe' : `apagar ${plural(found, 'caminho', 'caminhos')}${bytes ? ` (~${size(bytes)} em arquivos)` : ''}`,
    lines,
    note: 'Pastas são apagadas com tudo dentro, inclusive subpastas.',
  }
}

async function measureGit($: EngineInterface, risk: Extract<Risk, { args: string[] }>, cwd: string): Promise<Measured> {
  if (risk.kind === 'git-clean') {
    const flags = risk.args.filter(a => a.startsWith('-')).map(a => (/^-[^-]/.test(a) ? a.replace(/[fiq]/g, '') : a)).filter(a => a !== '-' && a !== '--force')
    const paths = risk.args.filter(a => !a.startsWith('-'))
    const run = await git($, cwd, ['clean', '-n', ...flags, '--', ...paths])
    if (run.exitCode !== 0) return { summary: 'git clean (não consegui simular)', lines: [], note: run.stderr.trim().slice(0, 200) }
    const gone = run.stdout.split('\n').filter(l => l.startsWith('Would remove ')).map(l => l.slice(13))
    return {
      summary: gone.length ? `apagar ${plural(gone.length, 'arquivo novo', 'arquivos novos')}` : 'apagar nada: não há arquivos novos',
      lines: [...gone.slice(0, LIST_MAX), ...(gone.length > LIST_MAX ? [`+ ${gone.length - LIST_MAX} outros`] : [])],
      note: 'Simulado com git clean -n. Esses arquivos não estão no git: não dá pra recuperar.',
    }
  }
  if (risk.kind === 'git-push-force') {
    const [remote = 'origin', spec = ''] = risk.args.filter(a => !a.startsWith('-'))
    const head = (await git($, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
    const [src, dst] = spec.replace(/^\+/, '').split(':')
    const branch = (dst ?? src) && (dst ?? src) !== 'HEAD' ? (dst ?? src)!.replace(/^refs\/heads\//, '') : head
    const ref = `${remote}/${branch}`
    if ((await git($, cwd, ['rev-parse', '--verify', '--quiet', ref])).exitCode !== 0)
      return { summary: `force push para ${ref}`, lines: [], note: `Não tenho cópia local de ${ref}, então não sei que commits sumiriam. Rode git fetch antes.` }
    const dropped = (await git($, cwd, ['log', '--oneline', '--no-decorate', `${src && src !== 'HEAD' ? src : 'HEAD'}..${ref}`])).stdout.split('\n').filter(Boolean)
    return {
      summary: dropped.length ? `force push para ${ref}: some com ${plural(dropped.length, 'commit', 'commits')}` : `force push para ${ref}: nenhum commit some`,
      lines: dropped.slice(0, LIST_MAX),
      note: `Commits que existem em ${ref} e não na sua cópia, desde o último fetch.`,
    }
  }
  const status = await git($, cwd, ['status', '--porcelain'])
  if (status.exitCode !== 0) return { summary: `${risk.label} (aqui não é um repositório git?)`, lines: [], note: status.stderr.trim().slice(0, 200) }
  const rows = status.stdout.split('\n').filter(l => l.length > 3 && !l.startsWith('??'))
  // reset --hard drops staged and unstaged changes; checkout/restore . only the unstaged ones.
  const lost = risk.kind === 'git-reset' ? rows : rows.filter(l => l[1] !== ' ')
  const stat = (await git($, cwd, ['diff', '--shortstat', risk.kind === 'git-reset' ? 'HEAD' : '--'])).stdout.trim()
  return {
    summary: lost.length ? `descartar alterações em ${plural(lost.length, 'arquivo', 'arquivos')}` : 'descartar nada: não há alterações pendentes',
    lines: [...lost.slice(0, LIST_MAX).map(l => `${l.slice(0, 2)} ${l.slice(3)}`), ...(lost.length > LIST_MAX ? [`+ ${lost.length - LIST_MAX} outros`] : [])],
    note: stat ? `${stat}. Alterações não commitadas não voltam.` : 'De git status.',
  }
}

async function lookup($: EngineInterface, manager: 'npm' | 'pip', spec: string): Promise<string> {
  const name = packageName(manager, spec)
  if (!name) return `${spec}  fonte fora do registro (git, URL ou arquivo): confira de onde vem`
  const url = manager === 'npm' ? `https://registry.npmjs.org/${name}/latest` : `https://pypi.org/pypi/${encodeURIComponent(name)}/json`
  const res = await within($, $.http.fetch(url))
  if (!res) return `${name}  (registro não respondeu a tempo)`
  if (res.status === 404) return `⚠ ${name}  NÃO existe no registro: erro de digitação ou pacote falso?`
  if (!res.ok) return `${name}  (registro respondeu ${res.status})`
  try {
    if (manager === 'pip') {
      const { info } = JSON.parse(res.text) as { info: { version?: string; license?: string; summary?: string } }
      return [name, info.version, info.license?.slice(0, 20), info.summary].filter(Boolean).join(' · ')
    }
    const j = JSON.parse(res.text) as { version?: string; license?: string; description?: string }
    const dl = await within($, $.http.fetch(`https://api.npmjs.org/downloads/point/last-week/${name}`))
    const downloads = dl?.ok ? (JSON.parse(dl.text) as { downloads?: number }).downloads : undefined
    return [name, j.version, j.license, downloads === undefined ? undefined : `${short(downloads)} downloads/semana`, j.description].filter(Boolean).join(' · ')
  } catch {
    return `${name}  (resposta do registro ilegível)`
  }
}

async function measure($: EngineInterface, risk: Risk, cwd: string): Promise<Measured> {
  try {
    if (risk.kind === 'secret-commit') {
      const files = await stagedSecrets($, risk, cwd)
      return {
        summary: `colocar ${plural(files.length, 'arquivo de segredo', 'arquivos de segredo')} no git`,
        lines: files.slice(0, LIST_MAX).map(f => `⚠ ${f}`),
        note: 'Tire do commit com git restore --staged <arquivo> e confira se o .gitignore cobre o arquivo.',
      }
    }
    if (risk.kind === 'rm') return await measureRm($, risk.targets, cwd)
    if (risk.kind === 'deps') {
      const lines = await Promise.all(risk.packages.slice(0, 3).map(p => lookup($, risk.manager, p)))
      const isUnknown = lines.some(l => l.startsWith('⚠'))
      return {
        summary: `adicionar ${plural(risk.packages.length, 'pacote novo', 'pacotes novos')}${isUnknown ? ' (um deles não existe!)' : ''}`,
        lines,
        note: 'Poucos downloads, sem licença ou nome parecido com um famoso = desconfie. Prefira o que o projeto já usa.',
      }
    }
    return await measureGit($, risk, cwd)
  } catch (error) {
    return { summary: `${risk.label} (não consegui medir)`, lines: [], note: String(error).slice(0, 200) }
  }
}

// ---- Holding the call -----------------------------------------------------

// The decision the buttons write; one hold at a time, Bash calls in a turn run in order.
let decision: 'proceed' | 'cancel' | null = null
let isHolding = false

type Verdict = { isOk: boolean; why: string; summary: string }

async function hold($: EngineInterface, command: string, risk: Risk, signal: AbortSignal): Promise<Verdict> {
  const stop = (why: string, summary = risk.label): Verdict => ({ isOk: false, why, summary })
  while (isHolding) {
    if (signal.aborted) return stop('o turno foi interrompido')
    await $.clock.sleep(250, { signal }).catch(() => undefined)
  }
  isHolding = true
  decision = null
  let summary = risk.label
  let isPlaced = false
  try {
    const cwd = await resolveDir($, toWin(await $.session.cwd()), risk.dir)
    const measured: Measured =
      cwd === null ? { summary: `${risk.label} em ${risk.dir}`, lines: [], note: `Não achei a pasta ${risk.dir}, então não consegui medir o impacto.` } : await measure($, risk, cwd)
    const report: Report = { command, label: risk.label, explain: EXPLAIN[risk.kind], ...measured }
    summary = report.summary
    await update($, held, () => report)
    isPlaced = (await $.ui.open({ id: PANE, title: 'Guarda', focus: true, rows: Math.min(24, 11 + report.lines.length) })).isPlaced
    if (!isPlaced) {
      // Narrow terminal: no room for the pane, so the engine's own dialog. Typed "Other" text or a dismissal is a no.
      const answer = await $.ui.ask(`⚠ ${risk.label}: ${report.explain} Vai ${report.summary}. Executar mesmo assim?`, {
        header: 'Guarda',
        options: ['Cancelar', 'Executar'],
      })
      decision = answer === 'Executar' ? 'proceed' : 'cancel'
    }
    const startedAt = await $.clock.now()
    while (decision === null) {
      if (signal.aborted) return stop('o turno foi interrompido', summary)
      if ((await $.clock.now()) - startedAt > HOLD_MS) return stop('ninguém respondeu em 10 minutos', summary)
      await $.clock.sleep(250, { signal }).catch(() => undefined)
    }
    return decision === 'proceed' ? { isOk: true, why: '', summary } : stop('o usuário escolheu Cancelar', summary)
  } catch {
    // Includes `-p` runs, where nobody can be asked: a risky command never runs unseen.
    return stop('o guarda não conseguiu perguntar ao usuário', summary)
  } finally {
    if (isPlaced) await $.ui.close({ id: PANE }).catch(() => undefined)
    await update($, held, () => null).catch(() => undefined)
    isHolding = false
  }
}

export const register: Register = on => {
  // PowerShell runs the same git/npm/pip lines, so it goes through the same classifier.
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const command = String(e.command ?? '')
    let risks: Risk[] = []
    try {
      risks = [...commitCandidates(command), classify(command)].filter((r): r is Risk => r !== null)
    } catch {
      risks = [] // a classifier bug must never block every shell call
    }
    // Every add/commit is a candidate; hold only those where git lists a secret file. A git failure lets it pass, as a classifier bug does.
    const base = risks.some(r => r.kind === 'secret-commit') ? toWin(await $.session.cwd().catch(() => '')) : ''
    const kept: Risk[] = []
    for (const r of risks) {
      if (r.kind !== 'secret-commit') {
        kept.push(r)
        continue
      }
      if (!base) continue // no cwd: cannot ask git, but classify risks stay held
      const cwd = await resolveDir($, base, r.dir).catch(() => null)
      const found = cwd === null ? [] : await stagedSecrets($, r, cwd).catch(() => [])
      if (found.length) kept.push(r)
    }
    risks = kept
    for (const risk of risks) {
      const verdict = await hold($, command, risk, next.signal)
      if (!verdict.isOk)
        return { deny: `O guarda segurou este comando e não o executou: ${verdict.why}. Ele iria ${verdict.summary}. Não tente de novo a menos que o usuário peça.` }
    }
    if (risks.length) $.ui.toast('🛡 guarda: executando')
    return next(e)
  })

  on('ui.close', ($, e, next) => {
    if (e.id === PANE && decision === null) decision = 'cancel'
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const r = await read($, held)
    if (!r) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text bold color="yellow">
          🛡 Guarda · {r.label}
        </Text>
        <Text wrap="truncate-end">
          <Text dimColor>Comando </Text>
          <Text bold>{r.command}</Text>
        </Text>
        <Text wrap="wrap">
          <Text dimColor>O que é </Text>
          {r.explain}
        </Text>
        <Text>
          <Text dimColor>Vai </Text>
          <Text bold color="red">
            {r.summary}
          </Text>
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {r.lines.map((l, i) => (
            <Text key={`l${i}`} color={l.startsWith('⚠') ? 'red' : 'cyan'} wrap="truncate-end">
              {`  ${l}`}
            </Text>
          ))}
        </Box>
        {r.note ? (
          <Text dimColor italic wrap="wrap">
            {r.note}
          </Text>
        ) : null}
        <Box marginTop={1} gap={2}>
          <Button key="proceed" label="Executar" hotkey="1" onPress={() => void (decision ??= 'proceed')} />
          <Button key="cancel" label="Cancelar" hotkey="2" variant="primary" onPress={() => void (decision ??= 'cancel')} />
          <Text dimColor>Claude está esperando sua resposta</Text>
        </Box>
      </Box>
    )
  })
}
