export type TelaLimpaState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'tela-limpa': {
      isEnabled: boolean
    }
  }
}
