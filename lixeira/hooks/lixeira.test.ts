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
