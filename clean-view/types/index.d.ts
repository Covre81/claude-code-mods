export type CleanViewState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'clean-view': {
      isEnabled: boolean
    }
  }
}
