export const STORAGE_KEYS = {
  snippets: 'blurt_snippets',
  settings: 'blurt_settings',
  openTarget: 'blurt_open_target',
} as const

export const DEFAULT_SETTINGS = {
  enabled: true,
  theme: 'dark' as const,
  triggerPrefix: '/',
  expansionKey: '' as string | '', // empty => auto-expand on Space/Enter
  charLimit: 5000,
  autocompleteEnabled: true,
  autocompletePosition: 'auto' as const,
  autocompleteMaxItems: 8,
  allowlist: [] as string[],
  blocklist: [] as string[],
}

export const THEMES = ['dark', 'light', 'system'] as const
