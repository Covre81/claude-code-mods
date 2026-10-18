import { expect, mock, test } from 'claude-code/testing'

test('each command is registered exactly once; /painel and /uso-vivo are gone', async ($, on) => {
  const names: string[] = []
  on('command.register', (_$, e) => {
    names.push((e as { name: string }).name)
    return { value: undefined } as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/Dev/x' } as never)
  expect([...names].sort()).toEqual(['atividade', 'memoria', 'monitor', 'replay'])
})

test('/monitor toggles and reports its state', async ($, on) => {
  mock.store(on)
  expect((await $.command.run({ command: 'monitor', args: 'off', origin: { kind: 'composer' }, presentation: 'text' } as never)).text).toBe('monitor desativado.')
  expect((await $.command.run({ command: 'monitor', args: '', origin: { kind: 'composer' }, presentation: 'text' } as never)).text).toContain('desativado')
})
