export type RadarAgent = {
  id: string
  description: string
  type: string
  model?: string // left out when the engine does not report it
  tokens: number
  progress?: string
  tasks?: Record<string, string> // TaskCreate/TaskUpdate: task id -> status
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  tools: number
  last: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-radar': { agents: RadarAgent[]; selected: string | null; now: number; isEnabled: boolean }
  }
}
