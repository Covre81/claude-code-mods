export type UniversalAuditLogState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'universal-audit-log': {
      isEnabled: boolean
    }
  }
}
