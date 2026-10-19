import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_AGY, delegateOf, dockText, isRedirected } from './register'

describe('delegateOf', () => {
  test('names the three delegates and nothing else', () => {
    expect(delegateOf('agy --mode plan --model gemini-3.1-pro-high < bundle.txt')).toBe('agy')
    expect(delegateOf('cd x && agy -p "oi"')).toBe('agy')
    expect(delegateOf('codex exec --skip-git-repo-check -s read-only "x"')).toBe('codex')
    expect(delegateOf('ollama run qwen2.5:14b "x"')).toBe('ollama')
    expect(delegateOf('python C:/Users/me/.ollama/batch_llm.py')).toBe('ollama')
    expect(delegateOf('"C:/Users/me/AppData/Local/agy/bin/agy.exe" --mode plan < b.txt')).toBe('agy')
    expect(delegateOf(String.raw`C:\Users\me\AppData\Roaming\npm\codex.cmd exec "x"`)).toBe('codex')
    expect(delegateOf('agy models')).toBe(undefined)
    expect(delegateOf('ollama ps')).toBe(undefined)
    expect(delegateOf('codex --version')).toBe(undefined)
    expect(delegateOf('git log --grep=agy')).toBe(undefined)
  })

  test('redirect to a file, not stderr merges', () => {
    expect(isRedirected('agy < b.txt > out.txt')).toBe(true)
    expect(isRedirected('agy < b.txt >> out.txt')).toBe(true)
    expect(isRedirected('agy < b.txt 2>&1')).toBe(false)
    expect(isRedirected('agy < b.txt 2>/dev/null')).toBe(false)
  })

  test('dock text', () => {
    expect(dockText([], 0)).toBe(undefined)
    expect(dockText([{ tool: 'agy', startedAt: 0, isRedirected: false }, { tool: 'codex', startedAt: 9_000, isRedirected: false }], 12_000)).toBe('⏳ agy 12s · codex 3s')
  })
})

const bash = (command: string, extra: object = {}) => ({ tool: 'Bash' as const, command, ...extra })

test('foreground agy with empty stdout warns the model; with text it passes clean', async ($, on) => {
  let stdout = ''
  const statuses: (string | undefined)[] = []
  on('tool.call', () => ({ result: { stdout, stderr: '', interrupted: false } }) as never)
  on('ui.status', (_$, e) => {
    statuses.push((e as { text?: string }).text)
    return { value: undefined } as never
  })
  on('clock.every', () => ({ value: { cancel() {} } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)

  const empty = await $.tool.call(bash('agy --mode plan < bundle.txt') as never)
  expect(empty.context).toEqual([EMPTY_AGY])
  expect(statuses[0]).toContain('agy')
  expect(statuses.at(-1)).toBe(undefined)

  stdout = 'resposta'
  expect((await $.tool.call(bash('agy --mode plan < bundle.txt') as never)).context).toBe(undefined)
  stdout = ''
  expect((await $.tool.call(bash('ls') as never)).context).toBe(undefined)
})

test('background agy: stays in the dock until its notification, then an empty output file warns', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('tool.call', () =>
    ({ result: { stdout: 'Command running in background with ID: b1. Output is being written to: C:\\t\\b1.output. You will be notified', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }) as never,
  )
  on('ui.status', (_$, e) => {
    statuses.push((e as { text?: string }).text)
    return { value: undefined } as never
  })
  on('clock.every', () => ({ value: { cancel() {} } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  let read = ''
  on('fs.read', (_$, e) => {
    read = String((e as { path: string }).path)
    return { value: '  \n' } as never
  })
  let context: readonly string[] | undefined
  on('prompt.submit', (_$, e) => {
    context = (e as { context?: readonly string[] }).context
    return { text: '' } as never
  })

  await $.tool.call(bash('agy --mode plan < bundle.txt', { run_in_background: true }) as never)
  expect(statuses.at(-1)).toContain('agy')

  await $.prompt.submit({ text: '<task-notification><task-id>b1</task-id><status>completed</status></task-notification>', wait: false, origin: { kind: 'task-notification' } } as never)
  expect(read).toBe('C:\\t\\b1.output')
  expect(context).toEqual([EMPTY_AGY])
  expect(statuses.at(-1)).toBe(undefined)
})
