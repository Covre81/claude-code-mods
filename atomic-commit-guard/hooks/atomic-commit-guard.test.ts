import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { commitMessage, messageProblems, scopeDirs } from './register'

describe('commitMessage', () => {
  test('extrai mensagem de -m simples, flags combinadas, -m duplo, heredoc e ignora -F', () => {
    expect(commitMessage('git commit -m "feat: inicial"')).toBe('feat: inicial')
    expect(commitMessage('git commit -am "fix(ui): botão"')).toBe('fix(ui): botão')
    expect(commitMessage('git commit --message=chore:deps')).toBe('chore:deps')
    expect(commitMessage('git commit -m inline')).toBe('inline')
    expect(commitMessage('git commit -mfeat')).toBe('feat')
    expect(commitMessage('git commit -m "feat: título" -m "Co-Authored-By: Claude <noreply@anthropic.com>"')).toBe(
      'feat: título\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
    )
    const heredocCmd = [
      'git commit -m "$(cat <<\'EOF\'',
      'feat(guarda): valida escopo',
      '',
      'Co-Authored-By: Claude <noreply@anthropic.com>',
      'EOF',
      ')"',
    ].join('\n')
    expect(commitMessage(heredocCmd)).toBe('feat(guarda): valida escopo\n\nCo-Authored-By: Claude <noreply@anthropic.com>')
    expect(commitMessage('git commit -F msg.txt')).toBe(null)
    expect(commitMessage('git commit --amend --no-edit')).toBe(null)
  })
})

describe('messageProblems', () => {
  test('aceita mensagem válida e aponta falta de tipo ou co-autoria', () => {
    expect(messageProblems('feat(api): novo endpoint\n\nCo-Authored-By: Claude <noreply@anthropic.com>')).toEqual([])
    expect(messageProblems('atualiza endpoint\n\nCo-Authored-By: Claude <noreply@anthropic.com>')).toHaveLength(1)
    expect(messageProblems('feat(api): novo endpoint')).toHaveLength(1)
  })
})

describe('scopeDirs', () => {
  test('ignora arquivos na raiz e ordena diretórios de primeiro nível', () => {
    expect(scopeDirs(['README.md', 'package.json', 'guarda/hooks/register.tsx', 'guarda/types.ts'])).toEqual(['guarda'])
    expect(scopeDirs(['README.md', 'session-telemetry/hooks/register.tsx', 'guarda/hooks/register.tsx'])).toEqual([
      'guarda',
      'session-telemetry',
    ])
  })
})

function commitWorld(on: On, stdout: string) {
  let ran = false
  on('process.run', () => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never)
  on('session.cwd', () => ({ value: 'C:/Dev/app' }) as never)
  on('fs.stat', () => ({ value: { kind: 'dir' } }) as never)
  on('tool.call', () => {
    ran = true
    return { result: 'ran' } as never
  })
  return () => ran
}

describe('atomic-commit-guard hook', () => {
  test('commit bom com um diretório executa', async ($, on) => {
    const ran = commitWorld(on, 'README.md\nguarda/hooks/register.tsx\nguarda/hooks/guarda.test.ts\n')
    const command = 'git commit -m "feat(guarda): adiciona regra" -m "Co-Authored-By: Claude <noreply@anthropic.com>"'
    const res = (await $.tool.call({ tool: 'Bash', command } as never)) as { deny?: string }
    expect(res.deny).toBeUndefined()
    expect(ran()).toBe(true)
  })

  test('dois diretórios devolve deny com os nomes dos diretórios e não executa', async ($, on) => {
    const ran = commitWorld(on, 'guarda/hooks/register.tsx\ncofre/hooks/register.tsx\n')
    const command = 'git commit -m "feat: altera dois mods" -m "Co-Authored-By: Claude <noreply@anthropic.com>"'
    const res = (await $.tool.call({ tool: 'Bash', command } as never)) as { deny?: string }
    expect(ran()).toBe(false)
    expect(res.deny).toBeDefined()
    expect(res.deny?.includes('cofre')).toBe(true)
    expect(res.deny?.includes('guarda')).toBe(true)
  })

  test('commit raiz (repo sem HEAD) cruza diretórios e executa', async ($, on) => {
    let ran = false
    on('process.run', (_$, e) => {
      const argv = (e as { argv?: string[] }).argv ?? []
      const noHead = argv.includes('rev-parse')
      return { value: { exitCode: noHead ? 1 : 0, stdout: noHead ? '' : 'guarda/a.ts\ncofre/b.ts\n', stderr: '' } } as never
    })
    on('session.cwd', () => ({ value: 'C:/Dev/app' }) as never)
    on('fs.stat', () => ({ value: { kind: 'dir' } }) as never)
    on('tool.call', () => {
      ran = true
      return { result: 'ran' } as never
    })
    const command = 'git commit -m "feat: initial import" -m "Co-Authored-By: Claude <noreply@anthropic.com>"'
    const res = (await $.tool.call({ tool: 'Bash', command } as never)) as { deny?: string }
    expect(res.deny).toBeUndefined()
    expect(ran).toBe(true)
  })

  test('mensagem fora do padrão devolve deny e não executa', async ($, on) => {
    const ran = commitWorld(on, 'guarda/hooks/register.tsx\n')
    const command = 'git commit -m "arruma bug rápido"'
    const res = (await $.tool.call({ tool: 'Bash', command } as never)) as { deny?: string }
    expect(ran()).toBe(false)
    expect(res.deny).toBeDefined()
  })
})

