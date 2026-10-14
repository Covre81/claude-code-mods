import type { EngineInterface, Register } from 'claude-code'

const isPlayingRef = { plugin: 'lowfi-radio', key: 'isPlaying' } as const
const volumeRef = { plugin: 'lowfi-radio', key: 'volume' } as const

const DEFAULT_VOLUME = 40
const STORE_VOLUME_KEY = 'volume'
const STORE_STREAM_URL_KEY = 'streamUrl'

let controller: AbortController | null = null

function clampVolume(input: number): number {
  return Math.max(0, Math.min(100, Math.round(input)))
}

function gainOf(volume: number): number {
  return volume / 100
}

function statusText(volume: number): string {
  return `♪ Lo-Fi Radio · ${volume}%`
}

function stopPlayback($: EngineInterface) {
  if (controller) {
    controller.abort()
    controller = null
  }
  $.ui.status(undefined)
}

async function startPlayback($: EngineInterface, url: string, volume: number) {
  stopPlayback($)
  controller = new AbortController()
  const signal = controller.signal

  void $.audio
    .play({ url }, { shouldLoop: true, gain: gainOf(volume), signal })
    .catch(async err => {
      await $.state.set(isPlayingRef, false)
      $.ui.status(undefined)
      $.ui.toast(
        `Radio Lo-Fi: nao foi possivel tocar (${String(
          (err as { message?: string })?.message ?? err,
        )}). Em Linux/Windows o terminal pode nao ter um player de audio instalado; so o macOS (afplay) toca hoje.`,
      )
    })

  $.ui.status(statusText(volume))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lowfi',
      description:
        'Liga/desliga a Radio Lo-Fi. "/lowfi 60" ajusta o volume (0-100). "/lowfi url <endereco>" define o stream.',
      argumentHint: '[on|off|0-100|url <endereco>]',
    })

    const storedVolume = await $.store.get(STORE_VOLUME_KEY)
    await $.state.set(
      volumeRef,
      typeof storedVolume === 'number' && Number.isFinite(storedVolume)
        ? clampVolume(storedVolume)
        : DEFAULT_VOLUME,
    )
    // O audio nunca sobrevive a um reload ou a uma nova sessao: o estado
    // comeca sempre desligado, e a pessoa liga de novo quando quiser.
    await $.state.set(isPlayingRef, false)

    return next(e)
  })

  on('command.run', { command: 'lowfi' }, async ($, e) => {
    const args = e.args.trim()

    if (args.length === 0) {
      const { value: isPlaying = false } = await $.state.get(isPlayingRef)
      const { value: volume = DEFAULT_VOLUME } = await $.state.get(volumeRef)

      if (isPlaying) {
        stopPlayback($)
        await $.state.set(isPlayingRef, false)
        return { text: 'Radio Lo-Fi: desligada.' }
      }

      const url = await $.store.get(STORE_STREAM_URL_KEY)
      if (typeof url !== 'string' || url.length === 0) {
        return {
          text:
            'Nenhum stream configurado, e eu nao tenho um endereco oficial confirmado da ' +
            'radio lo-fi da Anthropic para preencher sozinho. Configure um com ' +
            '/lowfi url <endereco-do-stream> e tente de novo.',
        }
      }

      await startPlayback($, url, volume)
      await $.state.set(isPlayingRef, true)
      return { text: `Radio Lo-Fi: ligada (volume ${volume}%).` }
    }

    const lower = args.toLowerCase()

    if (lower === 'off') {
      stopPlayback($)
      await $.state.set(isPlayingRef, false)
      return { text: 'Radio Lo-Fi: desligada.' }
    }

    if (lower === 'on') {
      const { value: isPlaying = false } = await $.state.get(isPlayingRef)
      if (isPlaying) return { text: 'Radio Lo-Fi: ja esta ligada.' }

      const { value: volume = DEFAULT_VOLUME } = await $.state.get(volumeRef)
      const url = await $.store.get(STORE_STREAM_URL_KEY)
      if (typeof url !== 'string' || url.length === 0) {
        return {
          text:
            'Nenhum stream configurado. Configure um com /lowfi url <endereco-do-stream> primeiro.',
        }
      }

      await startPlayback($, url, volume)
      await $.state.set(isPlayingRef, true)
      return { text: `Radio Lo-Fi: ligada (volume ${volume}%).` }
    }

    if (lower.startsWith('url')) {
      const url = args.slice(3).trim()
      if (url.length === 0) {
        return { text: 'Uso: /lowfi url <endereco-do-stream-de-audio>' }
      }
      await $.store.set(STORE_STREAM_URL_KEY, url)
      return {
        text: `Stream configurado: ${url}. Use /lowfi para ligar.`,
      }
    }

    const asNumber = Number(lower)
    if (Number.isFinite(asNumber)) {
      const volume = clampVolume(asNumber)
      await $.state.set(volumeRef, volume)
      await $.store.set(STORE_VOLUME_KEY, volume)

      const { value: isPlaying = false } = await $.state.get(isPlayingRef)
      if (isPlaying) {
        const url = await $.store.get(STORE_STREAM_URL_KEY)
        if (typeof url === 'string' && url.length > 0) {
          await startPlayback($, url, volume)
        }
      }

      return { text: `Radio Lo-Fi: volume ${volume}%.` }
    }

    return {
      text:
        'Uso: /lowfi (liga/desliga) · /lowfi on · /lowfi off · ' +
        '/lowfi <0-100> (volume) · /lowfi url <endereco> (define o stream)',
    }
  })
}
