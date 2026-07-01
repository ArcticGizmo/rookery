import { type IpcRendererEvent, contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { RookeryApi } from '@shared/api'
import type { StoredEvent } from '@shared/events'

const api: RookeryApi = {
  ping: () => ipcRenderer.invoke(IPC.appPing),
  events: {
    list: (options) => ipcRenderer.invoke(IPC.eventsList, options),
    onAppend: (listener) => {
      const handler = (_event: IpcRendererEvent, event: StoredEvent): void => listener(event)
      ipcRenderer.on(IPC.eventsAppend, handler)
      return () => {
        ipcRenderer.off(IPC.eventsAppend, handler)
      }
    }
  }
}

// With contextIsolation enabled, expose the API on the isolated main world.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('rookery', api)
  } catch (error) {
    console.error('Failed to expose Rookery API to renderer:', error)
  }
}
