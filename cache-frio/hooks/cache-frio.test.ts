import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { isCold, minutesLeft } from './register'

const HOUR = 60 * 60 * 1000

describe('isCold', () => {
  test('cold only past 1h, above 100k tokens, from the user', () => {
    expect(isCold({ idleMs: HOUR + 1, tokens: 100_001, origin: 'composer' })).toBe(true)
    expect(isCold({ idleMs: HOUR + 1, tokens: 100_001, origin: 'bridge' })).toBe(true)
    expect(isCold({ idleMs: HOUR, tokens: 100_001, origin: 'composer' })).toBe(false)
    expect(isCold({ idleMs: HOUR + 1, tokens: 100_000, origin: 'composer' })).toBe(false)
    expect(isCold({ idleMs: HOUR + 1, tokens: 100_001, origin: 'task-notification' })).toBe(false)
    expect(isCold({ idleMs: HOUR + 1, tokens: 100_001, origin: 'sdk' })).toBe(false)
  })
})

describe('minutesLeft', () => {
  test('returns minutes remaining before cold, floored at 0', () => {
    expect(minutesLeft({ idleMs: 0 })).toBe(60)
    expect(minutesLeft({ idleMs: 15 * 60_000 })).toBe(45)
    expect(minutesLeft({ idleMs: 59 * 60_000 + 59_999 })).toBe(0)
    expect(minutesLeft({ idleMs: HOUR })).toBe(0)
    expect(minutesLeft({ idleMs: HOUR + 1 })).toBe(0)
  })
})

type Stubs = { now: number[]; tokens: number; answer?: string; askThrows?: boolean }

/** Core stubs: the clock walks through `now`, usage reports `tokens`, AskUserQuestion answers `answer`. */
function stub(on: On, s: Stubs) {
  const seen = { asked: [] as string[], filled: [] as string[], sent: [] as string[], status: [] as string[] }
  on('clock.now', () => ({ value: s.now.shift() }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: s.tokens, window: 1_000_000 }, rateLimits: [] } }) as never)
  on('ui.status', (_, e) => {
    seen.status.push((e as { text?: string }).text ?? '')
    return { value: true } as never
  })
  on('clock.every', () => ({ value: { cancel() {} } }) as never)
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    if (s.askThrows) throw new Error('dismissed')
    const q = (e as { questions: { question: string }[] }).questions[0]!.question
    seen.asked.push(q)
    return { result: { answers: { [q]: s.answer } } } as never
  })
  on('prompt.fill', (_$, e) => {
    seen.filled.push((e as { text: string }).text)
    return { isFilled: true } as never
  })
  on('prompt.submit', (_$, e) => {
    seen.sent.push((e as { text: string }).text)
    return { text: (e as { text: string }).text } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  return seen
}

const submit = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as never
const answered = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never

describe('prompt.submit', () => {
  test('warm cache passes without asking', async ($, on) => {
    const seen = stub(on, { now: [0, 0, 10 * 60 * 1000], tokens: 180_000 })
    await $.turn.complete(answered)
    const r = (await $.prompt.submit(submit('oi'))) as { text?: string }
    expect(r.text).toBe('oi')
    expect(seen.asked.length).toBe(0)
  })

  test('status line shows the countdown after a main-loop answer', async ($, on) => {
    const seen = stub(on, { now: [0, 10 * 60 * 1000], tokens: 180_000 })
    await $.turn.complete(answered)
    expect(seen.status.at(-1)).toBe('cache: 50 min')
  })

  test('status line is cleared at or below 100k tokens', async ($, on) => {
    const seen = stub(on, { now: [0, 10 * 60 * 1000], tokens: 100_000 })
    await $.turn.complete(answered)
    expect(seen.status.at(-1)).toBe('')
  })

  test('status line is cleared when the mod is off', async ($, on) => {
    const seen = stub(on, { now: [0, 10 * 60 * 1000], tokens: 180_000 })
    on('store.get', () => ({ value: false }) as never)
    on('command.register', () => ({ value: undefined }) as never)
    on('session.start', () => ({ cwd: 'C:/t' }) as never)
    await $.session.start({ cwd: 'C://t' } as never)
    await $.turn.complete(answered)
    expect(seen.status.at(-1)).toBe('')
  })

  test('cold cache asks; send sends, compact and cancel hold the text back in the box', async ($, on) => {
    const s: Stubs = { now: [0, 0, 2 * HOUR, 2 * HOUR, 3 * HOUR], tokens: 180_000, answer: 'Mandar assim mesmo' }
    const seen = stub(on, s)
    await $.turn.complete(answered)
    const r = (await $.prompt.submit(submit('continua'))) as { text?: string }
    expect(seen.asked[0]!.includes('2h00')).toBe(true)
    expect(seen.asked[0]!.includes('180 mil')).toBe(true)
    expect(r.text).toBe('continua')

    s.answer = 'Compactar antes'
    const compact = (await $.prompt.submit(submit('resume'))) as { drop?: string }
    expect(String(compact.drop).includes('/compact')).toBe(true)

    s.answer = 'Cancelar'
    const held = (await $.prompt.submit(submit('outra coisa'))) as { drop?: string }
    expect(String(held.drop).includes('/clear')).toBe(true)
    expect(String(held.drop).includes('outra coisa')).toBe(true)
    expect(seen.filled).toEqual(['resume', 'outra coisa'])
    expect(seen.sent).toEqual(['continua'])
  })

  test('no answer yet in this process passes (fresh or resumed session)', async ($, on) => {
    const seen = stub(on, { now: [5 * HOUR], tokens: 500_000 })
    const r = (await $.prompt.submit(submit('oi'))) as { text?: string }
    expect(r.text).toBe('oi')
    expect(seen.asked.length).toBe(0)
  })

  test('a failing ask lets the prompt through', async ($, on) => {
    stub(on, { now: [0, 0, 2 * HOUR], tokens: 180_000, askThrows: true })
    await $.turn.complete(answered)
    const r = (await $.prompt.submit(submit('oi'))) as { text?: string }
    expect(r.text).toBe('oi')
  })
})
