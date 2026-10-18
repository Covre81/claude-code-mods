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

const PANE_PROPS = {
  title: 'Meus Mods',
  isFocused: false,
  bodyColumns: 60,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

test('toggle é feito só de blocos coloridos, sem glifo, igual em qualquer superfície', async ($, on) => {
  register(on, {})

  // Nenhum glifo especial deve sobrar no toggle: nem o Powerline antigo, nem
  // o fallback ◖◗ que não encostava direito em algumas fontes.
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const mounted = await $.ui.mount({ plugin: 'meus-mods', surface, component: 'Pane', requestId: 'meus-mods-panel', props: PANE_PROPS })
    expect(await mounted.find({ type: 'Text', text: '' })).toBeUndefined()
    expect(await mounted.find({ type: 'Text', text: '◖' })).toBeUndefined()
    expect(await mounted.find({ type: 'Text', text: '◗' })).toBeUndefined()
  }
})
