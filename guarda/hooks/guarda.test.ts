import { describe, expect, mock, test } from 'claude-code/testing'

import { classify, packageName } from './register'

const kindOf = (cmd: string) => classify(cmd)?.kind ?? null

describe('classify', () => {
  test('holds what destroys or adds third-party code', () => {
    const cases: [string, string][] = [
      ['rm -rf node_modules', 'rm'],
      ['rm -f build.log', 'rm'],
      ['sudo rm --recursive /tmp/x', 'rm'],
      ['git reset --hard HEAD~1', 'git-reset'],
      ['git -C /c/Dev/app reset --hard', 'git-reset'],
      ['git clean -fd', 'git-clean'],
      ['git push --force origin main', 'git-push-force'],
      ['git push origin +main', 'git-push-force'],
      ['git push --force-with-lease', 'git-push-force'],
      ['git checkout .', 'git-checkout'],
      ['git restore .', 'git-checkout'],
      ['npm i left-pad', 'deps'],
      ['npm install --save-dev vitest', 'deps'],
      ['pnpm add zod', 'deps'],
      ['yarn add react', 'deps'],
      ['bun add hono', 'deps'],
      ['npx expo install expo-camera', 'deps'],
      ['pip install requests', 'deps'],
      ['python -m pip install -U numpy', 'deps'],
      ['uv add httpx', 'deps'],
      ['cd app && npm run build && rm -rf dist', 'rm'],
    ]
    for (const [cmd, kind] of cases) expect([cmd, kindOf(cmd)]).toEqual([cmd, kind])
  })

  test('lets everyday commands through', () => {
    for (const cmd of [
      'rm file.txt',
      'git restore --staged .',
      'git push',
      'git push origin main',
      'git clean -n',
      'git clean -fdn',
      'git reset HEAD~1',
      'git checkout main',
      'npm install',
      'npm ci',
      'yarn add',
      'pip install -r requirements.txt',
      'pip install -e .',
      'ls -la',
      'echo "rm -rf /"',
    ])
      expect([cmd, kindOf(cmd)]).toEqual([cmd, null])
  })

  test('tracks cd and git -C for where to measure', () => {
    expect(classify('cd /c/Dev/app && git reset --hard')?.dir).toBe('/c/Dev/app')
    expect(classify('cd app && cd sub && rm -rf x')?.dir).toBe('app/sub')
    expect(classify('git -C repo clean -fd')?.dir).toBe('repo')
  })

  test('packageName strips versions, refuses non-registry sources', () => {
    expect(packageName('npm', 'react@18.3.1')).toBe('react')
    expect(packageName('npm', '@types/node@20')).toBe('@types/node')
    expect(packageName('npm', 'github:user/repo')).toBe(null)
    expect(packageName('pip', 'requests==2.32.0')).toBe('requests')
  })
})

test('terminal: a risky PowerShell command waits for Cancelar and is denied', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: ' M a.ts\n M b.ts\n', stderr: '' } }) as never)
  on('session.cwd', () => ({ value: 'C:/Dev/app' }) as never)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
  let ran = false
  on('tool.call', () => {
    ran = true
    return { result: 'ran' } as never
  })

  const call = $.tool.call({ tool: 'PowerShell', command: 'git reset --hard' } as never)
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'guarda', surface: 'terminal', component: 'Pane', requestId: 'guarda', props: {} as never })
  expect((await pane.findAll({ type: 'Button' })).length).toBe(2)
  await pane.press({ key: 'cancel' })
  await clock.advance(300)
  const res = (await call) as { isError?: boolean; text?: string; deny?: string }
  expect(ran).toBe(false)
  expect(String(res.deny ?? res.text).includes('Não tente de novo')).toBe(true)
})
