export type SessionTimeMachineState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'session-time-machine': {
      isEnabled: boolean
    }
  }
}
