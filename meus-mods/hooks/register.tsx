import type { Register } from 'claude-code'

const PANEL_ID = 'meus-mods-panel'

const limpoIsEnabled = { plugin: 'tela-limpa', key: 'isEnabled' } as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mods',
      description: 'Abre o painel Meus Mods: estado e atalhos dos mods instalados.',
    })

    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => {
    await $.ui.open({ id: PANEL_ID, title: 'Meus Mods' })
    return { text: 'Painel Meus Mods aberto.' }
  })

  // painel, uso-vivo e next-prompts já disputam o AbovePrompt entre si e
  // resolvem empilhando: cada um pede next(e) primeiro e só então desenha a
  // própria linha por cima do que estiver embaixo. Este hook segue o mesmo
  // padrão para não arrancar a faixa de ninguém.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { value: isLimpo = false } = await $.state.get(limpoIsEnabled)
    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)

    const mine = (
      <Box width={e.props.bodyColumns} flexDirection="row" justifyContent="flex-end" gap={1}>
        <Text dimColor>{isLimpo ? 'tela limpa on' : 'tela limpa off'}</Text>
        <Button
          key="limpo-toggle"
          plain
          hotkey="t"
          onPress={() => $.command.run({ command: 'limpo', args: isLimpo ? 'off' : 'on' })}
        >
          {isLimpo ? 'desligar' : 'ligar'}
        </Button>
        <Text dimColor> · </Text>
        <Button key="open-panel" plain hotkey="m" onPress={() => $.ui.open({ id: PANEL_ID, title: 'Meus Mods' })}>
          <Text color="#D97757">✦ mods</Text>
        </Button>
      </Box>
    )

    return below.type === 'engine' ? mine : (
      <Box flexDirection="column">
        {below}
        {mine}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANEL_ID }, async ($, e) => {
    const { value: isLimpo = false } = await $.state.get(limpoIsEnabled)
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" gap={1}>
        <Text weight="bold">
          <Text color="#D97757">✦</Text> Meus Mods
        </Text>

        <Box flexDirection="column">
          <Text weight="semibold">Tela Limpa · {isLimpo ? 'ativada' : 'desativada'}</Text>
          <Box flexDirection="row" gap={1}>
            <Button
              key="panel-limpo-toggle"
              onPress={() => $.command.run({ command: 'limpo', args: isLimpo ? 'off' : 'on' })}
            >
              {isLimpo ? 'Desligar' : 'Ligar'}
            </Button>
          </Box>
        </Box>

        <Button key="panel-close" role="dismiss" plain onPress={() => $.ui.close({ id: PANEL_ID })}>
          Fechar
        </Button>
      </Box>
    )
  })
}
