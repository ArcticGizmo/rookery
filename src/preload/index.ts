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
  },
  workItems: {
    list: () => ipcRenderer.invoke(IPC.workItemsList),
    get: (id) => ipcRenderer.invoke(IPC.workItemsGet, id),
    create: (input) => ipcRenderer.invoke(IPC.workItemsCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC.workItemsUpdate, id, input),
    remove: (id) => ipcRenderer.invoke(IPC.workItemsDelete, id)
  },
  spec: {
    save: (workItemId, content) => ipcRenderer.invoke(IPC.specSave, workItemId, content),
    history: (workItemId) => ipcRenderer.invoke(IPC.specHistory, workItemId),
    diff: (workItemId, fromVersion, toVersion) =>
      ipcRenderer.invoke(IPC.specDiff, workItemId, fromVersion, toVersion)
  },
  workflows: {
    list: () => ipcRenderer.invoke(IPC.workflowsList),
    get: (id) => ipcRenderer.invoke(IPC.workflowsGet, id),
    create: (input) => ipcRenderer.invoke(IPC.workflowsCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC.workflowsUpdate, id, input),
    remove: (id) => ipcRenderer.invoke(IPC.workflowsDelete, id)
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
