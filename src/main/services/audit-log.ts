import { EventEmitter } from 'node:events'
import type { AppEvent, EventScope, ListEventsOptions, StoredEvent } from '@shared/events'
import type { EventStore } from './event-store'

export type AppendInput = AppEvent & EventScope

/**
 * The append-only audit log. Assigns the timestamp, delegates persistence to an
 * `EventStore`, and notifies subscribers of each appended event.
 */
export class AuditLog {
  private readonly emitter = new EventEmitter()

  constructor(private readonly store: EventStore) {}

  async append(event: AppendInput): Promise<StoredEvent> {
    const stored = await this.store.insert({
      ts: new Date().toISOString(),
      type: event.type,
      actor: event.actor,
      runId: event.runId ?? null,
      stageId: event.stageId ?? null,
      payload: event.payload
    })
    this.emitter.emit('append', stored)
    return stored
  }

  list(options?: ListEventsOptions): Promise<StoredEvent[]> {
    return this.store.list(options)
  }

  onAppend(listener: (event: StoredEvent) => void): () => void {
    this.emitter.on('append', listener)
    return () => {
      this.emitter.off('append', listener)
    }
  }
}
