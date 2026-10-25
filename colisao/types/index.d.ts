export type ColisaoState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    colisao: {
      isEnabled: boolean
    }
  }
}
