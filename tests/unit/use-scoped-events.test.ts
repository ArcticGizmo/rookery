// @vitest-environment jsdom
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { ListEventsOptions, StoredEvent } from '../../src/shared/events'
import { useScopedEvents } from '../../src/renderer/composables/use-scoped-events'

function ev(id: number, runId: string | null, type = 'run.stage_entered'): StoredEvent {
  return { id, ts: `t${id}`, type: type as StoredEvent['type'], actor: 'system', runId, stageId: null, payload: {} }
}

/** A fake `window.rookery` whose event log is a fixed array, with a live emitter. */
function installFakeApi(all: StoredEvent[]) {
  let listener: ((e: StoredEvent) => void) | null = null

  function list(options?: ListEventsOptions): Promise<StoredEvent[]> {
    const afterId = options?.afterId ?? 0
    const limit = options?.limit ?? 500
    let rows = all.filter((e) => e.id > afterId)
    if (options?.runId) rows = rows.filter((e) => e.runId === options.runId)
    rows.sort((a, b) => a.id - b.id)
    return Promise.resolve(rows.slice(0, limit))
  }

  ;(globalThis as unknown as { window: Window }).window.rookery = {
    events: {
      list,
      onAppend(fn: (e: StoredEvent) => void) {
        listener = fn
        return () => {
          listener = null
        }
      }
    }
  } as unknown as Window['rookery']

  return {
    emit(e: StoredEvent) {
      all.push(e)
      listener?.(e)
    },
    get hasListener() {
      return listener !== null
    }
  }
}

/** Mount a throwaway component so the composable's lifecycle hooks run. */
function useInComponent(options: () => ListEventsOptions, matches: (e: StoredEvent) => boolean) {
  let api!: ReturnType<typeof useScopedEvents>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useScopedEvents(options, matches)
        return () => null
      }
    })
  )
  return { wrapper, get: () => api }
}

describe('useScopedEvents', () => {
  let runId = 'r1'

  afterEach(() => {
    runId = 'r1'
  })

  it('backfills a scope from the backend, oldest-first', async () => {
    installFakeApi([ev(1, 'r1'), ev(2, 'r2'), ev(3, 'r1'), ev(4, 'r1')])
    const { wrapper, get } = useInComponent(
      () => ({ runId }),
      (e) => e.runId === runId
    )
    await nextTick()
    await nextTick()

    expect(get().loaded.value).toBe(true)
    expect(get().events.value.map((e) => e.id)).toEqual([1, 3, 4])
    wrapper.unmount()
  })

  it('pages through a scope larger than one page', async () => {
    // 1200 events for r1 → three pages of 500/500/200.
    const many = Array.from({ length: 1200 }, (_, i) => ev(i + 1, 'r1'))
    installFakeApi(many)
    const { wrapper, get } = useInComponent(
      () => ({ runId }),
      (e) => e.runId === runId
    )
    await nextTick()
    // A few ticks for the pagination loop to resolve.
    for (let i = 0; i < 6; i++) await nextTick()

    expect(get().events.value).toHaveLength(1200)
    expect(get().events.value[0]!.id).toBe(1)
    expect(get().events.value[1199]!.id).toBe(1200)
    wrapper.unmount()
  })

  it('appends matching live events and ignores others', async () => {
    const api = installFakeApi([ev(1, 'r1')])
    const { wrapper, get } = useInComponent(
      () => ({ runId }),
      (e) => e.runId === runId
    )
    await nextTick()
    await nextTick()
    expect(get().events.value.map((e) => e.id)).toEqual([1])

    api.emit(ev(2, 'r1'))
    api.emit(ev(3, 'r2')) // different scope — ignored
    await nextTick()

    expect(get().events.value.map((e) => e.id)).toEqual([1, 2])
    wrapper.unmount()
  })

  it('does not double-count an event present in both backfill and live stream', async () => {
    const api = installFakeApi([ev(1, 'r1'), ev(2, 'r1')])
    const { wrapper, get } = useInComponent(
      () => ({ runId }),
      (e) => e.runId === runId
    )
    await nextTick()
    await nextTick()

    // Re-emit an already-loaded id — must be deduped.
    api.emit(ev(2, 'r1'))
    await nextTick()

    expect(get().events.value.map((e) => e.id)).toEqual([1, 2])
    wrapper.unmount()
  })

  it('reloads a fresh scope when the source changes', async () => {
    installFakeApi([ev(1, 'r1'), ev(2, 'r2'), ev(3, 'r2')])
    const { wrapper, get } = useInComponent(
      () => ({ runId }),
      (e) => e.runId === runId
    )
    await nextTick()
    await nextTick()
    expect(get().events.value.map((e) => e.id)).toEqual([1])

    runId = 'r2'
    await get().reload()
    expect(get().events.value.map((e) => e.id)).toEqual([2, 3])
    wrapper.unmount()
  })
})
