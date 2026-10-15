export type MemoriaState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    memoria: {
      isEnabled: boolean
    }
  }
}
