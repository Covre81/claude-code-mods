import { test, expect } from 'claude-code/testing'
import { register, splitDirs } from './register'

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
  on('env.get', () => ({ value: '/m/clean-view' }) as never)
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
    '/m/novo-mod/.claude-plugin/plugin.json': JSON.stringify({ name: 'novo-mod', description: 'Mod que o painel nunca viu' }),
    '/m/guarda/.claude-plugin/plugin.json': JSON.stringify({ name: 'guarda' }),
  }
  on('env.get', (_$, e) => ({ value: (e as { name: string }).name === 'CLAUDE_CODE_PLUGIN_DIRS' ? '/m/novo-mod:/m/guarda/:/m/sem-manifesto' : undefined }) as never)
  on('fs.read', (_$, e) => {
    const text = disk[(e as { path: string }).path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')] // Windows: the engine prefixes a drive letter
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
  on('env.get', () => ({ value: '/m/zeta:/m/alfa:/m/meio' }) as never)
  on('fs.read', () => ({ deny: 'ENOENT' }) as never)
  register(on, {})

  const mounted = await $.ui.mount({ plugin: 'meus-mods', surface: 'terminal', component: 'Pane', requestId: 'meus-mods-panel', props: PANE_PROPS })
  const names = (await mounted.findAll({ type: 'Text', bold: true })).map(n => n.text).filter(t => ['zeta', 'alfa', 'meio'].includes(t as string))

  expect(names).toEqual(['alfa', 'meio', 'zeta'])
})

// O estado vem do que o clean-view publica no session.start; o painel não
// conhece o default de ninguém. Sem publicação (o mod ainda não iniciou ou não
// carregou) o toggle fica cinza — nem verde, nem vermelho — e não conta como ativo.
const TRACK = { true: '#2ecc71', false: '#ff5252', undefined: '#5c6370' } as const

// find() ignora backgroundColor; a cor do toggle só aparece varrendo a árvore desenhada.
async function backgrounds(mounted: { drawn(): Promise<unknown> }): Promise<string[]> {
  const found: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const { props, children } = node as { props?: { backgroundColor?: unknown }; children?: unknown[] }
    if (typeof props?.backgroundColor === 'string') found.push(props.backgroundColor)
    for (const child of children ?? []) walk(child)
  }
  walk(await mounted.drawn())
  return found
}
for (const [value, expected] of [[undefined, '0 de 1 mods ativos'], [false, '0 de 1 mods ativos'], [true, '1 de 1 mods ativos']] as const) {
  test(`clean-view com estado ${value} aparece como "${expected}" e na cor certa`, async ($, on) => {
    on('env.get', () => ({ value: '/m/clean-view' }) as never)
    on('fs.read', () => ({ value: JSON.stringify({ name: 'clean-view' }) }) as never)
    on('state.get', { plugin: 'clean-view' }, () => ({ value: { value, version: 1 } }) as never)
    register(on, {})

    const mounted = await $.ui.mount({ plugin: 'meus-mods', surface: 'terminal', component: 'Pane', requestId: 'meus-mods-panel', props: PANE_PROPS })

    expect(await mounted.find({ type: 'Text', text: expected })).toBeDefined()
    const colors = await backgrounds(mounted)
    for (const [state, color] of Object.entries(TRACK)) expect(colors.includes(color)).toBe(state === String(value))
  })
}

// Regressão: sessão nova com o painel aberto antes de os mods publicarem o
// estado mostrava todos vermelhos (desligados), como se o usuário os tivesse desligado.
test('mods sem estado publicado não aparecem vermelhos', async ($, on) => {
  on('env.get', () => ({ value: '/m/agent-radar:/m/reflexo:/m/atomic-commit-guard' }) as never)
  on('fs.read', (_$, e) => ({ value: JSON.stringify({ name: (e as { path: string }).path.replace(/\\/g, '/').split('/')[2] }) }) as never)
  register(on, {})

  const mounted = await $.ui.mount({ plugin: 'meus-mods', surface: 'terminal', component: 'Pane', requestId: 'meus-mods-panel', props: PANE_PROPS })

  const colors = await backgrounds(mounted)
  expect(colors.includes(TRACK.false)).toBe(false)
  expect(colors.filter(c => c === TRACK.undefined).length).toBe(3)
  expect(await mounted.find({ type: 'Text', text: 'reflexo' })).toBeDefined()
  expect(await mounted.find({ type: 'Text', text: '0 de 3 mods ativos' })).toBeDefined()
})

// Regressão: no app desktop o Button é nativo e ignora o fundo colorido dos
// filhos, então a pílula de espaços sumia; lá ela é trilho e bolinha coloridos.
for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
  test(`toggle é pílula visível no ${surface}`, async ($, on) => {
    on('env.get', () => ({ value: '/m/clean-view:/m/reflexo' }) as never)
    on('fs.read', (_$, e) => ({ value: JSON.stringify({ name: (e as { path: string }).path.replace(/\\/g, '/').split('/')[2] }) }) as never)
    on('state.get', { plugin: 'clean-view' }, () => ({ value: { value: true, version: 1 } }) as never)
    on('state.get', { plugin: 'reflexo' }, () => ({ value: { value: false, version: 1 } }) as never)
    register(on, {})

    const mounted = await $.ui.mount({ plugin: 'meus-mods', surface, component: 'Pane', requestId: 'meus-mods-panel', props: PANE_PROPS })

    const colors = await backgrounds(mounted)
    expect(colors.includes(TRACK.true) || colors.includes(TRACK.false)).toBe(false)
    expect(await mounted.find({ type: 'Text', text: '━━●', color: TRACK.true })).toBeDefined()
    expect(await mounted.find({ type: 'Text', text: '●━━', color: TRACK.false })).toBeDefined()
    expect(await mounted.find({ type: 'Text', text: /ligado/ })).toBeUndefined()
  })
}

test('reflexo tem toggle e publica o estado no painel', async ($, on) => {
  on('env.get', () => ({ value: '/m/reflexo' }) as never)
  on('fs.read', () => ({ value: JSON.stringify({ name: 'reflexo' }) }) as never)
  on('state.get', { plugin: 'reflexo' }, () => ({ value: { value: true, version: 1 } }) as never)
  register(on, {})

  const mounted = await $.ui.mount({ plugin: 'meus-mods', surface: 'terminal', component: 'Pane', requestId: 'meus-mods-panel', props: PANE_PROPS })

  expect((await backgrounds(mounted)).includes(TRACK.true)).toBe(true)
  expect(await mounted.find({ type: 'Text', text: '1 de 1 mods ativos' })).toBeDefined()
})

// Regressão: no Linux o separador é ':' e todo caminho absoluto começa com '/',
// então ':(?![\\/])' nunca dividia e o painel via um mod só.
test('splitDirs: separador do Linux e do Windows', () => {
  expect(splitDirs('/home/a/m/clean-view:/home/a/m/reflexo')).toEqual(['/home/a/m/clean-view', '/home/a/m/reflexo'])
  expect(splitDirs('/m/a/:/m/b')).toEqual(['/m/a', '/m/b'])
  expect(splitDirs('C:/m/a;C:\\m\\b\\')).toEqual(['C:/m/a', 'C:\\m\\b'])
  expect(splitDirs('C:/m/a')).toEqual(['C:/m/a'])
  expect(splitDirs('')).toEqual([])
})
