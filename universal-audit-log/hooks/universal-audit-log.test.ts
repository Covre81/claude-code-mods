// Run with: claude plugin test universal-audit-log
import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { redact } from './register'

type World = { files: Record<string, string>; logged: string[] }

/** The environment the mod sees; `null` withholds that variable (the engine denies it). */
type Env = Record<string, string | null>

function fakeEngine(on: On, w: World, toolResult: object = { result: { ok: true } }, env: Env = { USERPROFILE: 'C:\\Users\\u' }) {
  on('env.get', (_$, e) => {
    const value = env[(e as unknown as { name: string }).name]
    return (value === null ? { deny: 'withheld' } : { value }) as never
  })
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
  on('tool.call', () => toolResult as never)
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

  test('the default log lives under the Claude config dir, not the working directory', async ($, on) => {
    const w: World = { files: {}, logged: [] }
    fakeEngine(on, w)

    await $.tool.call({ tool: 'Read', path: 'foo.ts' } as never)
    await $.turn.complete(answered)

    expect(Object.keys(w.files).map((p) => p.replace(/\\/g, '/'))).toEqual(['C:/Users/u/.claude/logs/mods-audit.jsonl'])
  })

  test('CLAUDE_CONFIG_DIR wins over the home, and its trailing slash is dropped', async ($, on) => {
    const w: World = { files: {}, logged: [] }
    fakeEngine(on, w, undefined, { CLAUDE_CONFIG_DIR: 'D:\\cfg\\', USERPROFILE: 'C:\\Users\\u' })

    await $.tool.call({ tool: 'Read', path: 'foo.ts' } as never)
    await $.turn.complete(answered)

    expect(Object.keys(w.files).map((p) => p.replace(/\\/g, '/'))).toEqual(['D:/cfg/logs/mods-audit.jsonl'])
  })

  test('a withheld variable does not stop the next one from being tried', async ($, on) => {
    const w: World = { files: {}, logged: [] }
    fakeEngine(on, w, undefined, { CLAUDE_CONFIG_DIR: null, HOME: null, USERPROFILE: 'C:\\Users\\u' })

    await $.tool.call({ tool: 'Read', path: 'foo.ts' } as never)
    await $.turn.complete(answered)

    expect(Object.keys(w.files).map((p) => p.replace(/\\/g, '/'))).toEqual(['C:/Users/u/.claude/logs/mods-audit.jsonl'])
    // falling back to the home past a configured dir is said, not silent
    expect(w.logged.filter((l) => l.includes('CLAUDE_CONFIG_DIR withheld'))).toHaveLength(1)
  })

  test('an unset CLAUDE_CONFIG_DIR is not a warning', async ($, on) => {
    const w: World = { files: {}, logged: [] }
    fakeEngine(on, w)

    await $.tool.call({ tool: 'Read', path: 'foo.ts' } as never)
    await $.turn.complete(answered)

    expect(w.logged).toEqual([])
  })

  test('with no home to resolve, nothing lands in the working directory: it warns and retries next turn', async ($, on) => {
    const w: World = { files: {}, logged: [] }
    const env: Env = { USERPROFILE: null }
    fakeEngine(on, w, undefined, env)

    await $.tool.call({ tool: 'Read', path: 'a.ts' } as never)
    await $.turn.complete(answered)
    expect(Object.keys(w.files)).toEqual([])
    expect(w.logged.some((l) => l.includes('keeping the lines'))).toBe(true)

    // a second miss does not repeat the warning
    await $.tool.call({ tool: 'Read', path: 'a2.ts' } as never)
    await $.turn.complete(answered)
    expect(w.logged.filter((l) => l.includes('keeping the lines'))).toHaveLength(1)

    env.USERPROFILE = 'C:\\Users\\u'
    await $.tool.call({ tool: 'Read', path: 'b.ts' } as never)
    await $.turn.complete(answered)
    expect(Object.keys(w.files).map((p) => p.replace(/\\/g, '/'))).toEqual(['C:/Users/u/.claude/logs/mods-audit.jsonl'])
    // the lines held back on the first turn are written with the second
    expect((logContent(w) ?? '').includes('a.ts')).toBe(true)
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
    // the absence checks above hold on an empty log too: the redacted lines must be there
    const call = recorded.find((r) => r.event === 'tool.call')
    expect(String(call?.input.command)).toContain('Bearer •••')
    const check = recorded.find((r) => r.event === 'tool.check')
    expect(String(check?.input.input)).toContain('run')
  })

  // A throwing hook is skipped by the engine (fail-open), so a hook's own text
  // reaches the outcome only through a denial.
  test('a secret quoted in a denial never reaches the outcome', async ($, on) => {
    const w: World = { files: {}, logged: [] }
    const key = ['sk', 'ant', 'api03', 'FAKE'.repeat(6)].join('-')
    fakeEngine(on, w, { deny: `refused: ANTHROPIC_API_KEY=${key}` })

    await $.tool.call({ tool: 'Bash', command: 'run' } as never).catch(() => undefined)
    await $.turn.complete(answered)

    const text = logContent(w) ?? ''
    expect(text.includes('FAKEFAKE')).toBe(false)
    const log = text.trim().split('\n').map((l) => JSON.parse(l) as { event: string; outcome: string }).find((r) => r.event === 'tool.call')
    expect(log?.outcome.startsWith('denied: refused:')).toBe(true)
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

// Each pattern on its own; fixtures are built at run time so the cofre mod
// does not mask them when this file is written.
describe('redact', () => {
  const pk = ['PRIVATE', 'KEY'].join(' ')
  test('a PEM private key, whole or cut before its END line', () => {
    expect(redact(`a -----BEGIN RSA ${pk}-----\nMIIabc\n-----END RSA ${pk}----- b`)).toBe('a ••• b')
    expect(redact(`a -----BEGIN ${pk}-----\nMIIabc`)).toBe('a •••')
  })
  test('a JWT and a Google API key', () => {
    const jwt = ['eyJ' + 'a'.repeat(12), 'eyJ' + 'b'.repeat(12), 'c'.repeat(12)].join('.')
    expect(redact(`see ${jwt} ok`)).toBe('see ••• ok')
    expect(redact(`k=${'AIza' + 'x'.repeat(35)}`)).toBe('k=•••')
  })
  test('--token / --api-key flags', () => {
    expect(redact('gh --token abc123456 --api-key=zz9 run')).toBe('gh --token ••• --api-key=••• run')
  })
  test('the password in a URL, keeping the user and host', () => {
    expect(redact('git clone https://bruno:s3cretpw@github.com/x')).toBe('git clone https://bruno:•••@github.com/x')
  })
  test('lowercase password= and api_key:, quoted or not', () => {
    expect(redact('password="a b c" api_key: xyz')).toBe('password=••• api_key: •••')
  })
  test('plain commands pass through untouched', () => {
    for (const s of ['git status --short', 'cat README.md', 'npm run test -- --watch']) expect(redact(s)).toBe(s)
  })
})
