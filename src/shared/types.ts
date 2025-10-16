export interface Snippet {
  id: string
  trigger: string
  description?: string
  body: string
}

export interface Settings {
  enabled: boolean
  theme: 'light' | 'dark' | 'system'
  triggerPrefix: string // default "/", user-changeable
  expansionKey?: string | '' // empty/undefined => auto-expand on Space/Enter
  charLimit: number // default 5000
  autocompleteEnabled: boolean
  autocompletePosition?: 'auto' | 'top' | 'bottom'
  autocompleteMaxItems?: number
  allowlist?: string[]
  blocklist?: string[]
}

export interface StorageShape {
  snippets: Snippet[]
  settings: Settings
}
