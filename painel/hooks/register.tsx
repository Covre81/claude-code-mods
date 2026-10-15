import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Act, DiffLine, Step, TurnStat } from '../types'

// Visual patterns from anthropics/claude-code-playground mods/token-weather and mods/replay-theater @569c528 (Apache-2.0).

const PANE = 'replay'
const ACT_PANE = 'atividade'
const HISTORY = 12
const DIFF_MAX = 400
const BARS = '▁▂▃▄▅▆▇█'

const tokens = atom({ plugin: 'painel', key: 'tokens' } as const, [])
const percent = atom({ plugin: 'painel', key: 'percent' } as const, null)
const replay = atom({ plugin: 'painel', key: 'replay' } as const, [])
const step = atom({ plugin: 'painel', key: 'step' } as const, 0)
const activity = atom({ plugin: 'painel', key: 'activity' } as const, [])
const turnStat = atom({ plugin: 'painel', key: 'turn' } as const, null)
const cost = atom({ plugin: 'painel', key: 'cost' } as const, null)
const limits = atom({ plugin: 'painel', key: 'limits' } as const, [])
const isEnabledRef = atom({ plugin: 'painel', key: 'isEnabled' } as const, true)

/** Byte-identical every turn: anything that varies here would break the prompt cache through jev-router. */
export const JUSTIFY = {
  id: 'painel:justificar',
  scope: 'session',
  text: [
    'O usuário não é programador e decide com base no que você explica.',
    'Antes de cada Edit ou Write, escreva uma frase curta em português simples: o que vai mudar no arquivo e por quê.',
    'Antes de um comando que apaga, sobrescreve ou instala algo, diga o impacto real antes de rodar.',
  ].join(' '),
} as const

// ---- Weather (pure) --------------------------------------------------------

export function forecast(pct: number): { icon: string; label: string; color: string; tip?: string } {
  if (pct < 25) return { icon: '☀', label: 'Céu limpo', color: 'yellow' }
  if (pct < 50) return { icon: '☁', label: 'Nublado', color: 'cyan' }
  if (pct < 75) return { icon: '☂', label: 'Chuva', color: 'blue', tip: 'mudou de assunto? /clear' }
  if (pct < 90) return { icon: '☇', label: 'Tempestade', color: 'magenta', tip: '/compact logo' }
  return { icon: '↯', label: 'Vai compactar', color: 'red', tip: '/compact agora' }
}

export function sparkline(values: readonly number[]): string {
  const max = Math.max(...values, 1)
  return values.map(v => BARS[Math.min(BARS.length - 1, Math.floor((v / max) * BARS.length))]).join('')
}

export function trend(values: readonly number[]): string {
  if (values.length < 2) return ''
  const d = values.at(-1)! - values.at(-2)!
  const k = Math.round(Math.abs(d) / 1000)
  return d === 0 ? '' : `${d > 0 ? '▲ +' : '▼ −'}${k}k no último turno`
}

// ---- Diff (pure) -----------------------------------------------------------

/** Line diff by LCS with one line of context around each change. Past DIFF_MAX lines on a side: everything shown as replaced. */
export function diff(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  if (a.length > DIFF_MAX || b.length > DIFF_MAX)
    return [...a.slice(0, 20).map(text => ({ sign: '-' as const, text })), ...b.slice(0, 20).map(text => ({ sign: '+' as const, text })), { sign: '…', text: 'arquivo grande: só o começo' }]
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const all: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      all.push({ sign: ' ', text: a[i]! })
      i++
      j++
    } else if (j < b.length && (i === a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) all.push({ sign: '+', text: b[j++]! })
    else all.push({ sign: '-', text: a[i++]! })
  }
  const keep = all.map((l, k) => l.sign !== ' ' || all[k - 1]?.sign === '+' || all[k - 1]?.sign === '-' || all[k + 1]?.sign === '+' || all[k + 1]?.sign === '-')
  const out: DiffLine[] = []
  all.forEach((l, k) => {
    if (keep[k]) out.push(l)
    else if (keep[k - 1] && out.length) out.push({ sign: '…', text: '' })
  })
  return out.at(-1)?.sign === '…' ? out.slice(0, -1) : out
}

// ---- Activity and usage (pure) ---------------------------------------------

const clip = (s: string, n = 70) => {
  const line = s.split('\n')[0]!.trim()
  return line.length > n ? `${line.slice(0, n - 1)}…` : line
}

/** What a call was about, in a few words: the command, the file, the pattern. */
export function label(tool: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  if (tool === 'Bash' || tool === 'PowerShell') return clip(s('command'))
  if (s('file_path')) return shortPath(s('file_path'))
  if (s('notebook_path')) return shortPath(s('notebook_path'))
  return clip(s('pattern') || s('description') || s('url') || s('query') || s('skill') || s('prompt'))
}

export const toolName = (tool: string) => (tool.startsWith('mcp__') ? tool.slice(5).replace('__', ': ') : tool)

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

/** A countdown: timestamps are UTC, so a relative time avoids showing the wrong clock in BST. */
export function fmtIn(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'instantes'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}min`
  if (m < 48 * 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
  return `${Math.round(m / 1440)}d`
}

export const fmtTok =(n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`)
export const fmtUsd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`

/** Share of the turn's input served from the prompt cache; null when there was no input. */
export function cacheRate(u: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): number | null {
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  return total ? Math.round((u.cache_read_input_tokens / total) * 100) : null
}

const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'gasto' }
export const limitName = (kind: string) => LIMIT_NAMES[kind] ?? kind

/** The band's second line, as plain parts; colour is the drawing's job. */
export function summary(t: TurnStat, acts: readonly Act[], total: number | null, lims: readonly { kind: string; percentUsed: number }[]): string[] {
  const errors = acts.filter(a => !a.ok).length
  const parts = [`⏱ ${fmtMs(t.ms)}`, `${acts.length} ${acts.length === 1 ? 'ferramenta' : 'ferramentas'}${errors ? `, ${errors} com erro` : ''}`]
  if (t.usage) {
    const rate = cacheRate(t.usage)
    parts.push(`↓${fmtTok(t.usage.input_tokens + t.usage.cache_read_input_tokens + t.usage.cache_creation_input_tokens)} ↑${fmtTok(t.usage.output_tokens)} tok${rate === null ? '' : ` · cache ${rate}%`}`)
  }
  if (total !== null) parts.push(`${t.costDelta ? `+${fmtUsd(t.costDelta)} · ` : ''}sessão ${fmtUsd(total)}`)
  for (const l of lims) parts.push(`${limitName(l.kind)} ${l.percentUsed}%`)
  if (t.usage?.model) parts.push(t.usage.model)
  return parts
}

// ---- Recording -------------------------------------------------------------

let pending: Step[] = []
let acts: Act[] = []

/** `before` is the file as it was before a Write ran; Edit carries its own. */
function record(tool: string, input: Record<string, unknown>, before: string): void {
  const file = String(input.file_path ?? '')
  if (tool === 'Edit') pending.push({ file, tool, lines: diff(String(input.old_string ?? ''), String(input.new_string ?? '')) })
  else pending.push({ file, tool, lines: diff(before, String(input.content ?? '')) })
}

const shortPath = (p: string) => p.replace(/\\/g, '/').split('/').slice(-3).join('/')

async function openReplay($: EngineInterface): Promise<boolean> {
  if (!(await read($, replay)).length) return false
  await update($, step, () => 0)
  await $.ui.open({ id: PANE, title: 'Replay', focus: true, closeOnEscape: true })
  return true
}

async function openActivity($: EngineInterface): Promise<boolean> {
  if (!(await read($, turnStat))) return false
  await $.ui.open({ id: ACT_PANE, title: 'Atividade', focus: true, closeOnEscape: true })
  return true
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'replay', description: 'Mostra, passo a passo, o que o último turno mudou nos arquivos' })
    await $.command.register({ name: 'atividade', description: 'Linha do tempo das ferramentas do último turno, com tokens, custo e limites' })
    await $.command.register({ name: 'painel', description: 'Liga/desliga a faixa de clima do contexto e a gravação de atividade.', argumentHint: 'on|off' })
    return next(e)
  })

  on('command.run', { command: 'replay' }, async $ => ({ text: (await openReplay($)) ? 'Replay aberto.' : 'O último turno não editou arquivos.' }))
  on('command.run', { command: 'atividade' }, async $ => ({ text: (await openActivity($)) ? 'Atividade aberta.' : 'Nenhum turno terminou ainda.' }))
  on('command.run', { command: 'painel' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') {
      const isEnabled = await read($, isEnabledRef)
      return { text: `painel esta ${isEnabled ? 'ativado' : 'desativado'}. Uso: /painel on · /painel off` }
    }
    await update($, isEnabledRef, () => arg === 'on')
    return { text: `painel ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    return { ...res, sections: [...res.sections.filter(s => s.id !== JUSTIFY.id), JUSTIFY] }
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId || !(await read($, isEnabledRef))) return next(e)
    const input = e as unknown as Record<string, unknown>
    const edits = e.tool === 'Edit' || e.tool === 'Write'
    // Read before next: after it, a Write has already replaced the old content.
    const before = e.tool === 'Write' ? await $.fs.read(String(e.file_path)).catch(() => '') : ''
    const t0 = await $.clock.now()
    const ran = await next(e)
    // The tool already ran: a slip in the bookkeeping must never fail the call.
    try {
      const ok = !('deny' in ran) && !ran.isError
      acts.push({ tool: e.tool, label: label(e.tool, input), ok, ms: (await $.clock.now()) - t0 })
      if (edits && ok) record(e.tool, input, before)
    } catch {
      // dropped from the activity list, nothing else
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId || !(await read($, isEnabledRef))) return next(e)
    const res = await next(e)
    const done = acts
    acts = []
    try {
      if (pending.length) {
        const steps = pending
        await update($, replay, () => steps)
      }
      pending = []
      const u = await $.session.usage()
      const prev = await read($, cost)
      const now = u.cost?.usd ?? null
      await update($, activity, () => done)
      await update($, turnStat, () => ({ usage: res.usage ?? null, ms: e.durationMs, costDelta: now !== null && prev !== null ? now - prev : null }))
      await update($, cost, () => now)
      await update($, limits, () => u.rateLimits)
      const ctx = u.context
      if (ctx.tokens !== undefined) {
        await update($, tokens, list => [...list, ctx.tokens!].slice(-HISTORY))
        await update($, percent, () => ctx.percent ?? Math.round((ctx.tokens! / ctx.window) * 100))
      }
    } catch {
      // the band just keeps its last reading
    }
    return res
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.isWorking || e.props.hasSurvey || !(await read($, isEnabledRef))) return next(e)
    const pct = await read($, percent)
    const steps = await read($, replay)
    const t = await read($, turnStat)
    if (pct === null && !steps.length && !t) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const values = await read($, tokens)
    const f = pct === null ? null : forecast(pct)
    const done = await read($, activity)
    const errors = done.some(a => !a.ok)
    // Stack over whatever the plugins beneath draw (next-prompts' row), so load order never hides either.
    const below = await next(e)
    const usage = t ? (
      <Box key="usage" gap={1}>
        <Text wrap="truncate-end" color={errors ? 'yellow' : 'gray'}>
          {summary(t, done, await read($, cost), await read($, limits)).join(' · ')}
        </Text>
        {done.length ? <Button key="atividade" label="☰ Atividade" hotkey="a" plain onPress={() => void openActivity($)} /> : null}
      </Box>
    ) : null
    const weather = (
      <Box key="weather" gap={1}>
        {f ? (
          <Text wrap="truncate-end">
            <Text bold color={f.color}>
              {f.icon} {f.label}
            </Text>
            <Text color={f.color}> {pct}% do contexto </Text>
            <Text color={f.color}>{sparkline(values)}</Text>
            <Text dimColor> {trend(values)}</Text>
            {f.tip ? <Text color={f.color} italic>{` · ${f.tip}`}</Text> : null}
          </Text>
        ) : null}
        {steps.length ? (
          <Button key="replay" label={`▶ Replay: ${steps.length} ${steps.length === 1 ? 'edição' : 'edições'}`} hotkey="r" plain onPress={() => void openReplay($)} />
        ) : null}
      </Box>
    )
    const mine = (
      <Box flexDirection="column">
        {weather}
        {usage}
      </Box>
    )
    return below.type === 'engine' ? mine : <Box flexDirection="column">{mine}{below}</Box>
  })

  on('ui.render', { component: 'Pane', requestId: ACT_PANE }, async ($, e, next) => {
    const t = await read($, turnStat)
    if (!t) return next(e)
    const done = await read($, activity)
    const lims = await read($, limits)
    const total = await read($, cost)
    const room = Math.max(4, (e.viewport?.rows ?? 24) - 12)
    const shown = done.slice(-room)
    const width = Math.max(4, ...shown.map(a => toolName(a.tool).length))
    const { Box, Button, Text } = $.ui.resolve(e)
    const u = t.usage
    const rate = u ? cacheRate(u) : null
    const now = await $.clock.now()
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text>
          <Text bold color="cyan">
            ☰ Último turno{' '}
          </Text>
          <Text dimColor>
            {fmtMs(t.ms)} · {done.length} {done.length === 1 ? 'ferramenta' : 'ferramentas'}
          </Text>
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {done.length > shown.length ? <Text dimColor italic>{`  ⋯ ${done.length - shown.length} anteriores`}</Text> : null}
          {shown.map((a, k) => (
            <Text key={`a${k}`} wrap="truncate-end">
              <Text color={a.ok ? 'green' : 'red'}>{a.ok ? '✓ ' : '✗ '}</Text>
              <Text bold>{toolName(a.tool).padEnd(width)} </Text>
              <Text dimColor>{fmtMs(a.ms).padStart(7)} </Text>
              <Text>{a.label}</Text>
            </Text>
          ))}
          {!done.length ? <Text dimColor>Nenhuma ferramenta neste turno.</Text> : null}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {u ? (
            <Text wrap="truncate-end">
              <Text bold>Tokens </Text>
              <Text>
                entrada {fmtTok(u.input_tokens)} · do cache {fmtTok(u.cache_read_input_tokens)} · gravado no cache {fmtTok(u.cache_creation_input_tokens)} · saída {fmtTok(u.output_tokens)}
              </Text>
              {rate === null ? null : <Text color={rate >= 70 ? 'green' : 'yellow'}>{` · cache ${rate}%`}</Text>}
            </Text>
          ) : null}
          {u ? (
            <Text wrap="truncate-end">
              <Text bold>Modelo </Text>
              <Text>{u.model}</Text>
            </Text>
          ) : null}
          {total !== null ? (
            <Text wrap="truncate-end">
              <Text bold>Custo </Text>
              <Text>
                {t.costDelta ? `${fmtUsd(t.costDelta)} neste turno · ` : ''}
                {fmtUsd(total)} na sessão
              </Text>
              <Text dimColor> (estimativa do /cost)</Text>
            </Text>
          ) : null}
          {lims.map(l => (
            <Text key={l.kind} wrap="truncate-end">
              <Text bold>Limite {limitName(l.kind)} </Text>
              <Text color={l.percentUsed >= 80 ? 'red' : l.percentUsed >= 50 ? 'yellow' : undefined}>{l.percentUsed}% usado</Text>
              {l.resetsAt ? <Text dimColor> · reseta em {fmtIn(Date.parse(l.resetsAt) - now)}</Text> : null}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Button key="close" label="Fechar" hotkey="c" role="dismiss" onPress={() => void $.ui.close({ id: ACT_PANE })} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const steps = await read($, replay)
    if (!steps.length) return next(e)
    const at = Math.min(await read($, step), steps.length - 1)
    const cur = steps[at]!
    const room = Math.max(4, (e.viewport?.rows ?? 24) - 8)
    const added = cur.lines.filter(l => l.sign === '+').length
    const removed = cur.lines.filter(l => l.sign === '-').length
    const { Box, Button, Text } = $.ui.resolve(e)
    const go = (d: number) => update($, step, s => Math.max(0, Math.min(steps.length - 1, s + d)))
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
        <Text>
          <Text bold color="magenta">
            ▶ Replay{' '}
          </Text>
          {steps.map((_, k) => (
            <Text key={`c${k}`} color="magenta" inverse={k === at}>{` ${k + 1} `}</Text>
          ))}
        </Text>
        <Text wrap="truncate-end">
          <Text bold>{shortPath(cur.file)}</Text>
          <Text dimColor> · {cur.tool === 'Write' ? 'arquivo escrito' : 'trecho editado'} · </Text>
          <Text color="green">+{added}</Text> <Text color="red">−{removed}</Text>
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {cur.lines.slice(0, room).map((l, k) => (
            <Text key={`d${k}`} wrap="truncate-end" color={l.sign === '+' ? 'green' : l.sign === '-' ? 'red' : undefined} dimColor={l.sign === ' ' || l.sign === '…'}>
              {l.sign === '…' ? `  ⋯ ${l.text}` : `${l.sign} ${l.text}`}
            </Text>
          ))}
          {cur.lines.length > room ? <Text dimColor italic>{`  + ${cur.lines.length - room} linhas`}</Text> : null}
        </Box>
        <Box marginTop={1} gap={2}>
          <Button key="prev" label="◀ Anterior" hotkey="p" onPress={() => void go(-1)} />
          <Button key="next" label="Próxima ▶" hotkey="n" variant="primary" onPress={() => void go(1)} />
          <Button key="close" label="Fechar" hotkey="c" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
