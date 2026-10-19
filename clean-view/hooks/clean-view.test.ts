import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { summarize } from './register'

describe('summarize', () => {
  test('Edit counts added and removed lines', () => {
    const l = summarize('Edit', { file_path: 'a.ts', old_string: 'x\ny', new_string: 'x\ny\nz\nw' }, null)
    expect(l).toEqual({ glyph: '●', tool: 'Edit', target: 'a.ts', note: '+4 −2' })
  })

  test('Bash collapses whitespace and cuts long commands', () => {
    const l = summarize('Bash', { command: `npm   test ${'x'.repeat(200)}` }, null)
    expect(l?.target.startsWith('npm test x')).toBe(true)
    expect(l?.target.length).toBe(70)
  })

  test('Grep and Read summarize their result, tolerating unknown shapes', () => {
    expect(summarize('Grep', { pattern: 'x' }, { numFiles: 3 })?.note).toBe('3 arquivos')
    expect(summarize('Glob', { pattern: 'x' }, { numFiles: 1 })?.note).toBe('1 arquivo')
    expect(summarize('Read', { file_path: 'a' }, { file: { numLines: 212 } })?.note).toBe('212 linhas')
    expect(summarize('Read', { file_path: 'a' }, 'weird')?.note).toBeUndefined()
  })

  test('unknown tools and missing input fall through to the engine block', () => {
    expect(summarize('mcp__x__y', {}, null)).toBeNull()
    expect(summarize('Read', undefined, null)?.target).toBe('')
  })
})

// The engine's own block, beneath the plugin: an empty Box stands in for it.
const AT = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const
const BASH = { tool_use_id: 'toolu_1', tool: 'Bash', input: { command: 'git   status' }, isRunning: false, isErrored: false, isInterrupted: false, output: { stdout: 'x' } }

describe('render', () => {
  test('/clean-view on|off redraws a mounted row without an explicit redraw', async ($, on) => {
    mock.store(on)
    on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
    const row = await $.ui.mount({ plugin: 'clean-view', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_1', props: BASH })
    const summary = () => row.find({ type: 'Text', text: 'git status' })

    expect(await summary()).toBeUndefined()
    await $.command.run({ command: 'clean-view', args: 'on', ...AT })
    expect(await summary()).toBeDefined()
    await $.command.run({ command: 'clean-view', args: 'off', ...AT })
    expect(await summary()).toBeUndefined()
    await row.unmount()
  })

  test('the result block hides under a summarized row, but an error or an interrupt still shows whole', async ($, on) => {
    mock.store(on)
    on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'ENGINE') as never)
    await $.command.run({ command: 'clean-view', args: 'on', ...AT })
    const engineDrew = async (output: unknown, isErrored = false) => {
      const r = await $.ui.mount({ plugin: 'clean-view', surface: 'terminal', component: 'ToolResult', requestId: 'toolu_1', props: { tool_use_id: 'toolu_1', tool: 'Bash', output, isErrored } })
      const found = await r.find({ type: 'Text', text: 'ENGINE' })
      await r.unmount()
      return found !== undefined
    }

    expect(await engineDrew({ stdout: 'x' })).toBe(false)
    expect(await engineDrew({ stdout: 'x' }, true)).toBe(true)
    expect(await engineDrew({ stdout: 'x', interrupted: true })).toBe(true)
  })
})

describe('session.start', () => {
  // Other plugins (the meus-mods panel) cannot see this atom's initial: the
  // state must hold the real value from the start, not read as unset.
  async function published($: Engine, on: On, saved: Record<string, unknown> = {}) {
    mock.store(on, saved)
    const writes: unknown[] = []
    on('state.set', { plugin: 'clean-view' }, ($, e, next) => {
      writes.push((e as { value: unknown }).value)
      return next(e)
    })
    on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
    await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true } as never)
    return writes
  }

  test('publishes the state even when nothing was saved', async ($, on) => {
    expect(await published($, on)).toEqual([false])
  })

  test('a saved choice wins over the initial', async ($, on) => {
    expect(await published($, on, { isEnabled: true })).toEqual([true])
  })
})
