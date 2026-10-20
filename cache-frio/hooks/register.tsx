import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface, Timer } from 'claude-code'

const isEnabledRef = atom({ plugin: 'cache-frio', key: 'isEnabled' } as const, true)

// ponytail: fixed 1h TTL — on overage the real TTL drops to 5m and this under-warns; no API exposes it here.
// Upgrade: read the TTL from the event once the host exposes it (today only PreModelSwitch has cache_ttl).
const TTL_MS = 60 * 60 * 1000
const MIN_TOKENS = 100_000

export function minutesLeft({ idleMs }: { idleMs: number }): number {
  return Math.max(0, Math.floor((TTL_MS - idleMs) / 60_000))
}

/** Origins with a person at the keyboard: composer Enter and Remote Control. */
const HUMAN = new Set(['composer', 'bridge'])
const SEND = 'Mandar assim mesmo'
const COMPACT = 'Compactar antes'
const CANCEL = 'Cancelar'

/** Cold = over 1h since the last main-loop answer, a context big enough to hurt, and a person sending. */
export function isCold(p: { idleMs: number; tokens: number; origin: string }): boolean {
  return p.idleMs > TTL_MS && p.tokens > MIN_TOKENS && HUMAN.has(p.origin)
}

const formatIdle = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

type State = { lastAnswerAt: number | undefined; ticker: Timer | undefined }

/** Never rejects: the status line is decoration and must not break the hooks that call it. */
async function refresh($: EngineInterface, state: State): Promise<void> {
  try {
    const isEnabled = await read($, isEnabledRef)
    const idleMs = isEnabled && state.lastAnswerAt !== undefined ? (await $.clock.now()) - state.lastAnswerAt : undefined
    const tokens = idleMs === undefined ? undefined : (await $.session.usage()).context.tokens
    // No await below: check-and-assign on state.ticker stays atomic, so overlapping refreshes can't leak a timer.
    if (idleMs === undefined || tokens === undefined || idleMs >= TTL_MS || tokens <= MIN_TOKENS) {
      state.ticker?.cancel()
      state.ticker = undefined
      $.ui.status(undefined)
      return
    }
    $.ui.status(`cache: ${minutesLeft({ idleMs })} min`)
    state.ticker ??= $.clock.every(60_000, () => void refresh($, state))
  } catch {
    state.ticker?.cancel()
    state.ticker = undefined
  }
}

export const register: Register = on => {
  const state: State = { lastAnswerAt: undefined, ticker: undefined }

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('isEnabled').catch(() => undefined)
    await update($, isEnabledRef, () => (typeof saved === 'boolean' ? saved : isEnabledRef.initial))
    await $.command.register({
      name: 'cache-frio',
      description: 'Liga/desliga o aviso de cache frio antes de mandar um prompt caro.',
      argumentHint: 'on|off',
    })
    await refresh($, state)
    return next(e)
  })

  on('command.run', { command: 'cache-frio' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') {
      const isEnabled = await read($, isEnabledRef)
      return { text: `cache-frio esta ${isEnabled ? 'ativado' : 'desativado'}. Uso: /cache-frio on · /cache-frio off` }
    }
    await update($, isEnabledRef, () => arg === 'on')
    await $.store.set('isEnabled', arg === 'on') // $.state is per session; the store survives a restart
    await refresh($, state) // on shows the countdown now, off hides it
    return { text: `cache-frio ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) state.lastAnswerAt = await $.clock.now()
    await refresh($, state)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (!(await read($, isEnabledRef))) return next(e)
    const idleMs = state.lastAnswerAt === undefined ? undefined : (await $.clock.now()) - state.lastAnswerAt
    const tokens = (await $.session.usage()).context.tokens // free without `breakdown`
    if (idleMs === undefined || tokens === undefined || !isCold({ idleMs, tokens, origin: e.origin.kind })) return next(e)
    const choice = await $.ui.ask(
      `O cache esfriou (${formatIdle(idleMs)} parado). Reler ${Math.round(tokens / 1000)} mil tokens custa caro. O que fazer?`,
      { header: 'Cache frio', options: [SEND, COMPACT, CANCEL] },
    )
    if (choice !== COMPACT && choice !== CANCEL) return next(e) // SEND, or free text under "Other"
    // The host refuses $.session.compact() inside prompt.submit (it would compact under the held turn),
    // so hold the prompt, put it back in the box, and let the user run the command.
    const isFilled = (await $.prompt.fill({ text: e.text }).catch(() => undefined))?.isFilled === true
    const step =
      choice === COMPACT
        ? 'rode /compact e depois mande de novo (compactar também relê o contexto inteiro uma vez)'
        : 'rode /clear e depois mande de novo: é o que de fato economiza'
    const where = isFilled ? 'O texto voltou para a caixa' : 'Copie o texto abaixo'
    return { drop: `Não enviado: cache frio. ${where}; ${step}.\n\n${e.text}` }
  }).catch(($, e, next) => next(e)) // fail open: a bug or a dismissed / unanswerable ask (-p) must never eat the prompt
}
