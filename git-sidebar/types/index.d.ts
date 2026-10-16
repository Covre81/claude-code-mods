export type GitSidebarState = {
  isEnabled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'git-sidebar': {
      isEnabled: boolean
    }
  }
}
