export type TurnInspectorState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'turn-inspector': {
      isEnabled: boolean
    }
  }
}
