import { describe, expect, mock, test } from 'claude-code/testing'

import { JUSTIFY, cacheRate, diff, fmtIn, fmtMs, forecast, label, sparkline, summary, toolName, trend } from './register'

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

  test('labels name the command, the file or the pattern', () => {
    expect(label('Bash', { command: 'git status\ngit log' })).toBe('git status')
    expect(label('Read', { file_path: 'C:\\Dev\\app\\src\\a.ts' })).toBe('app/src/a.ts')
    expect(label('Grep', { pattern: 'TODO' })).toBe('TODO')
    expect(label('Bash', { command: 'x'.repeat(100) }).length).toBe(70)
    expect(label('Other', {})).toBe('')
    expect(toolName('mcp__ai-memory__memory_query')).toBe('ai-memory: memory_query')
  })

  test('durations, countdowns and cache share', () => {
    expect([450, 2_340, 72_000].map(fmtMs)).toEqual(['450ms', '2.3s', '1m12s'])
    expect([-5, 20 * 60_000, 133 * 60_000, 5 * 86_400_000].map(fmtIn)).toEqual(['instantes', '20min', '2h13', '5d'])
    expect(cacheRate({ input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 })).toBe(90)
    expect(cacheRate({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(null)
  })

  test('summary: errors, tokens, cost delta, limits and model', () => {
    const usage = { model: 'claude-opus-5-5', input_tokens: 200, output_tokens: 812, cache_read_input_tokens: 3_000, cache_creation_input_tokens: 0 }
    const acts = [
      { tool: 'Bash', label: 'ls', ok: true, ms: 10 },
      { tool: 'Bash', label: 'x', ok: false, ms: 10 },
    ]
    expect(summary({ usage, ms: 72_000, costDelta: 0.05 }, acts, 0.42, [{ kind: 'five_hour', percentUsed: 23 }])).toEqual([
      '⏱ 1m12s',
      '2 ferramentas, 1 com erro',
      '↓3.2k ↑812 tok · cache 94%',
      '+$0.050 · sessão $0.420',
      '5h 23%',
      'claude-opus-5-5',
    ])
    expect(summary({ usage: null, ms: 500, costDelta: null }, [], null, [])).toEqual(['⏱ 500ms', '0 ferramentas'])
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
  expect((await idle.findAll({ type: 'Button' })).length).toBe(2)
  await idle.press({ key: 'replay' })

  const pane = await $.ui.mount({ plugin: 'painel', surface: 'terminal', component: 'Pane', requestId: 'replay', props: {} as never })
  expect((await pane.findAll({ type: 'Button' })).length).toBe(3)
  await pane.press({ key: 'next' })
  await pane.press({ key: 'next' }) // clamps at the last step
  const text = JSON.stringify(await pane.findAll({ type: 'Text' }))
  expect(text.includes('- old')).toBe(true) // the Write diff read the file before it was replaced
  expect(text.includes('+ new')).toBe(true)
})

test('terminal: every main-loop tool lands in the activity pane with usage and cost; subagent calls do not', async ($, on) => {
  const clock = mock.clock(on)
  let usd = 0.1
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 20_000, window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: '2099-01-01T00:00:00Z' }], cost: { usd } } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('tool.call', async (_$, e) => {
    const cmd = (e as { command?: string }).command
    if (cmd === 'git status') await clock.sleep(2_300)
    return (cmd === 'false' ? { result: 'exit 1', isError: true } : { result: 'ok' }) as never
  })
  const usage = { model: 'gpt-oss:20b-cloud', input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 }
  on('turn.complete', () => ({ text: '', usage }) as never)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
  const turn = { answer: '', durationMs: 3_000, isAborted: false, turnId: 't', reason: 'answer' }

  await $.turn.complete({ ...turn, turnId: 't0' } as never) // first reading: no delta yet
  usd = 0.25
  const slow = $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  await clock.advance(2_300)
  await slow
  await $.tool.call({ tool: 'Bash', command: 'false' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'C:/Dev/app/src/a.ts' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls sub', agentId: 'sub1' } as never)
  await $.turn.complete({ ...turn, turnId: 't1' } as never)

  const band = await $.ui.mount({ plugin: 'painel', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  const line = JSON.stringify(await band.findAll({ type: 'Text' }))
  expect(line.includes('3 ferramentas, 1 com erro')).toBe(true)
  expect(line.includes('+$0.150 · sessão $0.250')).toBe(true)
  expect(line.includes('gpt-oss:20b-cloud')).toBe(true)
  await band.press({ key: 'atividade' })

  const pane = await $.ui.mount({ plugin: 'painel', surface: 'terminal', component: 'Pane', requestId: 'atividade', props: {} as never })
  const text = JSON.stringify(await pane.findAll({ type: 'Text' }))
  for (const s of ['git status', 'app/src/a.ts', '✗ ', 'cache 90%', '40% usado', 'reseta em']) expect(text.includes(s)).toBe(true)
  expect(text.includes('ls sub')).toBe(false)
  expect(text.includes('2.3s')).toBe(true) // timed on the engine's clock, which is async
})

test('prompt.compose appends the section once', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }) as never)
  const res = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)
  expect(res.sections.map(s => s.id)).toEqual(['intro', 'painel:justificar'])
})
