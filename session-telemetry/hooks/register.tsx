import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

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

export function switchLine(prev: string | undefined, curr: string, ms: number): string | null {
  if (!prev || prev === curr) return null
  return `⇄ ${stamp(ms)} modelo trocado: ${prev} → ${curr}`
}

// O modelo que de fato respondeu vem no usage de cada requisição: é ali que
// aparece o desvio silencioso do jev-router (pedido Opus, respondido gpt-oss),
// e também a troca manual por /model — um detector cobre os dois casos.
let lastModel: string | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
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
    return { text: `session-telemetry ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  // Só a tela muda: a mensagem guardada e o que o modelo lê ficam intactos.
  on('classic.MessageDisplay', async ($, e, next) => {
    const res = await next(e)
    if (e.index !== 0 || !(await read($, isEnabledRef))) return res
    return { ...res, displayContent: `[${stamp(await $.clock.now())}] ${res.displayContent ?? e.delta}` }
  })

  on('turn.step', async function* ($, e, next) {
    const res = yield* next(e)
    const model = res.usage?.model
    // Subagentes usam outros modelos de propósito (Explore = Haiku); contar
    // eles marcaria troca falsa a cada spawn.
    if (e.agentId || !model) return res
    const line = switchLine(lastModel, model, await $.clock.now())
    lastModel = model
    if (line && (await read($, isEnabledRef))) {
      $.ui.log(line)
      $.ui.toast(line, { timeoutMs: 8000 })
    }
    return res
  })
}
