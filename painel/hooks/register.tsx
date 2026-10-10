import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DiffLine, Step } from '../types'

// Visual patterns from anthropics/claude-code-playground mods/token-weather and mods/replay-theater @569c528 (Apache-2.0).

const PANE = 'replay'
const HISTORY = 12
const DIFF_MAX = 400
const BARS = '▁▂▃▄▅▆▇█'

const tokens = atom({ plugin: 'painel', key: 'tokens' } as const, [])
const percent = atom({ plugin: 'painel', key: 'percent' } as const, null)
const replay = atom({ plugin: 'painel', key: 'replay' } as const, [])
const step = atom({ plugin: 'painel', key: 'step' } as const, 0)

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

// ---- Recording -------------------------------------------------------------

let pending: Step[] = []

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'replay', description: 'Mostra, passo a passo, o que o último turno mudou nos arquivos' })
    return next(e)
  })

  on('command.run', { command: 'replay' }, async $ => ({ text: (await openReplay($)) ? 'Replay aberto.' : 'O último turno não editou arquivos.' }))

  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    return { ...res, sections: [...res.sections.filter(s => s.id !== JUSTIFY.id), JUSTIFY] }
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId || (e.tool !== 'Edit' && e.tool !== 'Write')) return next(e)
    // Read before next: after it, a Write has already replaced the old content.
    const before = e.tool === 'Write' ? await $.fs.read(String(e.file_path)).catch(() => '') : ''
    const ran = await next(e)
    if (!('deny' in ran) && !ran.isError) record(e.tool, e as unknown as Record<string, unknown>, before)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    try {
      if (pending.length) {
        const steps = pending
        await update($, replay, () => steps)
      }
      pending = []
      const ctx = (await $.session.usage()).context
      if (ctx.tokens !== undefined) {
        await update($, tokens, list => [...list, ctx.tokens!].slice(-HISTORY))
        await update($, percent, () => ctx.percent ?? Math.round((ctx.tokens! / ctx.window) * 100))
      }
    } catch {
      // the band just keeps its last reading
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.isWorking || e.props.hasSurvey) return next(e)
    const pct = await read($, percent)
    const steps = await read($, replay)
    if (pct === null && !steps.length) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const values = await read($, tokens)
    const f = pct === null ? null : forecast(pct)
    // Stack over whatever the plugins beneath draw (next-prompts' row), so load order never hides either.
    const below = await next(e)
    const mine = (
      <Box gap={1}>
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
    return below.type === 'engine' ? mine : <Box flexDirection="column">{mine}{below}</Box>
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
