import { describe, expect, mock, test } from 'claude-code/testing'

import { JUSTIFY, diff, forecast, sparkline, trend } from './register'

describe('pure parts', () => {
  test('forecast bands', () => {
    expect([10, 30, 60, 80, 95].map(p => forecast(p).label)).toEqual(['Céu limpo', 'Nublado', 'Chuva', 'Tempestade', 'Vai compactar'])
  })

  test('sparkline and trend', () => {
    expect(sparkline([0, 50, 100])).toBe('▁▅█')
    expect(trend([10_000, 13_000])).toBe('▲ +3k no último turno')
    expect(trend([10_000])).toBe('')
  })

  test('diff: changes with one line of context, gaps elided', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n')
    const after = ['a', 'B', 'c', 'd', 'e', 'f', 'G'].join('\n')
    expect(diff(before, after)).toEqual([
      { sign: ' ', text: 'a' },
      { sign: '+', text: 'B' },
      { sign: '-', text: 'b' },
      { sign: ' ', text: 'c' },
      { sign: '…', text: '' },
      { sign: ' ', text: 'f' },
      { sign: '+', text: 'G' },
      { sign: '-', text: 'g' },
    ])
    expect(diff('', 'x\ny')).toEqual([
      { sign: '+', text: 'x' },
      { sign: '+', text: 'y' },
    ])
  })

  test('the system prompt section never varies', () => {
    expect(JUSTIFY.scope).toBe('session')
    expect(/\d{4}-\d{2}|\d+:\d+/.test(JUSTIFY.text)).toBe(false)
  })
})

test('terminal: band yields while working, shows weather and replay when idle; replay pane steps', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 120_000, window: 200_000, percent: 60 }, rateLimits: [] } }) as never)
  let disk = 'old\nline' // the Write mock replaces it, as the real tool would
  on('fs.read', () => ({ value: disk }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('tool.call', (_$, e) => {
    const c = (e as { content?: string }).content
    if (c !== undefined) disk = c
    return { result: 'ok' } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)

  await $.tool.call({ tool: 'Edit', file_path: 'C:/Dev/app/a.ts', old_string: 'x = 1', new_string: 'x = 2' } as never)
  await $.tool.call({ tool: 'Write', file_path: 'C:/Dev/app/b.ts', content: 'new\nline' } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)

  const busy = await $.ui.mount({ plugin: 'painel', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true } as never })
  expect((await busy.findAll({ type: 'Button' })).length).toBe(0)

  const idle = await $.ui.mount({ plugin: 'painel', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect((await idle.findAll({ type: 'Button' })).length).toBe(1)
  await idle.press({ key: 'replay' })

  const pane = await $.ui.mount({ plugin: 'painel', surface: 'terminal', component: 'Pane', requestId: 'replay', props: {} as never })
  expect((await pane.findAll({ type: 'Button' })).length).toBe(3)
  await pane.press({ key: 'next' })
  await pane.press({ key: 'next' }) // clamps at the last step
  const text = JSON.stringify(await pane.findAll({ type: 'Text' }))
  expect(text.includes('- old')).toBe(true) // the Write diff read the file before it was replaced
  expect(text.includes('+ new')).toBe(true)
})

test('prompt.compose appends the section once', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }) as never)
  const res = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)
  expect(res.sections.map(s => s.id)).toEqual(['intro', 'painel:justificar'])
})
