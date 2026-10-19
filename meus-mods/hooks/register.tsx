import type { EngineInterface, Register } from 'claude-code'

const PANEL_ID = 'meus-mods-panel'
const BRAND = '#D97757'
const BG = '#11141c'
const BG_ALT = '#171b26'
const TOGGLE_ON = '#2ecc71'
const TOGGLE_OFF = '#ff5252'
const TOGGLE_KNOB = '#f4f4f4'
// Blocos de cor de fundo, sem glifo nenhum: funciona em qualquer fonte, de
// qualquer superfície (terminal, desktop, vscode, mobile). A versão anterior
// usava glifos de meio-círculo para a bolinha, mas isso depende da fonte do
// host desenhar os dois meios encostados — em algumas fontes vira quadradinho,
// em outras vira dois meios soltos sem preenchimento.
const TOGGLE_FILL = '   '
const TOGGLE_KNOB_BLOCK = '  '

const memoriaRef = { plugin: 'context-monitor', key: 'memoriaEnabled' } as const
// O engine só aceita ref de estado escrita literalmente (para listar o que cada
// mod lê), então o on/off de cada mod precisa de uma linha aqui. Mod sem ref
// ainda aparece e conta; só fica sem toggle até ganhar a sua.
const cleanViewRef = { plugin: 'clean-view', key: 'isEnabled' } as const
const cacheFrioRef = { plugin: 'cache-frio', key: 'isEnabled' } as const
const delegationDockRef = { plugin: 'delegation-dock', key: 'isEnabled' } as const
const contextMonitorRef = { plugin: 'context-monitor', key: 'isEnabled' } as const
const waitQuizRef = { plugin: 'wait-quiz', key: 'isEnabled' } as const
const nextPromptsRef = { plugin: 'next-prompts', key: 'isEnabled' } as const
const webfetchCacheRef = { plugin: 'webfetch-cache', key: 'isEnabled' } as const
const universalAuditLogRef = { plugin: 'universal-audit-log', key: 'isEnabled' } as const
const gitSidebarRef = { plugin: 'git-sidebar', key: 'isEnabled' } as const
const turnInspectorRef = { plugin: 'turn-inspector', key: 'isEnabled' } as const
const agentFlowRef = { plugin: 'agent-flow', key: 'isEnabled' } as const
const sessionTimeMachineRef = { plugin: 'session-time-machine', key: 'isEnabled' } as const
const phaseTrackerRef = { plugin: 'phase-tracker', key: 'isEnabled' } as const
const sessionTelemetryRef = { plugin: 'session-telemetry', key: 'isEnabled' } as const
const agentRadarRef = { plugin: 'agent-radar', key: 'isEnabled' } as const
const atomicCommitGuardRef = { plugin: 'atomic-commit-guard', key: 'isEnabled' } as const

async function enabledStates($: EngineInterface): Promise<Record<string, boolean | undefined>> {
  const [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p] = await Promise.all([
    $.state.get(cleanViewRef),
    $.state.get(cacheFrioRef),
    $.state.get(delegationDockRef),
    $.state.get(contextMonitorRef),
    $.state.get(waitQuizRef),
    $.state.get(nextPromptsRef),
    $.state.get(webfetchCacheRef),
    $.state.get(universalAuditLogRef),
    $.state.get(gitSidebarRef),
    $.state.get(turnInspectorRef),
    $.state.get(agentFlowRef),
    $.state.get(sessionTimeMachineRef),
    $.state.get(phaseTrackerRef),
    $.state.get(sessionTelemetryRef),
    $.state.get(agentRadarRef),
    $.state.get(atomicCommitGuardRef),
  ])
  return {
    'clean-view': a.value,
    'cache-frio': b.value,
    'delegation-dock': c.value,
    'context-monitor': d.value,
    'wait-quiz': e.value,
    'next-prompts': f.value,
    'webfetch-cache': g.value,
    'universal-audit-log': h.value,
    'git-sidebar': i.value,
    'turn-inspector': j.value,
    'agent-flow': k.value,
    'session-time-machine': l.value,
    'phase-tracker': m.value,
    'session-telemetry': n.value,
    'agent-radar': o.value,
    'atomic-commit-guard': p.value,
  }
}

type Row = {
  command: string | null
  icon: string
  accent: string
  name: string
  description: string
  isEnabled: boolean | null // null = sempre ativo, sem toggle
  isFeature?: boolean // recurso dentro de um mod: aparece, mas não conta como mod
}

type Meta = { icon: string; accent: string; description: string; command?: string | null }

// Só o visual de cada mod conhecido. Quem está instalado vem do disco (rows);
// mod novo sem entrada aqui aparece com o visual genérico e a descrição do
// próprio plugin.json. `command` só existe quando o toggle não tem o nome do
// mod; `null` diz que o mod não tem toggle.
const META: Record<string, Meta> = {
  'clean-view': { icon: '🧹', accent: '#5fd98a', description: 'Resume cada chamada de ferramenta numa linha' },
  'cache-frio': { icon: '🧊', accent: '#5fb8d9', description: 'Avisa antes de mandar um prompt caro com cache frio' },
  'delegation-dock': { icon: '🛰', accent: '#c97fe0', description: 'Status das delegações em voo (agy/codex/ollama)' },
  'context-monitor': { icon: '🌤', accent: '#4aa3df', description: 'Clima e caixa de contexto, uso 5h/7d, replay e atividade', command: 'monitor' },
  'wait-quiz': { icon: '🎴', accent: '#e8955c', description: 'Quiz de estudo na faixa enquanto Claude trabalha' },
  'next-prompts': { icon: '💡', accent: '#f0d75c', description: 'Sugestões de próximo passo acima do prompt' },
  'webfetch-cache': { icon: '🌐', accent: '#4fd1c5', description: 'Cache de WebFetch repetido na mesma sessão' },
  'universal-audit-log': { icon: '📜', accent: '#a0a4ab', description: 'Log JSONL de todo evento do engine' },
  'git-sidebar': { icon: '🌿', accent: '#7ee787', description: 'Worktrees e branches num painel lateral' },
  'turn-inspector': { icon: '🪟', accent: '#d9875f', description: 'Cada turno do modelo com a janela de contexto', command: 'turns' },
  'agent-flow': { icon: '🌳', accent: '#7aa6da', description: 'Árvore ao vivo dos subagentes e o contexto entre eles' },
  'session-time-machine': { icon: '⏱', accent: '#58a6ff', description: 'Linha do tempo da sessão; bifurca a partir de qualquer ponto', command: 'timemachine' },
  'phase-tracker': { icon: '🎯', accent: '#4aa3df', description: 'Fases da tarefa guiadas pelo método Karpathy', command: 'fase' },
  'session-telemetry': { icon: '🕒', accent: '#f08a5d', description: 'Hora nas respostas e aviso de troca de modelo', command: 'telemetria' },
  // radar-toggle ignora o argumento e inverte o estado; o painel sempre manda o oposto do atual, então dá no mesmo
  'agent-radar': { icon: '📡', accent: '#e06c75', description: 'Faixa com o que cada subagente está fazendo', command: 'radar-toggle' },
  'atomic-commit-guard': { icon: '⚛', accent: '#d19a66', description: 'Barra commit que mistura escopos ou tem mensagem ruim', command: 'commit-guard' },
  'meus-mods': { icon: '✦', accent: BRAND, description: 'Este painel', command: null },
  guarda: { icon: '🛡', accent: '#e0c84a', description: 'Segura comando destrutivo e pede confirmação', command: null },
  cofre: { icon: '🔐', accent: '#5fd98a', description: 'Mantém chave de API fora da conversa', command: null },
  lixeira: { icon: '🗑', accent: '#8a8f99', description: 'Manda rm para a Lixeira do Windows', command: null },
}

const GENERIC = { icon: '🧩', accent: '#a0a4ab' }

// Separador de lista de caminhos: ';' no Windows, ':' no resto — mas sem
// cortar o ':' de "C:/" ou "C:\\".
const splitDirs = (raw: string) =>
  raw
    .split(/;|:(?![\\/])/)
    .map(d => d.trim().replace(/[\\/]+$/, ''))
    .filter(Boolean)

async function manifest($: EngineInterface, dir: string): Promise<{ name: string; description: string }> {
  const fallback = { name: dir.split(/[\\/]/).pop() ?? dir, description: '' }
  try {
    const json = JSON.parse(await $.fs.read(`${dir}/.claude-plugin/plugin.json`)) as { name?: unknown; description?: unknown }
    return {
      name: typeof json.name === 'string' ? json.name : fallback.name,
      description: typeof json.description === 'string' ? json.description : '',
    }
  } catch {
    return fallback
  }
}

async function rows($: EngineInterface): Promise<Row[]> {
  const dirs = splitDirs((await $.env.get('CLAUDE_CODE_PLUGIN_DIRS')) ?? '')
  const states = await enabledStates($)

  const mods = await Promise.all(
    dirs.map(async (dir): Promise<Row> => {
      const { name, description } = await manifest($, dir)
      const meta = META[name]
      // Sem ref de estado não há como mostrar on/off, então nem toggle.
      // Convenção dos mods daqui: o toggle tem o nome do próprio mod.
      const hasToggle = name in states && meta?.command !== null
      const command = hasToggle ? (meta?.command ?? name) : null
      const isEnabled = hasToggle ? (states[name] ?? true) : null
      return { command, name, isEnabled, icon: meta?.icon ?? GENERIC.icon, accent: meta?.accent ?? GENERIC.accent, description: meta?.description ?? description }
    }),
  )

  const extras: Row[] = []
  if (mods.some(m => m.name === 'context-monitor')) {
    const { value: memoria = true } = await $.state.get(memoriaRef)
    extras.push({ command: 'memoria', icon: '🧠', accent: '#9b8cf0', name: 'memoria', description: 'Busca notas do ai-memory antes de cada prompt (recurso do context-monitor)', isEnabled: memoria, isFeature: true })
  }

  return [...mods, ...extras].sort((a, b) => a.name.localeCompare(b.name))
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

  // context-monitor e next-prompts já disputam o AbovePrompt entre si e
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
    const mods = list.filter(r => !r.isFeature)
    const active = mods.filter(r => r.isEnabled !== false).length
    const { Box, Text, Button } = $.ui.resolve(e)

    const toggle = (row: Row) => {
      if (!row.command) return
      void $.command.run({ command: row.command, args: row.isEnabled ? 'off' : 'on' })
    }

    // Pílula: faixa de cor de fundo + bolinha, sem glifo nenhum. Dois Text
    // fixos (sem array, sem loop) — o motor de UI dos paineis não é React de
    // verdade e não aceita lista de elementos como filho; array quebrava o
    // render e o toggle inteiro desaparecia.
    const Toggle = (row: Row) => {
      const track = row.isEnabled ? TOGGLE_ON : TOGGLE_OFF
      return (
        <Button key={`${row.name}-toggle`} plain onPress={() => toggle(row)}>
          {row.isEnabled ? (
            <Text>
              <Text backgroundColor={track}>{TOGGLE_FILL}</Text>
              <Text backgroundColor={TOGGLE_KNOB}>{TOGGLE_KNOB_BLOCK}</Text>
            </Text>
          ) : (
            <Text>
              <Text backgroundColor={TOGGLE_KNOB}>{TOGGLE_KNOB_BLOCK}</Text>
              <Text backgroundColor={track}>{TOGGLE_FILL}</Text>
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
            {active} de {mods.length} mods ativos
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
