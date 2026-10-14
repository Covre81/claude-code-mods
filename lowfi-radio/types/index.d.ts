export type LowfiRadioState = {
  isPlaying: boolean
  volume: number
}

declare module 'claude-code' {
  interface PluginState {
    'lowfi-radio': {
      isPlaying: boolean
      volume: number
    }
  }
}
