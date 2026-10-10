export type Suggestion = { label: string; text: string }
export type Band = { items: Suggestion[]; note: string | null }

declare module 'claude-code' {
  interface PluginState {
    'next-prompts': { band: Band }
  }
}
