import { test, expect } from 'claude-code/testing'
import { register } from './register'

test('/mods registra o comando e abre o painel', async ($, on) => {
  // Nada abaixo do kit de teste desenha paineis de verdade: este fake faz
  // o papel do host, so para a chamada nao rejeitar.
  on('ui.open', () => ({ value: { isPlaced: true } }))
  register(on, {})

  const result = await $.command.run({ command: 'mods', args: '' })

  expect(result.text).toContain('Painel Meus Mods aberto')
})
