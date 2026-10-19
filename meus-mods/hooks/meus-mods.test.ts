import { test, expect } from 'claude-code/testing'
import { register } from './register'

test('/mods registra o comando e abre o painel', async ($, on) => {
  // Nada abaixo do kit de teste desenha paineis de verdade: este fake faz
  // o papel do host, so para a chamada nao rejeitar.
  on('ui.open', () => ({ value: { isPlaced: true } }))
  register(on, {})

  const result = await $.command.run({ command: 'mods', args: '', origin: { kind: 'composer' }, presentation: 'text' } as never)

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
  on('env.get', () => ({ value: 'C:/m/clean-view' }) as never)
  on('fs.read', () => ({ value: JSON.stringify({ name: 'clean-view' }) }) as never)
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

test('lista vem das pastas em CLAUDE_CODE_PLUGIN_DIRS, não de uma lista fixa', async ($, on) => {
  const disk: Record<string, string> = {
    'C:/m/novo-mod/.claude-plugin/plugin.json': JSON.stringify({ name: 'novo-mod', description: 'Mod que o painel nunca viu' }),
    'C:/m/guarda/.claude-plugin/plugin.json': JSON.stringify({ name: 'guarda' }),
  }
  on('env.get', (_$, e) => ({ value: (e as { name: string }).name === 'CLAUDE_CODE_PLUGIN_DIRS' ? 'C:/m/novo-mod;C:\\m\\guarda\\;C:/m/sem-manifesto' : undefined }) as never)
  on('fs.read', (_$, e) => {
    const text = disk[(e as { path: string }).path.replace(/\\/g, '/')]
    return (text === undefined ? { deny: 'ENOENT' } : { value: text }) as never
  })
  register(on, {})

  const mounted = await $.ui.mount({ plugin: 'meus-mods', surface: 'terminal', component: 'Pane', requestId: 'meus-mods-panel', props: PANE_PROPS })

  expect(await mounted.find({ type: 'Text', text: 'novo-mod' })).toBeDefined()
  expect(await mounted.find({ type: 'Text', text: 'Mod que o painel nunca viu' })).toBeDefined()
  expect(await mounted.find({ type: 'Text', text: 'guarda' })).toBeDefined()
  expect(await mounted.find({ type: 'Text', text: 'sem-manifesto' })).toBeDefined()
  expect(await mounted.find({ type: 'Text', text: '3 de 3 mods ativos' })).toBeDefined()
})

test('mods aparecem em ordem alfabética', async ($, on) => {
  on('env.get', () => ({ value: 'C:/m/zeta;C:/m/alfa;C:/m/meio' }) as never)
  on('fs.read', () => ({ deny: 'ENOENT' }) as never)
  register(on, {})

  const mounted = await $.ui.mount({ plugin: 'meus-mods', surface: 'terminal', component: 'Pane', requestId: 'meus-mods-panel', props: PANE_PROPS })
  const names = (await mounted.findAll({ type: 'Text', bold: true })).map(n => n.text).filter(t => ['zeta', 'alfa', 'meio'].includes(t as string))

  expect(names).toEqual(['alfa', 'meio', 'zeta'])
})
