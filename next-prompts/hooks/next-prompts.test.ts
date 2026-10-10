import { describe, expect, test } from 'claude-code/testing'

import { parseSuggestions } from './register'

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

  test('garbage gives nothing instead of throwing', () => {
    expect(parseSuggestions('not json', KNOWN)).toEqual([])
    expect(parseSuggestions('{"suggestions": 3}', KNOWN)).toEqual([])
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: after a turn the band offers the model's suggestions and a press drafts one`, async ($, on) => {
    const filled: string[] = []
    let asked = ''
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 250_000, window: 1_000_000, percent: 25 }, rateLimits: [], cost: null } }) as never)
    on('command.list', () => ({ value: [{ name: 'compact', description: '', source: 'builtin' }] }) as never)
    on('session.messages', () => ({ value: [{ role: 'user', text: 'testa o router', toolUses: [] }] }) as never)
    on('http.fetch', (_$, e) => {
      asked = String((e as { init?: { body?: string } }).init?.body ?? '')
      const content = '```json\n{"suggestions":[{"label":"testar","text":"roda o smoke test do router"},{"label":"fake","text":"/nope"}]}\n```'
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ message: { content } }) } } as never
    })
    on('prompt.fill', (_$, e) => {
      const { text, mode } = e as { text: string; mode: string }
      filled.push(`${mode}:${text}`)
      return { isFilled: true } as never
    })
    on('turn.complete', () => ({ text: '' }))
    // Beneath the plugin: an empty Box, what the engine shows when the band has nothing.
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return h(Box, {}) as never
    })

    // A subagent's turn must not spend a model call.
    await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't0', agentId: 'a1' })
    expect(asked).toBe('')
    await $.turn.complete({ reason: 'answer', answer: 'feito', durationMs: 1, isAborted: false, turnId: 't1' })
    // The refresh runs unawaited after the turn; give its mocked calls a tick to settle.
    await new Promise(r => setTimeout(r, 50))

    const ui = await $.ui.mount({
      plugin: 'next-prompts',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false } as never,
    })
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
