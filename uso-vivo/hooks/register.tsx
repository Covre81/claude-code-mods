import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { Cat, Ctx, Limit } from '../types'

const ctx = atom({ plugin: 'uso-vivo', key: 'ctx' } as const, null)
const limits = atom({ plugin: 'uso-vivo', key: 'limits' } as const, [])
const cost = atom({ plugin: 'uso-vivo', key: 'cost' } as const, null)

// Same thresholds as the mock: calm below 75, warn at 75, alarm at 90.
export const tone = (pct: number) => (pct >= 90 ? 'red' : pct >= 75 ? 'yellow' : 'green')

export function bar(pct: number, width = 10): string {
  const n = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '█'.repeat(n) + '░'.repeat(width - n)
}

export const kilo = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))

// Reset time in London time; the sandbox may lack Intl timezones, then UTC with a marker.
export function clock(iso: string | undefined, withDay: boolean): string {
  if (!iso) return '?'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '?'
  try {
    const o: Intl.DateTimeFormatOptions = { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }
    if (withDay) o.weekday = 'short'
    return d.toLocaleString('en-GB', o).replace(',', '')
  } catch {
    // ponytail: no Intl timezone data, UTC is shown and labelled so it is never mistaken for local
    return `${d.toISOString().slice(11, 16)} UTC`
  }
}

export function usageLine(ls: Limit[], usd: number | null): { text: string; pct: number; color: string }[] {
  const out: { text: string; pct: number; color: string }[] = []
  for (const [kind, name, day] of [['five_hour', '5h', false], ['seven_day', '7d', true]] as const) {
    const l = ls.find(x => x.kind === kind)
    if (!l) continue
    out.push({ text: `${name} ${bar(l.percentUsed)} ${l.percentUsed}% · reset ${clock(l.resetsAt, day)}`, pct: l.percentUsed, color: tone(l.percentUsed) })
  }
  if (usd !== null) out.push({ text: `sessão $${usd.toFixed(2)}`, pct: 0, color: 'gray' })
  return out
}

export function topCats(cats: Cat[], n = 4): string {
  return cats
    .filter(c => c.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, n)
    .map(c => `${c.name} ${kilo(c.tokens)}`)
    .join(' · ')
}

async function refresh($: Engine, breakdown: boolean) {
  const u = await $.session.usage(breakdown ? { breakdown: 'summary' } : undefined)
  await update($, limits, () => u.rateLimits)
  await update($, cost, () => u.cost?.usd ?? null)
  const c = u.context
  if (c.tokens !== undefined) {
    const cats = (c.breakdown?.categories ?? []).filter(x => x.kind === 'used').map(x => ({ name: x.name, tokens: x.tokens }))
    await update($, ctx, prev => ({
      pct: c.percent ?? Math.round((c.tokens! / c.window) * 100),
      tokens: c.tokens!,
      window: c.window,
      cats: cats.length ? cats : (prev?.cats ?? []),
    }))
  }
}

export const register: Register = on => {
  // Breakdown is computed here, once per turn; the render hook only reads atoms.
  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    if (!e.agentId) {
      try { await refresh($, true) } catch { /* keeps the last reading */ }
    }
    return res
  })
  on('session.measure', async ($, e, next) => {
    try { await refresh($, false) } catch { /* keeps the last reading */ }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.isWorking || e.props.hasSurvey) return next(e)
    const c: Ctx | null = await read($, ctx)
    const ls = await read($, limits)
    const usd = await read($, cost)
    const parts = usageLine(ls, usd)
    if (!c && !parts.length) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const below = await next(e)
    const mine = (
      <Box flexDirection="column">
        {c ? (
          <Box borderStyle="round" borderColor={tone(c.pct)} paddingX={1} flexDirection="column">
            <Text wrap="truncate-end">
              <Text bold>contexto </Text>
              <Text color={tone(c.pct)}>{bar(c.pct, 16)} {c.pct}%</Text>
              <Text dimColor> {kilo(c.tokens)}/{kilo(c.window)}</Text>
            </Text>
            {c.cats.length ? <Text dimColor wrap="truncate-end">{topCats(c.cats)}</Text> : null}
          </Box>
        ) : null}
        {parts.length ? (
          <Text wrap="truncate-end">
            {parts.map((p, i) => (
              <Text key={p.text} color={p.color}>{i ? ' │ ' : ''}{p.text}</Text>
            ))}
          </Text>
        ) : null}
      </Box>
    )
    return below.type === 'engine' ? mine : <Box flexDirection="column">{mine}{below}</Box>
  })
}
