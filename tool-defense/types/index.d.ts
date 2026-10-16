export type ToolDefenseState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'tool-defense': {
      isEnabled: boolean
    }
  }
}
