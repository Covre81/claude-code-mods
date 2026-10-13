export type Report = {
  command: string
  label: string
  explain: string
  summary: string
  lines: string[]
  note?: string
}

declare module 'claude-code' {
  interface PluginState {
    guarda: { held: Report | null }
  }
}
