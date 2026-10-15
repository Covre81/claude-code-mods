import type { EngineInterface, Register } from 'claude-code'

const PANEL_ID = 'meus-mods-panel'
const BRAND = '#D97757'

const cleanViewRef = { plugin: 'clean-view', key: 'isEnabled' } as const
const cacheFrioRef = { plugin: 'cache-frio', key: 'isEnabled' } as const
const delegationDockRef = { plugin: 'delegation-dock', key: 'isEnabled' } as const
const memoriaRef = { plugin: 'memoria', key: 'isEnabled' } as const
const painelRef = { plugin: 'painel', key: 'isEnabled' } as const
const usoVivoRef = { plugin: 'uso-vivo', key: 'isEnabled' } as const
const waitQuizRef = { plugin: 'wait-quiz', key: 'isEnabled' } as const
const nextPromptsRef = { plugin: 'next-prompts', key: 'isEnabled' } as const

type Row = {
  command: string | null
  icon: string
  name: string
  description: string
  isEnabled: boolean | null // null = sempre ativo, sem botão
}

async function rows($: EngineInterface): Promise<Row[]> {
  const { value: cleanView = true } = await $.state.get(cleanViewRef)
  const { value: cacheFrio = true } = await $.state.get(cacheFrioRef)
  const { value: delegationDock = true } = await $.state.get(delegationDockRef)
  const { value: memoria = true } = await $.state.get(memoriaRef)
  const { value: painel = true } = await $.state.get(painelRef)
  const { value: usoVivo = true } = await $.state.get(usoVivoRef)
  const { value: waitQuiz = true } = await $.state.get(waitQuizRef)
  const { value: nextPrompts = true } = await $.state.get(nextPromptsRef)

  return [
    { command: 'clean-view', icon: '🧹', name: 'clean-view', description: 'Resume cada chamada de ferramenta numa linha', isEnabled: cleanView },
    { command: 'cache-frio', icon: '🧊', name: 'cache-frio', description: 'Avisa antes de mandar um prompt caro com cache frio', isEnabled: cacheFrio },
    { command: 'delegation-dock', icon: '🛰', name: 'delegation-dock', description: 'Status das delegações em voo (agy/codex/ollama)', isEnabled: delegationDock },
    { command: 'memoria', icon: '🧠', name: 'memoria', description: 'Busca notas do ai-memory antes de cada prompt', isEnabled: memoria },
    { command: 'painel', icon: '🌤', name: 'painel', description: 'Clima do contexto, replay de edições e atividade', isEnabled: painel },
    { command: 'uso-vivo', icon: '📊', name: 'uso-vivo', description: 'Caixa de contexto e linha de uso (5h/7d, custo)', isEnabled: usoVivo },
    { command: 'wait-quiz', icon: '🎴', name: 'wait-quiz', description: 'Quiz de estudo na faixa enquanto Claude trabalha', isEnabled: waitQuiz },
    { command: 'next-prompts', icon: '💡', name: 'next-prompts', description: 'Sugestões de próximo passo acima do prompt', isEnabled: nextPrompts },
    { command: null, icon: '🛡', name: 'guarda', description: 'Segura comando destrutivo e pede confirmação — sempre ativo', isEnabled: null },
    { command: null, icon: '🔐', name: 'cofre', description: 'Mantém chave de API fora da conversa — sempre ativo', isEnabled: null },
    { command: null, icon: '🗑', name: 'lixeira', description: 'Manda rm para a Lixeira do Windows — sempre ativo', isEnabled: null },
  ]
}

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

    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)

    const mine = (
      <Box width={e.props.bodyColumns} flexDirection="row" justifyContent="flex-end">
        <Button key="open-panel" plain hotkey="m" onPress={() => $.ui.open({ id: PANEL_ID, title: 'Meus Mods' })}>
          <Text color={BRAND}>✦ mods</Text>
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
    const list = await rows($)
    const active = list.filter(r => r.isEnabled !== false).length
    const { Box, Text, Button } = $.ui.resolve(e)

    const toggle = (row: Row) => {
      if (!row.command) return
      void $.command.run({ command: row.command, args: row.isEnabled ? 'off' : 'on' })
    }

    const renderRow = (row: Row) => (
      <Box key={row.name} flexDirection="row" gap={1}>
        <Text>{row.icon}</Text>
        <Box flexDirection="column" flexGrow={1}>
          <Text bold color={row.isEnabled === false ? 'gray' : BRAND}>
            {row.name}
          </Text>
          <Text dimColor wrap="truncate-end">
            {row.description}
          </Text>
        </Box>
        {row.isEnabled === null ? (
          <Text dimColor>sempre ativo</Text>
        ) : (
          <Button key={`${row.name}-toggle`} plain onPress={() => toggle(row)}>
            {row.isEnabled ? 'desligar' : 'ligar'}
          </Button>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={BRAND} paddingX={1} gap={1}>
        <Box flexDirection="column">
          <Text bold>
            <Text color={BRAND}>✦</Text> Meus Mods
          </Text>
          <Text dimColor>
            {active} de {list.length} mods ativos
          </Text>
        </Box>

        <Box flexDirection="column">{list.filter(r => r.isEnabled !== null).map(renderRow)}</Box>

        <Box flexDirection="column">
          <Text dimColor>── sempre ativos ──</Text>
          {list.filter(r => r.isEnabled === null).map(renderRow)}
        </Box>

        <Button key="panel-close" role="dismiss" plain onPress={() => $.ui.close({ id: PANEL_ID })}>
          Fechar
        </Button>
      </Box>
    )
  })
}
