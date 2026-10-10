export type Card = { src: 'it' | 'dev' | 'linux'; front: string; back: string; topic?: string }

declare module 'claude-code' {
  interface PluginState {
    'wait-quiz': { card: Card | null; isRevealed: boolean }
  }
}
