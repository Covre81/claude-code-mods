// Run with: claude plugin test universal-audit-log
import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

type World = { files: Record<string, string>; logged: string[] }

function fakeEngine(on: On, w: World) {
  on('fs.exists', (_$, e) => ({ value: (e as unknown as { path: string }).path in w.files }) as never)
  on('fs.read', (_$, e) => ({ value: w.files[(e as unknown as { path: string }).path] ?? '' }) as never)
  on('fs.write', (_$, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    w.files[path] = text
    return { value: undefined } as never
  })
  on('ui.log', (_$, e) => {
    w.logged.push(String((e as unknown as { text: string }).text))
    return { value: undefined } as never
  })
  on('tool.call', () => ({ result: { ok: true } }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
}

// $.fs resolves ".claude/logs/mods-audit.jsonl" to an absolute path under the
// working directory, so look the written file up by suffix rather than by
// the relative option string.
const logContent = (w: World) => Object.entries(w.files).find(([path]) => path.endsWith('mods-audit.jsonl'))?.[1]
const ORIGIN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const answered = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never

describe('universal-audit-log', () => {
  test('a tool.call is recorded and flushed at turn.complete', async ($, on) => {
    const w: World = { files: {}, logged: [] }
    fakeEngine(on, w)

    await $.tool.call({ tool: 'Read', path: 'foo.ts' } as never)
    await $.turn.complete(answered)

    const lines = (logContent(w) ?? '').trim().split('\n').filter(Boolean)
    expect(lines.length > 0).toBe(true)
    const recorded = lines.map((l) => JSON.parse(l) as { event: string })
    expect(recorded.some((r) => r.event === 'tool.call')).toBe(true)
  })

  test('secrets in a tool.call command or a tool.check input never reach the file', async ($, on) => {
    const w: World = { files: {}, logged: [] }
    fakeEngine(on, w)
    on('tool.check', () => ({ decision: 'allow' }) as never)
    // built at run time: the cofre mod masks a literal key when this file is written
    const key = ['sk', 'ant', 'api03', 'FAKE'.repeat(6)].join('-')
    const aws = 'AKIA' + 'ABCDEFGHIJKLMNOP'

    await $.tool.call({ tool: 'Bash', command: `curl -H "Authorization: Bearer ${key}" x` } as never)
    await $.tool.check({ tool: 'Bash', input: { command: `AWS_ACCESS_KEY=${aws} ANTHROPIC_API_KEY=${key} run` } } as never)
    await $.turn.complete(answered)

    const text = logContent(w) ?? ''
    expect(text.includes('FAKEFAKE')).toBe(false)
    expect(text.includes(aws)).toBe(false)
    const recorded = text.trim().split('\n').map((l) => JSON.parse(l) as { event: string; input: Record<string, unknown> })
    const check = recorded.find((r) => r.event === 'tool.check')
    expect(String(check?.input.input)).toContain('run')
  })

  test('/universal-audit-log off stops recording new lines', async ($, on) => {
    mock.store(on)
    const w: World = { files: {}, logged: [] }
    fakeEngine(on, w)

    const off = await $.command.run({ command: 'universal-audit-log', args: 'off', ...ORIGIN })
    expect((off as { text?: string }).text).toBe('universal-audit-log desativado.')

    await $.tool.call({ tool: 'Read', path: 'foo.ts' } as never)
    await $.turn.complete(answered)

    expect(logContent(w)).toBeUndefined()
  })

  test('/universal-audit-log with no argument reports the current state', async ($, on) => {
    fakeEngine(on, { files: {}, logged: [] })
    const status = await $.command.run({ command: 'universal-audit-log', args: '', ...ORIGIN })
    expect((status as { text?: string }).text).toBe(
      'universal-audit-log esta ativado. Uso: /universal-audit-log on · /universal-audit-log off',
    )
  })
})
