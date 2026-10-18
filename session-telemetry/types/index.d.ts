// A contract may export only types; this one keeps the file a module.
export type SessionTelemetryState = { isEnabled: boolean }

declare module 'claude-code' {
  interface PluginState {
    'session-telemetry': { isEnabled: boolean }
  }
}
