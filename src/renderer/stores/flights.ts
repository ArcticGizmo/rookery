import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CheckpointActionInput, Flight, FlightDetail, StartFlightInput } from '@shared/domain'
import { rookery } from '@renderer/lib/rookery'

export const useFlightsStore = defineStore('flights', () => {
  const items = ref<Flight[]>([])
  const loading = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      items.value = await rookery().flights.list()
    } finally {
      loading.value = false
    }
  }

  function get(flightId: string): Promise<FlightDetail | null> {
    return rookery().flights.get(flightId)
  }

  async function start(input: StartFlightInput): Promise<Flight> {
    const run = await rookery().flights.start(input)
    await load()
    return run
  }

  function checkpoint(input: CheckpointActionInput): Promise<void> {
    return rookery().flights.checkpoint(input)
  }

  async function cancel(flightId: string): Promise<void> {
    await rookery().flights.cancel(flightId)
    await load()
  }

  return { items, loading, load, get, start, checkpoint, cancel }
})
