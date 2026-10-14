import { test, expect } from 'claude-code/testing'
import { register } from './register'

test('comeca desativada e /limpo sem argumento so informa o estado', async ($, on) => {
  register(on, {})

  const result = await $.command.run({ command: 'limpo', args: '' })

  expect(result.text).toContain('desativada')
})

test('/limpo on ativa e /limpo off desativa', async ($, on) => {
  register(on, {})

  const on1 = await $.command.run({ command: 'limpo', args: 'on' })
  expect(on1.text).toContain('ativada')

  const status = await $.command.run({ command: 'limpo', args: '' })
  expect(status.text).toContain('esta ativada')

  const off1 = await $.command.run({ command: 'limpo', args: 'off' })
  expect(off1.text).toContain('desativada')
})

test('um argumento desconhecido nao muda o estado armazenado', async ($, on) => {
  register(on, {})

  await $.command.run({ command: 'limpo', args: 'talvez' })

  const status = await $.command.run({ command: 'limpo', args: '' })
  expect(status.text).toContain('esta desativada')
})
