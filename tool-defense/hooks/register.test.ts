// Run with: claude plugin test tool-defense
import { describe, expect, test, mock } from 'claude-code/testing'

describe('on/off toggle', () => {
  test('/defense off refuses to open and closes the board if open', async ($, on) => {
    mock.store(on)
    await $.command.run({ command: 'defense', args: '' })

    const off = await $.command.run({ command: 'defense', args: 'off' })
    expect((off as { text?: string }).text).toBe('tool-defense desativado.')

    const reopen = await $.command.run({ command: 'defense', args: '' })
    expect((reopen as { text?: string }).text).toBe('tool-defense esta desativado. Uso: /defense on')

    const on_ = await $.command.run({ command: 'defense', args: 'on' })
    expect((on_ as { text?: string }).text).toBe('tool-defense ativado.')

    const reopened = await $.command.run({ command: 'defense', args: '' })
    expect((reopened as { text?: string }).text).toContain('click a cell to build a tower')
  })
})
