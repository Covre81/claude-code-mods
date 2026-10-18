export type PhaseId = 'idle' | 'spec' | 'test' | 'code' | 'verify' | 'done'

export type PhaseState = {
  isEnabled: boolean
  current: PhaseId
  task: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'phase-tracker': PhaseState
  }
}
