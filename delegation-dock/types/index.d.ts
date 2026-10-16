export type DelegationDockState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'delegation-dock': {
      isEnabled: boolean
    }
  }
}
