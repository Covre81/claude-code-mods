import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { parseSuggestions } from './register'
declare const setTimeout: (fn: (v?: unknown) => void, ms: number) => unknown

const KNOWN = new Set(['compact', 'code-review'])

describe('parseSuggestions', () => {
  test('reads JSON inside a markdown fence, as cloud gemma sends it', () => {
    const raw = '```json\n{"suggestions":[{"label":"a","text":"faz x"},{"label":"b","text":"/compact"}]}\n```'
    expect(parseSuggestions(raw, KNOWN)).toEqual([
      { label: 'a', text: 'faz x' },
      { label: 'b', text: '/compact' },
    ])
  })

  test('drops invented commands, empty texts and off-shape items, keeps at most 3', () => {
    const raw = JSON.stringify({
      suggestions: [
        { label: 'fake', text: '/deploy-prod now' },
        { label: 'empty', text: '  ' },
        { label: 1, text: 'x' },
        { label: 'ok1', text: '/code-review desde main' },
        { label: 'ok2', text: 'roda os testes' },
        { label: 'ok3', text: 'commita' },
        { label: 'ok4', text: 'extra' },
      ],
    })
    expect(parseSuggestions(raw, KNOWN).map(s => s.label)).toEqual(['ok1', 'ok2', 'ok3'])
  })

  test('drops shell (!) and memory (#) prefixes: the box would run or save them', () => {
    const raw = '{"suggestions":[{"label":"x","text":"!rm -rf ~"},{"label":"y","text":"# regra nova"},{"label":"z","text":"segue"}]}'
    expect(parseSuggestions(raw, KNOWN)).toEqual([{ label: 'z', text: 'segue' }])
  })

  test('garbage gives nothing instead of throwing', () => {
    expect(parseSuggestions('not json', KNOWN)).toEqual([])
    expect(parseSuggestions('{"suggestions": 3}', KNOWN)).toEqual([])
  })
})

const ONE_SUGGESTION = '{"suggestions":[{"label":"segue","text":"continua"}]}'
const OK = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

/** A quiet session whose only model is agy; records each argv and stdin. */
function world(on: On, agy: () => unknown, messages = [{ role: 'user', text: 'oi', toolUses: [] }]) {
  const runs: { argv: string[]; stdin: string }[] = []
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1_000, window: 1_000_000, percent: 0 }, rateLimits: [], cost: null } }) as never)
  on('command.list', () => ({ value: [] }) as never)
  on('session.messages', () => ({ value: messages }) as never)
  on('http.fetch', () => {
    throw new Error('next-prompts must not call the network directly')
  })
  on('process.run', (_$, e) => {
    const { argv, init } = e as { argv: string[]; init?: { stdin?: string } }
    runs.push({ argv, stdin: String(init?.stdin ?? '') })
    return { value: agy() } as never
  })
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
  return runs
}

async function band($: Parameters<Parameters<typeof test>[1]>[0], surface: 'terminal' | 'desktop' = 'terminal') {
  return $.ui.mount({ plugin: 'next-prompts', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
}

test('asks Gemini 3.8 Flash High through agy on stdin, plan mode, never Ollama', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const runs = world(on, () => OK(ONE_SUGGESTION))

  await $.turn.complete({ reason: 'answer', answer: 'feito', durationMs: 1, isAborted: false, turnId: 't1' })
  await new Promise(r => setTimeout(r, 50))

  expect(runs.map(r => r.argv.join(' '))).toEqual(['/home/u/.local/bin/agy --mode plan --model gemini-3.8-flash-high --print-timeout 60s'])
  expect(runs[0]!.stdin).toContain('USER: oi')
  expect((await (await band($)).findAll({ type: 'Button' })).length).toBe(1)
})

// Regressão: o transcript sai da máquina (Google, via agy); segredos não vão junto.
test('secrets in the transcript are redacted before agy sees them', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const runs = world(on, () => OK(ONE_SUGGESTION), [
    { role: 'user', text: 'usa OPENAI_API_KEY=sk-proj-abcdefghijklmnop e Authorization: Bearer abc.def.ghi123', toolUses: [] },
  ])

  await $.turn.complete({ reason: 'answer', answer: 'feito', durationMs: 1, isAborted: false, turnId: 't1' })
  await new Promise(r => setTimeout(r, 50))

  expect(runs[0]!.stdin).not.toContain('sk-proj-abcdefghijklmnop')
  expect(runs[0]!.stdin).not.toContain('abc.def.ghi123')
  expect(runs[0]!.stdin).toContain('OPENAI_API_KEY=')
})

// Regressão: com HOME definido (Git Bash no Windows) o agy virava ~/.local/bin/agy, que lá não existe.
test('on Windows the agy install under LOCALAPPDATA wins over HOME', async ($, on) => {
  mock.env(on, { HOME: 'C:/Users/u', LOCALAPPDATA: 'C:/Users/u/AppData/Local/' })
  const runs = world(on, () => OK(ONE_SUGGESTION))

  await $.turn.complete({ reason: 'answer', answer: 'feito', durationMs: 1, isAborted: false, turnId: 't1' })
  await new Promise(r => setTimeout(r, 50))

  expect(runs[0]!.argv[0]).toBe('C:/Users/u/AppData/Local/agy/bin/agy.exe')
})

// Regressão: a cópia da lista de segredos perdeu a regra de flags (--token x ia para o agy).
test('secret flags in the transcript are redacted before agy sees them', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const runs = world(on, () => OK(ONE_SUGGESTION), [
    { role: 'user', text: 'roda gh auth login --token sekret123abc e cli --secret hunter2xyz', toolUses: [] },
  ])

  await $.turn.complete({ reason: 'answer', answer: 'feito', durationMs: 1, isAborted: false, turnId: 't1' })
  await new Promise(r => setTimeout(r, 50))

  expect(runs[0]!.stdin).not.toContain('sekret123abc')
  expect(runs[0]!.stdin).not.toContain('hunter2xyz')
})

test('agy failing or answering empty leaves a note, not suggestions', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  world(on, () => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }))

  await $.turn.complete({ reason: 'answer', answer: 'feito', durationMs: 1, isAborted: false, turnId: 't1' })
  await new Promise(r => setTimeout(r, 50))

  const ui = await band($)
  expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
  expect((await ui.findAll({ type: 'Text', text: /agy gemini-3.8-flash-high: exit 0, empty/ })).length).toBe(1)
})

test('AGY_BIN overrides where agy lives', async ($, on) => {
  mock.env(on, { HOME: '/home/u', AGY_BIN: '/opt/agy' })
  const runs = world(on, () => OK(ONE_SUGGESTION))

  await $.turn.complete({ reason: 'answer', answer: 'feito', durationMs: 1, isAborted: false, turnId: 't1' })
  await new Promise(r => setTimeout(r, 50))

  expect(runs[0]!.argv[0]).toBe('/opt/agy')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: after a turn the band offers the model's suggestions and a press drafts one`, async ($, on) => {
    const filled: string[] = []
    let asked = ''
    mock.env(on, { HOME: '/home/u' })
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 250_000, window: 1_000_000, percent: 25 }, rateLimits: [], cost: null } }) as never)
    on('command.list', () => ({ value: [{ name: 'compact', description: '', source: 'builtin' }] }) as never)
    on('session.messages', () => ({ value: [{ role: 'user', text: 'testa o router', toolUses: [] }] }) as never)
    on('process.run', (_$, e) => {
      asked = String((e as { init?: { stdin?: string } }).init?.stdin ?? '')
      return { value: OK('```json\n{"suggestions":[{"label":"testar","text":"roda o smoke test do router"},{"label":"fake","text":"/nope"}]}\n```') } as never
    })
    on('prompt.fill', (_$, e) => {
      const { text, mode } = e as { text: string; mode: string }
      filled.push(`${mode}:${text}`)
      return { isFilled: true } as never
    })
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return h(Box, {}) as never
    })

    // A subagent's turn must not spend a model call.
    await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't0', agentId: 'a1' })
    expect(asked).toBe('')
    await $.turn.complete({ reason: 'answer', answer: 'feito', durationMs: 1, isAborted: false, turnId: 't1' })
    await new Promise(r => setTimeout(r, 50))

    const ui = await band($, surface)
    // Context past 200k puts /compact first; the invented /nope was dropped; plus "todas".
    expect((await ui.findAll({ type: 'Button' })).length).toBe(3)
    expect(asked).toContain('testa o router')

    // First pick replaces the draft, the next stacks under it, "todas" adds nothing already there.
    await ui.press({ key: 's1' })
    await ui.press({ key: 's0' })
    await ui.press({ key: 'all' })
    expect(filled).toEqual(['replace:roda o smoke test do router', 'append:\n/compact'])
  })
}
