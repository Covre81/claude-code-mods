import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { looksLikeRule } from './rule'

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
    expect(looksLikeRule('No arquivo X, faça Y')).toBe(false)
    expect(looksLikeRule('no problem')).toBe(false)
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

type Stubs = { answer?: string; askThrows?: boolean; existing?: string; readError?: string; home?: string }

function stub(on: On, s: Stubs) {
  const seen = { asked: [] as string[], sent: [] as string[], status: [] as string[], written: [] as { path: string; text: string }[] }
  on('ui.status', (_, e) => {
    seen.status.push((e as { text?: string }).text ?? '')
    return { value: true } as never
  })
  on('store.get', () => ({ value: true }) as never)
  on('store.set', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('env.get', () => ({ value: s.home ?? 'C:/Users/t' }) as never)
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    if (s.askThrows) throw new Error('dismissed')
    const q = (e as { questions: { question: string }[] }).questions[0]!.question
    seen.asked.push(q)
    return { result: { answers: { [q]: s.answer } } } as never
  })
  on('fs.read', () => {
    if (s.readError) return { deny: s.readError } as never
    if (s.existing === undefined) return { deny: 'ENOENT: no such file' } as never
    return { value: s.existing } as never
  })
  on('fs.write', (_$, e) => {
    seen.written.push(e as { path: string; text: string })
    return { value: undefined } as never
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
  test('prompt.submit passes the prompt through untouched, rule or not', async ($, on) => {
    const seen = stub(on, {})
    const r = (await $.prompt.submit(submit('nunca use var'))) as { text?: string; drop?: string }
    expect(r.text).toBe('nunca use var')
    expect(r.drop).toBe(undefined)
    const r2 = (await $.prompt.submit(submit('oi'))) as { text?: string }
    expect(r2.text).toBe('oi')
    expect(seen.asked.length).toBe(0) // asking waits for turn.complete
  })

  test('no rule queued: turn.complete asks nothing', async ($, on) => {
    const seen = stub(on, {})
    await $.prompt.submit(submit('oi'))
    await $.turn.complete(answered)
    expect(seen.asked.length).toBe(0)
  })

  test('Projeto appends "- <text>" under the heading, creating the file', async ($, on) => {
    const seen = stub(on, { answer: 'Projeto (CLAUDE.md)' })
    await $.prompt.submit(submit('nunca use sed no Windows'))
    await $.turn.complete(answered)
    expect(seen.asked).toEqual([`Salvar como regra? "nunca use sed no Windows"`])
    expect(seen.written.length).toBe(1)
    expect(seen.written[0]!.path.endsWith('CLAUDE.md')).toBe(true) // engine resolves it under the session cwd
    expect(seen.written[0]!.text).toBe('## Regras capturadas\n- nunca use sed no Windows\n')
  })

  test('Global writes to ~/.claude/CLAUDE.md', async ($, on) => {
    const seen = stub(on, { answer: 'Global (~/.claude/CLAUDE.md)' })
    await $.prompt.submit(submit('sempre use types'))
    await $.turn.complete(answered)
    expect(seen.written[0]!.path.split('\\').join('/')).toBe('C:/Users/t/.claude/CLAUDE.md')
  })

  test('existing content is kept verbatim; the new line is only appended', async ($, on) => {
    const existing = '# Meu projeto\n\nregra antiga\n'
    const seen = stub(on, { answer: 'Projeto (CLAUDE.md)', existing })
    await $.prompt.submit(submit('nunca use var'))
    await $.turn.complete(answered)
    const text = seen.written[0]!.text
    expect(text.startsWith(existing)).toBe(true)
    expect(text.slice(existing.length)).toBe('\n## Regras capturadas\n- nunca use var\n')
  })

  test('existing heading: the line is appended, no second heading', async ($, on) => {
    const existing = '## Regras capturadas\n- antiga\n'
    const seen = stub(on, { answer: 'Projeto (CLAUDE.md)', existing })
    await $.prompt.submit(submit('nunca use var'))
    await $.turn.complete(answered)
    expect(seen.written[0]!.text).toBe('## Regras capturadas\n- antiga\n- nunca use var\n')
  })

  test('heading followed by another section: the line goes under the heading', async ($, on) => {
    const existing = '## Regras capturadas\n- antiga\n\n## Outra\ntexto\n'
    const seen = stub(on, { answer: 'Projeto (CLAUDE.md)', existing })
    await $.prompt.submit(submit('nunca use var'))
    await $.turn.complete(answered)
    expect(seen.written[0]!.text).toBe('## Regras capturadas\n- antiga\n- nunca use var\n\n## Outra\ntexto\n')
  })

  test('a non-ENOENT read error writes nothing (no overwrite of CLAUDE.md)', async ($, on) => {
    const seen = stub(on, { answer: 'Projeto (CLAUDE.md)', readError: 'EACCES: permission denied' })
    await $.prompt.submit(submit('nunca use var'))
    await $.turn.complete(answered)
    expect(seen.written.length).toBe(0)
  })

  test('Ignorar writes nothing', async ($, on) => {
    const seen = stub(on, { answer: 'Ignorar' })
    await $.prompt.submit(submit('sempre use types'))
    await $.turn.complete(answered)
    expect(seen.asked.length).toBe(1)
    expect(seen.written.length).toBe(0)
  })

  test('a dismissed ask writes nothing and does not throw', async ($, on) => {
    const seen = stub(on, { askThrows: true })
    await $.prompt.submit(submit('sempre use types'))
    await $.turn.complete(answered)
    expect(seen.written.length).toBe(0)
  })

  test('session.start publishes the status', async ($, on) => {
    const seen = stub(on, {})
    on('session.start', () => ({ cwd: 'C:/t' }) as never)
    await $.session.start({ cwd: 'C://t' } as never)
    expect(seen.status.at(-1)).toBe('reflexo: on')
  })
})
