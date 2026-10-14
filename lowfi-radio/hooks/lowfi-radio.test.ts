import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { register } from './register'

// Nada abaixo do kit de teste sabe guardar valores ou tocar audio de
// verdade: estes fakes fazem o papel do host (o $.store real, a barra de
// status, o afplay do macOS) so para os comandos nao rejeitarem. O estado
// e verificado sempre pelo texto que os comandos devolvem, nunca lendo
// $.state direto no corpo do teste (o $ do teste nao expoe esse noun).
function fakeHost(on: On) {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
}

test('sem stream configurado, /lowfi nao liga e orienta a pessoa', async ($, on) => {
  fakeHost(on)
  register(on, {})

  const first = await $.command.run({ command: 'lowfi', args: '' })
  expect(first.text).toContain('Configure um')

  // Se tivesse ligado de verdade, esta segunda chamada devolveria
  // "desligada" em vez de pedir o stream de novo.
  const second = await $.command.run({ command: 'lowfi', args: '' })
  expect(second.text).toContain('Configure um')
})

test('/lowfi url define o stream e /lowfi <n> ajusta e trava o volume em 0-100', async ($, on) => {
  fakeHost(on)
  register(on, {})

  const configured = await $.command.run({
    command: 'lowfi',
    args: 'url https://example.com/stream.mp3',
  })
  expect(configured.text).toContain('Stream configurado')

  const volumeResult = await $.command.run({ command: 'lowfi', args: '55' })
  expect(volumeResult.text).toContain('55%')

  const overLimit = await $.command.run({ command: 'lowfi', args: '150' })
  expect(overLimit.text).toContain('100%')
})

test('/lowfi off e um no-op seguro quando a radio ja esta desligada', async ($, on) => {
  fakeHost(on)
  register(on, {})

  const result = await $.command.run({ command: 'lowfi', args: 'off' })
  expect(result.text).toContain('desligada')
})

test('liga de verdade quando ha stream e um "tocador" de audio respondendo', async ($, on) => {
  fakeHost(on)
  on('audio.play', () => ({ value: undefined }))
  register(on, {})

  await $.command.run({ command: 'lowfi', args: 'url https://example.com/stream.mp3' })

  const started = await $.command.run({ command: 'lowfi', args: '' })
  expect(started.text).toContain('ligada')

  const stopped = await $.command.run({ command: 'lowfi', args: '' })
  expect(stopped.text).toContain('desligada')
})
