import type { Register } from 'claude-code'

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
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    // ponytail: running/errored/interrupted keep the full block, hiding a failure is the one thing a clean view must not do
    if (e.props.isRunning || e.props.isErrored || e.props.isInterrupted) return next(e)

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
}
