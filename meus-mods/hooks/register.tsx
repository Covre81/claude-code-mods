import type { EngineInterface, Register } from 'claude-code'

const PANEL_ID = 'meus-mods-panel'
const BRAND = '#D97757'
const BG = '#11141c'
const BG_ALT = '#171b26'
const TOGGLE_ON = '#2ecc71'
const TOGGLE_OFF = '#ff5252'
const TOGGLE_KNOB = '#f4f4f4'
const TOGGLE_TRAVEL = '  '
// ponytail: semicírculos powerline da Nerd Font (U+E0B6/U+E0B4), que enchem a
// altura da célula. Sem Nerd Font viram quadradinho; volte a ◖◗ nesse caso.
const TOGGLE_CAP_LEFT = ''
const TOGGLE_CAP_RIGHT = ''

const cleanViewRef = { plugin: 'clean-view', key: 'isEnabled' } as const
const cacheFrioRef = { plugin: 'cache-frio', key: 'isEnabled' } as const
const delegationDockRef = { plugin: 'delegation-dock', key: 'isEnabled' } as const
const memoriaRef = { plugin: 'memoria', key: 'isEnabled' } as const
const painelRef = { plugin: 'painel', key: 'isEnabled' } as const
const usoVivoRef = { plugin: 'uso-vivo', key: 'isEnabled' } as const
const waitQuizRef = { plugin: 'wait-quiz', key: 'isEnabled' } as const
const nextPromptsRef = { plugin: 'next-prompts', key: 'isEnabled' } as const
const webfetchCacheRef = { plugin: 'webfetch-cache', key: 'isEnabled' } as const
const universalAuditLogRef = { plugin: 'universal-audit-log', key: 'isEnabled' } as const
const gitSidebarRef = { plugin: 'git-sidebar', key: 'isEnabled' } as const
const turnInspectorRef = { plugin: 'turn-inspector', key: 'isEnabled' } as const
const agentFlowRef = { plugin: 'agent-flow', key: 'isEnabled' } as const
const sessionTimeMachineRef = { plugin: 'session-time-machine', key: 'isEnabled' } as const

type Row = {
  command: string | null
  icon: string
  accent: string
  name: string
  description: string
  isEnabled: boolean | null // null = sempre ativo, sem toggle
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
  const { value: webfetchCache = true } = await $.state.get(webfetchCacheRef)
  const { value: universalAuditLog = true } = await $.state.get(universalAuditLogRef)
  const { value: gitSidebar = true } = await $.state.get(gitSidebarRef)
  const { value: turnInspector = true } = await $.state.get(turnInspectorRef)
  const { value: agentFlow = true } = await $.state.get(agentFlowRef)
  const { value: sessionTimeMachine = true } = await $.state.get(sessionTimeMachineRef)

  return [
    { command: 'clean-view', icon: '🧹', accent: '#5fd98a', name: 'clean-view', description: 'Resume cada chamada de ferramenta numa linha', isEnabled: cleanView },
    { command: 'cache-frio', icon: '🧊', accent: '#5fb8d9', name: 'cache-frio', description: 'Avisa antes de mandar um prompt caro com cache frio', isEnabled: cacheFrio },
    { command: 'delegation-dock', icon: '🛰', accent: '#c97fe0', name: 'delegation-dock', description: 'Status das delegações em voo (agy/codex/ollama)', isEnabled: delegationDock },
    { command: 'memoria', icon: '🧠', accent: '#9b8cf0', name: 'memoria', description: 'Busca notas do ai-memory antes de cada prompt', isEnabled: memoria },
    { command: 'painel', icon: '🌤', accent: '#4aa3df', name: 'painel', description: 'Clima do contexto, replay de edições e atividade', isEnabled: painel },
    { command: 'uso-vivo', icon: '📊', accent: '#e0c84a', name: 'uso-vivo', description: 'Caixa de contexto e linha de uso (5h/7d, custo)', isEnabled: usoVivo },
    { command: 'wait-quiz', icon: '🎴', accent: '#e8955c', name: 'wait-quiz', description: 'Quiz de estudo na faixa enquanto Claude trabalha', isEnabled: waitQuiz },
    { command: 'next-prompts', icon: '💡', accent: '#f0d75c', name: 'next-prompts', description: 'Sugestões de próximo passo acima do prompt', isEnabled: nextPrompts },
    { command: 'webfetch-cache', icon: '🌐', accent: '#4fd1c5', name: 'webfetch-cache', description: 'Cache de WebFetch repetido na mesma sessão', isEnabled: webfetchCache },
    { command: 'universal-audit-log', icon: '📜', accent: '#a0a4ab', name: 'universal-audit-log', description: 'Log JSONL de todo evento do engine', isEnabled: universalAuditLog },
    { command: 'git-sidebar', icon: '🌿', accent: '#7ee787', name: 'git-sidebar', description: 'Worktrees e branches num painel lateral', isEnabled: gitSidebar },
    { command: 'turns', icon: '🪟', accent: '#d9875f', name: 'turn-inspector', description: 'Cada turno do modelo com a janela de contexto', isEnabled: turnInspector },
    { command: 'agent-flow', icon: '🌳', accent: '#7aa6da', name: 'agent-flow', description: 'Árvore ao vivo dos subagentes e o contexto entre eles', isEnabled: agentFlow },
    { command: 'timemachine', icon: '⏱', accent: '#58a6ff', name: 'session-time-machine', description: 'Linha do tempo da sessão; bifurca a partir de qualquer ponto', isEnabled: sessionTimeMachine },
    { command: null, icon: '🛡', accent: '#e0c84a', name: 'guarda', description: 'Segura comando destrutivo e pede confirmação', isEnabled: null },
    { command: null, icon: '🔐', accent: '#5fd98a', name: 'cofre', description: 'Mantém chave de API fora da conversa', isEnabled: null },
    { command: null, icon: '🗑', accent: '#8a8f99', name: 'lixeira', description: 'Manda rm para a Lixeira do Windows', isEnabled: null },
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

    // Pílula: trilha com fundo colorido e duas tampas semicirculares
    // com a cor da trilha no texto, o que dá a ponta arredondada. Um Button
    // só aceita string/Text como filho, então tudo aninha em Text. A bolinha
    // é um círculo branco de 2 células que ocupa a ponta do lado ativo: a
    // metade de fora fica no lugar da tampa, então encosta na borda de verdade.
    // Largura total: 5 células.
    const Toggle = (row: Row) => {
      const track = row.isEnabled ? TOGGLE_ON : TOGGLE_OFF
      return (
        <Button key={`${row.name}-toggle`} plain onPress={() => toggle(row)}>
          {row.isEnabled ? (
            <Text>
              <Text color={track}>{TOGGLE_CAP_LEFT}</Text>
              <Text backgroundColor={track}>
                {TOGGLE_TRAVEL}
                <Text color={TOGGLE_KNOB}>{TOGGLE_CAP_LEFT}</Text>
              </Text>
              <Text color={TOGGLE_KNOB}>{TOGGLE_CAP_RIGHT}</Text>
            </Text>
          ) : (
            <Text>
              <Text color={TOGGLE_KNOB}>{TOGGLE_CAP_LEFT}</Text>
              <Text backgroundColor={track}>
                <Text color={TOGGLE_KNOB}>{TOGGLE_CAP_RIGHT}</Text>
                {TOGGLE_TRAVEL}
              </Text>
              <Text color={track}>{TOGGLE_CAP_RIGHT}</Text>
            </Text>
          )}
        </Button>
      )
    }

    const renderRow = (row: Row, i: number) => (
      <Box key={row.name} flexDirection="row" gap={1} paddingX={1} backgroundColor={i % 2 ? BG_ALT : undefined}>
        <Text color={row.accent} bold>
          ▍
        </Text>
        <Text>{row.icon}</Text>
        <Box flexDirection="column" flexGrow={1}>
          <Text bold color={row.accent}>
            {row.name}
          </Text>
          <Text dimColor wrap="truncate-end">
            {row.description}
          </Text>
        </Box>
        {row.isEnabled === null ? <Text dimColor>sempre ativo</Text> : Toggle(row)}
      </Box>
    )

    const toggleable = list.filter(r => r.isEnabled !== null)
    const alwaysOn = list.filter(r => r.isEnabled === null)

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={BRAND} backgroundColor={BG} paddingY={0} gap={1}>
        <Box flexDirection="row" backgroundColor={BRAND} paddingX={1}>
          <Text bold color="#1a0f08">
            ✦ MEUS MODS
          </Text>
        </Box>

        <Box flexDirection="column" paddingX={1}>
          <Text dimColor>
            {active} de {list.length} mods ativos
          </Text>
        </Box>

        <Box flexDirection="column">{toggleable.map((row, i) => renderRow(row, i))}</Box>

        <Box flexDirection="column" paddingX={1}>
          <Text bold dimColor>
            sempre ativos
          </Text>
        </Box>
        <Box flexDirection="column">{alwaysOn.map((row, i) => renderRow(row, i))}</Box>

        <Box paddingX={1}>
          <Button key="panel-close" role="dismiss" onPress={() => $.ui.close({ id: PANEL_ID })}>
            Fechar
          </Button>
        </Box>
      </Box>
    )
  })
}
