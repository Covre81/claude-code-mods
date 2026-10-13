import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { hasDelete, rewrite } from './register'

describe('hasDelete bash', () => {
  test('rm as a command, after cd, after prefixes', () => {
    for (const c of ['rm a', 'rm -rf dist', 'cd x && rm *.log', 'sudo rm a', 'X=1 rm a', 'ls; rm a', 'npm test || rm -f out'])
      expect([c, hasDelete(c, 'bash')]).toEqual([c, true])
  })

  test('rm as an argument, inside a word or quoted, does not count', () => {
    for (const c of ['grep rm a', 'npm run rm-cache', 'echo "rm x"', './rm.sh', 'git rm a', 'ls -la'])
      expect([c, hasDelete(c, 'bash')]).toEqual([c, false])
  })
})

describe('hasDelete powershell', () => {
  test('aliases in command position, any case', () => {
    for (const c of ['Remove-Item a', 'del a', 'rd x -Recurse', 'gci *.tmp | Remove-Item', 'cd x; rm a', 'ls | % { ri $_ }', 'ERASE a', 'x\nrmdir y'])
      expect([c, hasDelete(c, 'powershell')]).toEqual([c, true])
  })

  test('names as arguments do not count', () => {
    for (const c of ['Get-Item rm', 'Write-Host del', 'Get-ChildItem', 'git rm a'])
      expect([c, hasDelete(c, 'powershell')]).toEqual([c, false])
  })
})

describe('rewrite', () => {
  test('bash: rm function first, original command intact at the end', () => {
    const out = rewrite('rm -rf "a b"', 'bash', 'C:/m/lixeira/hooks')
    expect(out).toBe(`rm() { powershell.exe -NoProfile -NonInteractive -File 'C:/m/lixeira/hooks/lixeira.ps1' "$@"; }; rm -rf "a b"`)
  })

  test('powershell: dot-sources the shadow, original command intact at the end', () => {
    expect(rewrite('del a', 'powershell', 'C:/m/lixeira/hooks')).toBe(`. 'C:/m/lixeira/hooks/remove-item.ps1'; del a`)
  })
})

function shell(on: On) {
  const ran: string[] = []
  on('tool.call', (_$, e) => {
    ran.push(String((e as { command?: unknown }).command))
    return { result: { stdout: '', stderr: '' } } as never
  })
  return ran
}

test('a command without delete reaches the shell unchanged', async ($, on) => {
  const ran = shell(on)
  await $.tool.call({ tool: 'Bash', command: 'ls -la' } as never)
  await $.tool.call({ tool: 'PowerShell', command: 'Get-ChildItem' } as never)
  expect(ran).toEqual(['ls -la', 'Get-ChildItem'])
})

test('rm and Remove-Item reach the shell rewritten, original at the end', async ($, on) => {
  const ran = shell(on)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf dist' } as never)
  await $.tool.call({ tool: 'PowerShell', command: 'del a.txt' } as never)
  expect(ran[0]!.startsWith('rm() { powershell.exe')).toBe(true)
  expect(ran[0]!.endsWith('/hooks/lixeira.ps1\' "$@"; }; rm -rf dist')).toBe(true)
  expect(ran[1]!.endsWith("/hooks/remove-item.ps1'; del a.txt")).toBe(true)
})

test('a failure after the rewritten command ran never runs the original', async ($, on) => {
  const ran: string[] = []
  on('tool.call', (_$, e) => {
    ran.push(String((e as { command?: unknown }).command))
    throw new Error('boom')
  })
  await $.tool.call({ tool: 'Bash', command: 'rm a.txt' } as never).catch(() => undefined)
  expect(ran.length).toBe(1)
  expect(ran[0]!.includes('lixeira.ps1')).toBe(true)
})
