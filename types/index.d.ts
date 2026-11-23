declare module 'claude-code' {
  interface PluginState {
    'ocean-tide': {
      level: number
      warned: boolean
      skyTime: number
      forceLevel: number
      pinnedTime: number
    }
  }
}
export type SeaLevel = number
