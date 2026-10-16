export type WebfetchCacheState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'webfetch-cache': {
      isEnabled: boolean
    }
  }
}
