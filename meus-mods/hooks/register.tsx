import type { Register } from 'claude-code'

const PANEL_ID = 'meus-mods-panel'
const DEFAULT_VOLUME = 40
const VOLUME_STEP = 10

const radioIsPlaying = { plugin: 'lowfi-radio', key: 'isPlaying' } as const
const radioVolume = { plugin: 'lowfi-radio', key: 'volume' } as const
const limpoIsEnabled = { plugin: 'tela-limpa', key: 'isEnabled' } as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mods',
      description:
        'Abre o painel Meus Mods: estado e atalhos da Radio Lo-Fi e da Tela Limpa.',
    })

    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => {
    await $.ui.open({ id: PANEL_ID, title: 'Meus Mods' })
    return { text: 'Painel Meus Mods aberto.' }
  })

  // Faixa fixa acima do prompt: unica dona do AbovePrompt deste conjunto de
  // mods, para nao disputar a mesma linha com outro hook. A Radio Lo-Fi e a
  // Tela Limpa continuam funcionando sozinhas (comandos e barra de status
  // proprios) mesmo sem este mod instalado.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { value: isPlaying = false } = await $.state.get(radioIsPlaying)
    const { value: volume = DEFAULT_VOLUME } = await $.state.get(radioVolume)
    const { value: isLimpo = false } = await $.state.get(limpoIsEnabled)

    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box width={e.props.bodyColumns} flexDirection="row" justifyContent="flex-end" gap={1}>
        <Text dimColor>{isPlaying ? `♪ radio ${volume}%` : 'radio off'}</Text>
        <Button key="radio-toggle" plain hotkey="r" onPress={() => $.command.run({ command: 'lowfi', args: '' })}>
          {isPlaying ? 'pausar' : 'tocar'}
        </Button>
        <Text dimColor> · </Text>
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
          <Text color="#ff8c00">● Meus Mods</Text>
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANEL_ID }, async ($, e) => {
    const { value: isPlaying = false } = await $.state.get(radioIsPlaying)
    const { value: volume = DEFAULT_VOLUME } = await $.state.get(radioVolume)
    const { value: isLimpo = false } = await $.state.get(limpoIsEnabled)

    const { Box, Text, Button } = $.ui.resolve(e)

    const setVolume = (next: number) =>
      $.command.run({ command: 'lowfi', args: String(Math.max(0, Math.min(100, next))) })

    return (
      <Box flexDirection="column" gap={1}>
        <Text weight="bold">Meus Mods</Text>

        <Box flexDirection="column">
          <Text weight="semibold">
            Radio Lo-Fi · {isPlaying ? `tocando, ${volume}%` : 'desligada'}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Button
              key="panel-radio-toggle"
              onPress={() => $.command.run({ command: 'lowfi', args: '' })}
            >
              {isPlaying ? 'Pausar' : 'Tocar'}
            </Button>
            <Button key="panel-radio-down" plain onPress={() => setVolume(volume - VOLUME_STEP)}>
              - vol
            </Button>
            <Button key="panel-radio-up" plain onPress={() => setVolume(volume + VOLUME_STEP)}>
              + vol
            </Button>
          </Box>
        </Box>

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
