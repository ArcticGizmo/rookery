import type { ListEventsOptions, StoredEvent } from './events'

/**
 * Central registry of IPC channel names. All main<->renderer traffic references
 * these constants — no magic channel strings scattered through the codebase.
 */
export const IPC = {
  appPing: 'app:ping',
  eventsList: 'events:list',
  eventsAppend: 'events:append'
} as const

/** Request/response channels: renderer invokes, main handles. */
export interface IpcInvokeMap {
  'app:ping': { args: []; result: string }
  'events:list': { args: [options: ListEventsOptions | undefined]; result: StoredEvent[] }
}

/** Push channels: main sends, renderer listens. */
export interface IpcPushMap {
  'events:append': StoredEvent
}
