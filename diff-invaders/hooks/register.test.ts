// Run with: claude plugin test diff-invaders
import { describe, expect, test, mock } from 'claude-code/testing'

describe('on/off toggle', () => {
  test('/diff-invaders off refuses to open and closes the board if open', async ($, on) => {
    mock.store(on)
    await $.command.run({ command: 'diff-invaders', args: '' })

    const off = await $.command.run({ command: 'diff-invaders', args: 'off' })
    expect((off as { text?: string }).text).toBe('diff-invaders desativado.')

    const reopen = await $.command.run({ command: 'diff-invaders', args: '' })
    expect((reopen as { text?: string }).text).toBe('diff-invaders esta desativado. Uso: /diff-invaders on')

    const on_ = await $.command.run({ command: 'diff-invaders', args: 'on' })
    expect((on_ as { text?: string }).text).toBe('diff-invaders ativado.')

    const reopened = await $.command.run({ command: 'diff-invaders', args: '' })
    expect((reopened as { text?: string }).text).toContain('click the board')
  })
})
