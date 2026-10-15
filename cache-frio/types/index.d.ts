export type CacheFrioState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'cache-frio': {
      isEnabled: boolean
    }
  }
}
