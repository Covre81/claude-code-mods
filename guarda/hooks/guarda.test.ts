import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { classify, commitCandidate, packageName } from './register'

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

describe('commitCandidate', () => {
  test('git add and commit are candidates, classify ignores them', () => {
    expect(commitCandidate('git add .env')?.label).toBe('git add')
    expect(commitCandidate('cd app && git -C sub commit -am "x"')?.dir).toBe('app/sub')
    expect(commitCandidate('git status')).toBe(null)
    expect(classify('git add . && git push --force')?.kind).toBe('git-push-force')
  })
})

function gitAddWorld(on: On, stdout: string | ((cmd: string[]) => string), cwd: object = { value: 'C:/Dev/app' }) {
  let ran = false
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('process.run', (_$, e) => ({ value: { exitCode: 0, stdout: typeof stdout === 'string' ? stdout : stdout((e as { argv?: string[] }).argv ?? []), stderr: '' } }) as never)
  on('session.cwd', () => cwd as never)
  on('fs.stat', () => ({ value: { kind: 'dir' } }) as never)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
  on('tool.call', () => {
    ran = true
    return { result: 'ran' } as never
  })
  return () => ran
}

test('terminal: git add of a .env is held as secret-commit', async ($, on) => {
  const clock = mock.clock(on)
  const ran = gitAddWorld(on, "add '.env'\nadd 'src/a.ts'\n")
  const call = $.tool.call({ tool: 'Bash', command: 'git add -A' } as never)
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'guarda', surface: 'terminal', component: 'Pane', requestId: 'guarda', props: {} as never })
  expect(JSON.stringify(await pane.findAll({ type: 'Text' })).includes('.env')).toBe(true)
  await pane.press({ key: 'cancel' })
  await clock.advance(300)
  const res = (await call) as { deny?: string; text?: string }
  expect(ran()).toBe(false)
  expect(String(res.deny ?? res.text).includes('arquivo de segredo')).toBe(true)
})

test('terminal: a secret in a later git add of the line is still held', async ($, on) => {
  const clock = mock.clock(on)
  const ran = gitAddWorld(on, cmd => (cmd.includes('.env') ? "add '.env'\n" : "add 'src/a.ts'\n"))
  const call = $.tool.call({ tool: 'Bash', command: 'git add src/ && git add .env && git commit -m x' } as never)
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'guarda', surface: 'terminal', component: 'Pane', requestId: 'guarda', props: {} as never })
  await pane.press({ key: 'cancel' })
  await clock.advance(300)
  const res = (await call) as { deny?: string; text?: string }
  expect(ran()).toBe(false)
  expect(String(res.deny ?? res.text).includes('arquivo de segredo')).toBe(true)
})

test('terminal: git add without secrets passes untouched', async ($, on) => {
  const ran = gitAddWorld(on, "add 'src/a.ts'\n")
  await $.tool.call({ tool: 'Bash', command: 'git add src/' } as never)
  expect(ran()).toBe(true)
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

test('terminal: git rm --cached .env && git commit is not held (removals are filtered out)', async ($, on) => {
  const ran = gitAddWorld(on, cmd => (cmd.includes('--diff-filter=d') ? '' : '.env\n'))
  await $.tool.call({ tool: 'Bash', command: 'git rm --cached .env && git commit -m tira' } as never)
  expect(ran()).toBe(true)
})

test('terminal: session.cwd failing lets a lone git add pass', async ($, on) => {
  const ran = gitAddWorld(on, "add '.env'\n", { deny: 'cwd indisponível' })
  await $.tool.call({ tool: 'Bash', command: 'git add .env' } as never)
  expect(ran()).toBe(true)
})

test('terminal: session.cwd failing still holds the classify risks of the same line', async ($, on) => {
  const ran = gitAddWorld(on, cmd => (cmd[0] === 'add' ? "add '.env'\n" : ' M a.ts\n'), { deny: 'cwd indisponível' })
  const res = (await $.tool.call({ tool: 'Bash', command: 'git add . && git reset --hard' } as never)) as { deny?: string; text?: string }
  expect(ran()).toBe(false)
  expect(String(res.deny ?? res.text).includes('Não tente de novo')).toBe(true)
})
