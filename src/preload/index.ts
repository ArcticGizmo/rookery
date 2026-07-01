import { contextBridge } from 'electron'
import type { RookeryApi } from '@shared/api'

const api: RookeryApi = {
  ping: () => 'pong'
}

// With contextIsolation enabled, expose the API on the isolated main world.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('rookery', api)
  } catch (error) {
    console.error('Failed to expose Rookery API to renderer:', error)
  }
}
