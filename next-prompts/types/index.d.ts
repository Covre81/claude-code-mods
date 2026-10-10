export type Suggestion = { label: string; text: string }
/** `picked`: indexes already put in the prompt box, so later presses stack under them. */
export type Band = { items: Suggestion[]; note: string | null; picked?: number[] }

declare module 'claude-code' {
  interface PluginState {
    'next-prompts': { band: Band }
  }
}
