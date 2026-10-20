import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { looksLikeRule } from './reflexo.test.logic'

describe('looksLikeRule', () => {
  test('identifies positive rule patterns', () => {
    expect(looksLikeRule('nunca use sed no Windows')).toBe(true)
    expect(looksLikeRule('sempre use types')).toBe(true)
    expect(looksLikeRule('não use var')).toBe(true)
    expect(looksLikeRule('nao use var')).toBe(true)
    expect(looksLikeRule("don't use var")).toBe(true)
    expect(looksLikeRule('always use types')).toBe(true)
    expect(looksLikeRule('never use sed')).toBe(true)
    expect(looksLikeRule('stop using var')).toBe(true)
    expect(looksLikeRule('prefiro TypeScript')).toBe(true)
    expect(looksLikeRule('pare de usar var')).toBe(true)
    expect(looksLikeRule('no, use X')).toBe(true)
  })

  test('rejects non-rule patterns', () => {
    expect(looksLikeRule('Como faço X?')).toBe(false)
    expect(looksLikeRule('Ola Claude')).toBe(false)
    expect(looksLikeRule('não sei')).toBe(false)
    expect(looksLikeRule('nao sei')).toBe(false)
    expect(looksLikeRule("I don't know")).toBe(false)
  })

  test('rejects long prompts', () => {
    const longPrompt = 'sempre ' + 'a'.repeat(201)
    expect(looksLikeRule(longPrompt)).toBe(false)
  })

  test('rejects empty prompts', () => {
    expect(looksLikeRule('')).toBe(false)
  })
})

type Stubs = {
  now: number[];
  answer?: string;
  askThrows?: boolean;
  isEnabled?: boolean;
}

function stub(on: On, s: Stubs) {
  const seen = {
    asked: [] as string[],
    sent: [] as string[],
    status: [] as string[],
    written: [] as string[]
  }

  on('clock.now', () => ({ value: s.now.shift() }) as never)
  on('ui.status', (_, e) => {
    seen.status.push((e as { text?: string }).text ?? '')
    return { value: true } as never
  })
  on('store.get', () => ({ value: s.isEnabled ?? true }) as never)
  on('store.set', () => ({ value: true } as never) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    if (s.askThrows) throw new Error('dismissed')
    const q = (e as { questions: { question: string }[] }).questions[0]!.question
    seen.asked.push(q)
    return { result: { answers: { [q]: s.answer } } } as never
  })
  on('fs.read', async (_, e) => {
    const path = (e as { path: string }).path
    const content = path.includes('CLAUDE.md') ? 'Existing Content' : ''
    return { value: content } as never
  })
  on('fs.write', async (_, e) => {
    const { path, content } = e as { path: string, content: string }
    seen.written.push(`${path}:${content}`)
    return { value: true } as never
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

describe('reflexo hooks', () => {
  test('prompt.submit never drops or blocks the prompt', async ($, on) => {
    const seen = stub(on, { now: [0], isEnabled: true })
    const r = (await $.prompt.submit(submit('nunca use var'))) as { text?: string }
    expect(r.text).toBe('nunca use var')
    expect(seen.sent).toEqual(['nunca use var'])
  })

  test('turn.complete asks and saves rule', async ($, on) => {
    const seen = stub(on, { now: [0], isEnabled: true, answer: 'Projeto (CLAUDE.md)' })
    await $.prompt.submit(submit('sempre use types'))
    await $.turn.complete(answered)

    expect(seen.asked[0]!).toContain('Salvar como regra?')
    expect(seen.written[0]!).toContain('C:/t/CLAUDE.md')
    expect(seen.written[0]!).toContain('## Regras capturadas\n- sempre use types')
  })

  test('turn.complete does nothing when answer is Ignorar', async ($, on) => {
    const seen = stub(on, { now: [0], isEnabled: true, answer: 'Ignorar' })
    await $.prompt.submit(submit('sempre use types'))
    await $.turn.complete(answered)

    expect(seen.asked[0]!).toContain('Salvar como regra?')
    expect(seen.written.length).toBe(0)
  })

  test('turn.complete does nothing when ask is dismissed', async ($, on) => {
    const seen = stub(on, { now: [0], isEnabled: true, askThrows: true })
    await $.prompt.submit(submit('sempre use types'))
    await $.turn.complete(answered)

    expect(seen.written.length).toBe(0)
  })

  test('session.start publishes status', async ($, on) => {
    const seen = stub(on, { now: [0], isEnabled: true })
    on('session.start', () => ({ value: { cwd: 'C:/t' } }) as any)
    await $.session.start({ cwd: 'C:/t' } as any)
    expect(seen.status.at(-1)).toBe('reflexo: on')
  })

  test('save appends instead of rewriting', async ($, on) => {
    const seen = stub(on, { now: [0], isEnabled: true, answer: 'Projeto (CLAUDE.md)' })
    await $.prompt.submit(submit('nunca use var'))
    await $.turn.complete(answered)

    expect(seen.written[0]!).toContain('## Regras capturadas\n- nunca use var\n- Existing Content')
  })
})
