import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const isEnabledRef = atom({ plugin: 'clean-view', key: 'isEnabled' } as const, false)

export type Line = { glyph: string; tool: string; target: string; note?: string }

const lines = (s: unknown) => (typeof s === 'string' && s.length ? s.split('\n').length : 0)
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (o: unknown, k: string) => {
  const v = (o as Record<string, unknown> | null | undefined)?.[k]
  return typeof v === 'number' ? v : undefined
}
const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// Pure: one tool call to the single line that stands for it. null = leave the engine's block.
export function summarize(tool: string, input: unknown, output: unknown): Line | null {
  const i = (input ?? {}) as Record<string, unknown>
  switch (tool) {
    case 'Edit': {
      const add = lines(i.new_string)
      const del = lines(i.old_string)
      return { glyph: '●', tool, target: str(i.file_path), note: `+${add} −${del}` }
    }
    case 'Write':
      return { glyph: '●', tool, target: str(i.file_path), note: `${lines(i.content)} linhas` }
    case 'Read': {
      const f = (output as { file?: unknown } | null | undefined)?.file
      const n = num(f, 'numLines')
      return { glyph: '●', tool, target: str(i.file_path), note: n !== undefined ? `${n} linhas` : undefined }
    }
    case 'Bash':
      return { glyph: '●', tool, target: short(str(i.command).replace(/\s+/g, ' ')) }
    case 'Grep':
    case 'Glob': {
      const n = num(output, 'numFiles')
      return { glyph: '●', tool, target: short(str(i.pattern)), note: n !== undefined ? `${n} ${n === 1 ? 'arquivo' : 'arquivos'}` : undefined }
    }
    default:
      return null
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('isEnabled').catch(() => undefined)
    if (typeof saved === 'boolean') await update($, isEnabledRef, () => saved)
    await $.command.register({
      name: 'clean-view',
      description: 'Liga/desliga o clean-view: resume cada chamada de ferramenta numa linha.',
      argumentHint: 'on|off',
    })
    return next(e)
  })

  on('command.run', { command: 'clean-view' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') {
      const isEnabled = await read($, isEnabledRef)
      return { text: `clean-view esta ${isEnabled ? 'ativado' : 'desativado'}. Uso: /clean-view on · /clean-view off` }
    }
    await update($, isEnabledRef, () => arg === 'on')
    await $.store.set('isEnabled', arg === 'on') // $.state is per session; the store survives a restart
    return { text: `clean-view ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.isRunning || e.props.isErrored || e.props.isInterrupted) return next(e)
    // read() inside ui.render subscribes the row: /clean-view on|off redraws it
    if (!(await read($, isEnabledRef))) return next(e)

    const line = summarize(e.props.tool, e.props.input, e.props.output)
    if (!line) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box gap={1}>
        <Text color="green">{line.glyph}</Text>
        <Text bold>{line.tool}</Text>
        <Text wrap="truncate-middle">{line.target}</Text>
        {line.note ? <Text dimColor>{line.note}</Text> : null}
      </Box>
    )
  })

  // Numa chamada isolada a saída (stdout do Bash, diff do Edit) é um ToolResult
  // à parte, desenhado embaixo da linha: sem isto o resumo vinha com o bloco
  // inteiro logo abaixo. Erro continua aparecendo inteiro.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    // ToolResult has no isInterrupted: an interrupted Bash says so in its output
    const o = e.props.output
    if (e.props.isErrored || (typeof o === 'object' && o !== null && 'interrupted' in o && o.interrupted === true)) return next(e)
    if (!(await read($, isEnabledRef)) || !summarize(e.props.tool, {}, e.props.output)) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}
