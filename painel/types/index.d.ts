export type DiffLine = { sign: '+' | '-' | ' ' | '…'; text: string }
export type Step = { file: string; tool: string; lines: DiffLine[] }
export type Act = { tool: string; label: string; ok: boolean; ms: number }
/** The engine's TurnUsage, restated: a contract takes no imports. */
export type Usage = { model: string; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
export type TurnStat = { usage: Usage | null; ms: number; costDelta: number | null }
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    painel: {
      tokens: number[]
      percent: number | null
      replay: Step[]
      step: number
      activity: Act[]
      turn: TurnStat | null
      cost: number | null
      limits: Limit[]
    }
  }
}
