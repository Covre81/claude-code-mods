import type { Register } from 'claude-code'

const isEnabledRef = { plugin: 'tela-limpa', key: 'isEnabled' } as const

const MAX_SUMMARY_LENGTH = 72

function firstStringField(
  input: unknown,
  keys: readonly string[],
): string | undefined {
  if (input === null || typeof input !== 'object') return undefined
  const data = input as Record<string, unknown>

  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.length > 0) return value
  }

  return undefined
}

// O que a maioria das ferramentas do dia a dia carrega de mais identificavel:
// o comando, o caminho ou o padrao de busca.
const DESCRIPTIVE_KEYS = [
  'command',
  'file_path',
  'path',
  'pattern',
  'url',
  'query',
  'prompt',
] as const

function summarize(tool: string, input: unknown): string {
  const text = firstStringField(input, DESCRIPTIVE_KEYS)
  if (text === undefined) return tool

  const oneLine = text.replace(/\s+/g, ' ').trim()
  const trimmed =
    oneLine.length > MAX_SUMMARY_LENGTH
      ? `${oneLine.slice(0, MAX_SUMMARY_LENGTH)}…`
      : oneLine

  return `${tool}: ${trimmed}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'limpo',
      description:
        'Ativa ou desativa a Tela Limpa: resume cada chamada de ferramenta numa linha, sem ocultar erros, perguntas ou respostas finais.',
      argumentHint: 'on|off',
    })

    return next(e)
  })

  on('command.run', { command: 'limpo' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg !== 'on' && arg !== 'off') {
      const { value: isEnabled = false } = await $.state.get(isEnabledRef)
      return {
        text: `Tela Limpa esta ${
          isEnabled ? 'ativada' : 'desativada'
        }. Uso: /limpo on · /limpo off`,
      }
    }

    await $.state.set(isEnabledRef, arg === 'on')
    return { text: `Tela Limpa ${arg === 'on' ? 'ativada' : 'desativada'}.` }
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { value: isEnabled = false } = await $.state.get(isEnabledRef)
    if (!isEnabled || e.props.isErrored || e.props.isInterrupted) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const icon = e.props.isRunning ? '…' : '✓'

    return (
      <Box>
        <Text dimColor>
          {icon} {summarize(e.props.tool, e.props.input)}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { value: isEnabled = false } = await $.state.get(isEnabledRef)
    if (!isEnabled || e.props.isErrored) return next(e)

    // A linha da ToolUse ja carrega o resumo do passo; o resultado detalhado
    // (stdout, diff) fica oculto enquanto a Tela Limpa estiver ligada.
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}
