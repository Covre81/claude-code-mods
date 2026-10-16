export type DiffInvadersState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'diff-invaders': {
      isEnabled: boolean
    }
  }
}
