export type Cat = { name: string; tokens: number }
export type Ctx = { pct: number; tokens: number; window: number; cats: Cat[] }
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'uso-vivo': {
      ctx: Ctx | null
      limits: Limit[]
      cost: number | null
      isEnabled: boolean
    }
  }
}
