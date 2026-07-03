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
  workspace: {
    pickDirectory: (defaultPath) => ipcRenderer.invoke(IPC.dialogPickDirectory, defaultPath),
    probeRepo: (localPath) => ipcRenderer.invoke(IPC.repoProbe, localPath),
    listDirs: (input) => ipcRenderer.invoke(IPC.fsListDirs, input)
  },
  briefs: {
    list: () => ipcRenderer.invoke(IPC.briefsList),
    get: (id) => ipcRenderer.invoke(IPC.briefsGet, id),
    create: (input) => ipcRenderer.invoke(IPC.briefsCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC.briefsUpdate, id, input),
    remove: (id) => ipcRenderer.invoke(IPC.briefsDelete, id)
  },
  spec: {
    save: (briefId, content) => ipcRenderer.invoke(IPC.specSave, briefId, content),
    history: (briefId) => ipcRenderer.invoke(IPC.specHistory, briefId),
    diff: (briefId, fromVersion, toVersion) =>
      ipcRenderer.invoke(IPC.specDiff, briefId, fromVersion, toVersion)
  },
  approaches: {
    list: () => ipcRenderer.invoke(IPC.approachesList),
    get: (id) => ipcRenderer.invoke(IPC.approachesGet, id),
    create: (input) => ipcRenderer.invoke(IPC.approachesCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC.approachesUpdate, id, input),
    remove: (id) => ipcRenderer.invoke(IPC.approachesDelete, id),
    draft: (briefId) => ipcRenderer.invoke(IPC.approachesDraft, briefId)
  },
  agent: {
    credentials: () => ipcRenderer.invoke(IPC.agentCredentials),
    start: (config) => ipcRenderer.invoke(IPC.agentStart, config),
    cancel: (agentRunId) => ipcRenderer.invoke(IPC.agentCancel, agentRunId)
  },
  flights: {
    start: (input) => ipcRenderer.invoke(IPC.runsStart, input),
    list: () => ipcRenderer.invoke(IPC.runsList),
    get: (flightId) => ipcRenderer.invoke(IPC.runsGet, flightId),
    checkpoint: (input) => ipcRenderer.invoke(IPC.runsCheckpoint, input),
    cancel: (flightId) => ipcRenderer.invoke(IPC.runsCancel, flightId),
    infra: (flightId) => ipcRenderer.invoke(IPC.runsInfra, flightId),
    changes: (flightId) => ipcRenderer.invoke(IPC.runsChanges, flightId),
    landTargets: (flightId) => ipcRenderer.invoke(IPC.runsLandTargets, flightId),
    land: (input) => ipcRenderer.invoke(IPC.runsLand, input),
    teardown: (flightId) => ipcRenderer.invoke(IPC.runsTeardown, flightId)
  },
  update: {
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    install: () => ipcRenderer.invoke(IPC.updateInstall)
  },
  debug: {
    resetData: () => ipcRenderer.invoke(IPC.debugResetData)
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
