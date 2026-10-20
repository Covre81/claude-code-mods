import { describe, expect, test } from 'claude-code/testing'

import { describe as label, elapsed, isShown } from '../hooks/register'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120 } }
const PANE = { component: 'Pane', requestId: 'agent-radar', props: { title: 'Agent Radar', isFocused: true, bodyColumns: 100, placement: 'dock' } }

// Stands for the engine beneath the mod.
function engine(on: any, files: Record<string, string> = {}, beneath?: unknown, model = 'sonnet') {
  const toasts: string[] = []
  // On Windows the engine hands the hook C:\home\me\... for /home/me/...: compare without drive and with / only.
  const posix = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const disk = Object.fromEntries(Object.entries(files).map(([p, text]) => [posix(p), text]))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('fs.exists', (_$: any, e: any) => ({ value: posix(e.path) in disk }))
  on('fs.read', (_$: any, e: any) => ({ value: disk[posix(e.path)] ?? '' }))
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('agent.spawn', () => ({ model, agentId: 'a1' }))
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_$: any, e: any) { return { answer: '', stopReason: 'end_turn', toolUses: [], usage: e.mockUsage ?? null } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.render', ($: any, e: any) => beneath ?? $.ui.resolve(e).Text({ children: 'band below' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Run the sweep', toolUses: [] }, { role: 'assistant', text: 'Sweep is at trial 12 of 40.', toolUses: [] }] }))
  return { toasts }
}

describe('agent-radar', () => {
  test('helpers', () => {
    expect(elapsed({ startedAt: 0, endedAt: 252_000 })).toBe('4m 12s')
    expect(elapsed({ startedAt: 0, endedAt: 9_000 })).toBe('9s')
    expect(label({ tool: 'mcp__plugin_playwright_playwright__browser_click' })).toBe('browser: click')
    const done = (ago: number) => ({ id: 'x', description: 'd', type: 't', model: 'm', tokens: 0, status: 'done' as const, startedAt: 0, endedAt: Date.now() - ago, tools: 0, last: '' })
    expect(isShown(done(5_000))).toBe(true)
    expect([done(600_000)].filter(a => isShown(a))).toEqual([]) // gone after 30 s
  })

  test('a spawned agent shows in the pane, opens to its messages, and toasts when done', async ($, on) => {
    const { toasts } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn({ prompt: 'run it', description: 'sweep runner' } as any)

    const band = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: / ● sweep runner/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /band below/ })).toBeDefined()
    // the radar sits on top: what other mods draw stays below it
    const root: any = await band.drawn()
    expect(root.props.key).toBe('bands')
    expect(root.children.map((c: any) => c.props?.key)).toEqual(['band:agent-radar', undefined])

    const r = await $.command.run({ command: 'radar', args: '' } as any)
    expect(r.text).toBe('1 running, 0 finished')

    const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: /1 running · 0 finished/ })).toBeDefined()
    expect(await ui.find({ key: 'agent-a1' })).toBeDefined()

    await ui.press({ key: 'agent-a1' })
    expect(await ui.find({ type: 'Text', text: /Sweep is at trial 12 of 40/ })).toBeDefined()
    await ui.press({ key: 'back' })

    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, agentId: 'a1' } as any)
    expect(toasts[0]).toMatch(/^✓ sweep runner done \(\d+s · 0 tools\)$/)
    expect(await ui.find({ type: 'Text', text: /0 running · 1 finished/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: / ✓ sweep runner/ })).toBeDefined() // still shown for 30 s
    await ui.unmount()
    await band.unmount()
  })

  test('model and tokens show in the band', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn({ prompt: 'run it', description: 'sweep runner' } as any)

    const band = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /sonnet/ })).toBeDefined()

    const step: any = $.turn.step({ model: 'sonnet', mockUsage: { model: 'sonnet', input_tokens: 1000, output_tokens: 500 }, agentId: 'a1' } as any)
    if (step[Symbol.asyncIterator]) for await (const _ of step); else await step
    expect(await band.find({ type: 'Text', text: /1\.5k tok/ })).toBeDefined()

    await $.turn.complete({ reason: 'answer', answer: 'done', usage: { model: 'sonnet', input_tokens: 1200, output_tokens: 800 }, agentId: 'a1' } as any)
    expect(await band.find({ type: 'Text', text: /2k tok/ })).toBeDefined()
    await band.unmount()
  })

  test('an unknown model and no tokens yet are left out, not shown as placeholders', async ($, on) => {
    engine(on, {}, undefined, '') // the engine reports no model
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn({ prompt: 'run it', description: 'sweep runner' } as any)
    const band = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /sweep runner/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /unknown|0 tok/ })).toBeUndefined()
    await band.unmount()
  })

  test('TodoWrite progress shows as N/M tarefas and survives later tool calls', async ($, on) => {
    engine(on)
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn({ prompt: 'run it', description: 'sweep runner' } as any)
    const band = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND } as any)
    const todos = Array.from({ length: 7 }, (_, i) => ({ content: `t${i}`, activeForm: `t${i}`, status: i < 3 ? 'completed' : 'pending' }))
    await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'u1', todos, agentId: 'a1' } as any)
    expect(await band.find({ type: 'Text', text: /3\/7 tarefas/ })).toBeDefined()
    await $.tool.call({ tool: 'Read', tool_use_id: 'u2', file_path: '/work/x.ts', agentId: 'a1' } as any)
    expect(await band.find({ type: 'Text', text: /3\/7 tarefas/ })).toBeDefined()
    await band.unmount()
  })

  test('follows the band order file', async ($, on) => {
    // another band mod drew its column beneath
    const beneath = {
      type: 'Box',
      props: { key: 'bands', flexDirection: 'column' },
      children: [{ type: 'Box', props: { key: 'band:where-am-i' }, children: [{ type: 'Text', children: ['here'] }] }],
    }
    engine(on, { '/home/me/.claude/claude-code-mods/bands.json': '{"order":["where-am-i","agent-radar"]}' }, beneath)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn({ prompt: 'run it', description: 'sweep runner' } as any)
    const band = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND } as any)
    const root: any = await band.drawn()
    expect(root.children.map((c: any) => c.props.key)).toEqual(['band:where-am-i', 'band:agent-radar'])
    await band.unmount()
  })
})
