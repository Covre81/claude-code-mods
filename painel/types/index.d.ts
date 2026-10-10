export type DiffLine = { sign: '+' | '-' | ' ' | '…'; text: string }
export type Step = { file: string; tool: string; lines: DiffLine[] }

declare module 'claude-code' {
  interface PluginState {
    painel: { tokens: number[]; percent: number | null; replay: Step[]; step: number }
  }
}
