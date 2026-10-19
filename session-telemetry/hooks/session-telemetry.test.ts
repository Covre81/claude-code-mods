import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'
import { speedLine, stamp, switchLine } from './register'

// 2026-10-18 13:05:09 UTC = 14:05:09 em Londres (BST)
const T = Date.UTC(2026, 9, 18, 13, 5, 9)

describe('stamp', () => {
  test('hora de Londres com segundos', () => {
    expect(stamp(T)).toBe('14:05:09')
  })
})

describe('switchLine', () => {
  test('nada quando não há modelo anterior ou ele é o mesmo', () => {
    expect(switchLine(undefined, 'claude-opus-5-5', T)).toBe(null)
    expect(switchLine('claude-opus-5-5', 'claude-opus-5-5', T)).toBe(null)
  })
  test('marca de/para com a hora', () => {
    expect(switchLine('claude-opus-5-5', 'gpt-oss:20b-cloud', T)).toBe('⇄ 14:05:09 modelo trocado: claude-opus-5-5 → gpt-oss:20b-cloud')
  })
  test('com o motivo do roteador', () => {
    expect(switchLine('claude-opus-5-5', 'gemini-3.8-flash-high', T, 'gemini:text-only')).toBe('⇄ 14:05:09 modelo trocado: claude-opus-5-5 → gemini-3.8-flash-high · motivo: gemini:text-only')
  })
})

type Router = { base?: string; status: number; text: string }

/** `router` is what GET /route/<session> answers; without `base` there is no router. */
function stub(on: On, models: string[], router: Router = { status: 404, text: '' }) {
  const logged: string[] = []
  const fetched: string[] = []
  on('clock.now', () => ({ value: T }) as never)
  on('env.get', (_$, e) => ({ value: (e as { name: string }).name === 'ANTHROPIC_BASE_URL' ? router.base : undefined }) as never)
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('http.fetch', (_$, e) => {
    fetched.push((e as { url: string }).url)
    return { value: { status: router.status, ok: router.status < 300, headers: {}, text: router.text } } as never
  })
  // eslint-disable-next-line require-yield
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { model: models.shift() } as never }
  })
  on('ui.log', (_$, e) => {
    logged.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  return Object.assign(logged, { fetched })
}

async function step($: Engine, agentId?: string) {
  const s = $.turn.step({ turnId: 't', index: 0, model: 'x', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for (;;) if ((await s.next()).done) return
}

describe('turn.step', () => {
  test('loga só quando o modelo que respondeu muda, e ignora subagente', async ($, on) => {
    const logged = stub(on, ['claude-opus-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'gpt-oss:20b-cloud'])
    await step($)
    await step($)
    await step($, 'sub-1')
    await step($)
    expect(logged).toEqual(['⇄ 14:05:09 modelo trocado: claude-opus-5-5 → gpt-oss:20b-cloud'])
  })
  test('na troca pergunta o motivo ao roteador, só uma vez', async ($, on) => {
    const router = { base: 'http://127.0.0.1:8787/', status: 200, text: JSON.stringify({ route: 'gemini', reason: 'gemini:text-only' }) }
    const logged = stub(on, ['claude-opus-5-5', 'claude-opus-5-5', 'gemini-3.8-flash-high'], router)
    await step($)
    await step($)
    await step($)
    expect(logged.fetched).toEqual(['http://127.0.0.1:8787/route/sess-1'])
    expect([...logged]).toEqual(['⇄ 14:05:09 modelo trocado: claude-opus-5-5 → gemini-3.8-flash-high · motivo: gemini:text-only'])
  })
  test('roteador sem decisão (404) ou ausente: linha sem motivo', async ($, on) => {
    const logged = stub(on, ['claude-opus-5-5', 'gemini-3.8-flash-high', 'claude-opus-5-5'], { base: 'http://127.0.0.1:8787', status: 404, text: '{"error":"x"}' })
    await step($)
    await step($)
    expect([...logged]).toEqual(['⇄ 14:05:09 modelo trocado: claude-opus-5-5 → gemini-3.8-flash-high'])
  })
  test('sem ANTHROPIC_BASE_URL não chama a rede', async ($, on) => {
    const logged = stub(on, ['claude-opus-5-5', 'gemini-3.8-flash-high'])
    await step($)
    await step($)
    expect(logged.fetched).toEqual([])
    expect([...logged]).toEqual(['⇄ 14:05:09 modelo trocado: claude-opus-5-5 → gemini-3.8-flash-high'])
  })
})

describe('speedLine', () => {
  test('TTFT e tok/s do passo', () => {
    expect(speedLine(0, 800, 2800, 100)).toBe('⚡ TTFT 800ms · 50.0 tok/s')
  })
  test('sem primeiro token não há linha', () => {
    expect(speedLine(0, null, 2800, 100)).toBe(null)
  })
  test('tempo zero ou sem tokens: taxa some, nunca Infinity', () => {
    expect(speedLine(0, 800, 800, 100)).toBe('⚡ TTFT 800ms')
    expect(speedLine(0, 800, 2800, 0)).toBe('⚡ TTFT 800ms')
    expect(speedLine(0, 800, 2800, null)).toBe('⚡ TTFT 800ms')
  })
})

// The engine streams two text chunks, then stop; `now` is what clock.now answers at
// each point. Each wrong reading of the loop gives a different number: taking the
// last chunk as first token -> TTFT 1500ms; missing the stop -> the decode runs to
// 5000 and the rate drops to 24.4. An engine chunk is the real engine's handle and
// a fake cannot yield one, so the `kind !== 'engine'` skip stays untested here.
function streaming(on: On) {
  const logged: string[] = []
  let now = 0
  on('clock.now', () => ({ value: now }) as never)
  on('turn.step', async function* (_$, e) {
    now = 900
    yield { kind: 'text', index: 0, text: 'o' } as const
    now = 1500
    yield { kind: 'text', index: 0, text: 'i' } as const
    now = 2900
    yield { kind: 'stop', stopReason: 'end_turn', usage: null } as const
    now = 5000
    const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }
    return { turnId: e.turnId, index: e.index, answer: 'oi', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  on('ui.log', (_$, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  return () => logged.filter(l => l.startsWith('⚡'))
}

describe('turn.step speed', () => {
  test('TTFT conta do envio ao primeiro chunk do modelo, a taxa até o stop', async ($, on) => {
    const speed = streaming(on)
    await step($)
    expect(speed()).toEqual(['⚡ TTFT 900ms · 50.0 tok/s'])
  })
  test('subagente e /telemetria off não logam velocidade', async ($, on) => {
    mock.store(on)
    const speed = streaming(on)
    await step($, 'sub-1')
    await $.command.run({ command: 'telemetria', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    await step($)
    expect(speed()).toEqual([])
  })
})
