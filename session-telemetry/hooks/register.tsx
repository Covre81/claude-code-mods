import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const isEnabledRef = atom({ plugin: 'session-telemetry', key: 'isEnabled' } as const, true)

export function stamp(ms: number): string {
  const d = new Date(ms)
  try {
    return d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour12: false })
  } catch {
    // ponytail: no Intl timezone data, UTC is shown and labelled so it is never mistaken for local
    return `${d.toISOString().slice(11, 19)} UTC`
  }
}

export function switchLine(prev: string | undefined, curr: string, ms: number, reason?: string): string | null {
  if (!prev || prev === curr) return null
  return `⇄ ${stamp(ms)} modelo trocado: ${prev} → ${curr}` + (reason ? ` · motivo: ${reason}` : '')
}

// Why the jev-router sent the turn where it did (GET /route/<session>). Only behind
// a router: with no ANTHROPIC_BASE_URL the request goes to Anthropic, and a /model
// switch has no reason to fetch. Any failure leaves the line without a reason.
async function routeReason($: EngineInterface): Promise<string | undefined> {
  const base = await $.env.get('ANTHROPIC_BASE_URL')
  if (!base) return undefined
  try {
    const res = await $.http.fetch(`${base.replace(/\/+$/, '')}/route/${encodeURIComponent(await $.session.id())}`)
    if (!res.ok) return undefined
    const reason = (JSON.parse(res.text) as { reason?: unknown }).reason
    return typeof reason === 'string' ? reason : undefined
  } catch {
    return undefined
  }
}

// O modelo que de fato respondeu vem no usage de cada requisição: é ali que
// aparece o desvio silencioso do jev-router (pedido Opus, respondido gpt-oss),
// e também a troca manual por /model — um detector cobre os dois casos.
let lastModel: string | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('isEnabled').catch(() => undefined)
    await update($, isEnabledRef, () => (typeof saved === 'boolean' ? saved : isEnabledRef.initial))
    await $.command.register({
      name: 'telemetria',
      description: 'Liga/desliga a hora nas respostas e o aviso de troca de modelo.',
      argumentHint: '<on|off>',
    })
    return next(e)
  })

  on('command.run', { command: 'telemetria' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') return { text: 'Uso: /telemetria on|off' }
    await update($, isEnabledRef, () => arg === 'on')
    await $.store.set('isEnabled', arg === 'on') // $.state is per session; the store survives a restart
    return { text: `session-telemetry ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  // Só a tela muda: a mensagem guardada e o que o modelo lê ficam intactos.
  on('classic.MessageDisplay', async ($, e, next) => {
    const res = await next(e)
    if (e.index !== 0 || !(await read($, isEnabledRef))) return res
    return { ...res, displayContent: `[${stamp(await $.clock.now())}] ${res.displayContent ?? e.delta}` }
  })

  // Um hook só: a API lança erro num segundo on('turn.step') do mesmo mod.
  on('turn.step', async function* ($, e, next) {
    // Subagentes usam outros modelos de propósito (Explore = Haiku); contar
    // eles marcaria troca falsa a cada spawn.
    if (e.agentId) return yield* next(e)

    const sentAt = await $.clock.now()
    let firstAt: number | null = null
    let stopAt: number | null = null
    const s = next(e)
    for await (const c of s) {
      if (c.kind === 'stop') stopAt = await $.clock.now()
      else if (firstAt === null && c.kind !== 'engine') firstAt = await $.clock.now()
      yield c
    }
    const res = await s.result
    if (!(await read($, isEnabledRef))) {
      if (res.usage?.model) lastModel = res.usage.model
      return res
    }

    const perf = speedLine(sentAt, firstAt, stopAt ?? (await $.clock.now()), res.usage?.output_tokens ?? null)
    if (perf) $.ui.log(perf)

    const model = res.usage?.model
    if (!model) return res
    const switched = lastModel !== undefined && lastModel !== model
    const line = switchLine(lastModel, model, await $.clock.now(), switched ? await routeReason($) : undefined)
    lastModel = model
    if (line) {
      $.ui.log(line)
      $.ui.toast(line, { timeoutMs: 8000 })
    }
    return res
  })
}

// TTFT e tok/s de um passo, com as guardas do stepSpeed do Flightdeck: sem
// primeiro token não há linha; sem tokens ou com tempo zero a taxa some em
// vez de virar Infinity.
export function speedLine(sentAt: number, firstAt: number | null, stopAt: number, outTokens: number | null): string | null {
  if (firstAt === null) return null
  const ttft = Math.max(0, firstAt - sentAt)
  const decodeMs = stopAt - firstAt
  const tps = outTokens !== null && outTokens > 0 && decodeMs > 0 ? (outTokens * 1000) / decodeMs : null
  return `⚡ TTFT ${ttft}ms` + (tps !== null ? ` · ${tps.toFixed(1)} tok/s` : '')
}
