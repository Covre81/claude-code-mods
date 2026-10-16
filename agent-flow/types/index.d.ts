export type AgentFlowState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-flow': {
      isEnabled: boolean
    }
  }
}
