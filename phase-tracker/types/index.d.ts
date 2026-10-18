export type PhaseId = 'idle' | 'spec' | 'test' | 'code' | 'verify' | 'done'

// The validator wants each key named here, not behind an alias.
declare module 'claude-code' {
  interface PluginState {
    'phase-tracker': {
      isEnabled: boolean
      current: PhaseId
      task: string | null
    }
  }
}
