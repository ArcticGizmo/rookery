import { describe, expect, it } from 'vitest'
import type { StoredEvent } from '../../src/shared/events'
import { AuditLog } from '../../src/main/services/audit-log'
import { InMemoryEventStore } from '../../src/main/services/in-memory-event-store'
import { InfraService } from '../../src/main/services/infra-service'
import {
  createInfraProvider,
  instanceNameForFlight
} from '../../src/main/services/infra'
import { SprigProvider } from '../../src/main/services/infra/sprig-provider'
import { StubProvider } from '../../src/main/services/infra/stub-provider'
import type { InfraProvider } from '../../src/main/services/infra/infra-provider'

function setup(provider: InfraProvider | null) {
  const audit = new AuditLog(new InMemoryEventStore())
  const service = new InfraService(provider, audit)
  const types = () => audit.list({ limit: 100 }).then((es: StoredEvent[]) => es.map((e) => e.type))
  return { audit, service, types }
}

const spec = (name: string) => ({ name, template: 'api-web', repos: ['api'] })

describe('InfraService', () => {
  it('provisions and emits provisioning → up', async () => {
    const { service, types } = setup(new StubProvider())
    const instance = await service.provision('run-1', spec('rookery-1'))
    expect(instance.state).toBe('up')
    expect(await types()).toEqual(['infra.provisioning', 'infra.up'])
  })

  it('scopes emitted infra events to the run', async () => {
    const { audit, service } = setup(new StubProvider())
    await service.provision('run-42', spec('rookery-42'))
    const events = await audit.list({ limit: 100 })
    expect(events.every((e) => e.flightId === 'run-42')).toBe(true)
  })

  it('emits infra.failed and throws when the provider errors', async () => {
    const provider = new StubProvider()
    provider.create = () => Promise.reject(new Error('docker down'))
    const { service, types } = setup(provider)
    await expect(service.provision('run-2', spec('x'))).rejects.toThrow('docker down')
    expect(await types()).toEqual(['infra.provisioning', 'infra.failed'])
  })

  it('emits infra.failed and throws when no provider is configured', async () => {
    const { service, types } = setup(null)
    await expect(service.provision('run-3', spec('x'))).rejects.toThrow(/no infra provider/i)
    expect(await types()).toEqual(['infra.provisioning', 'infra.failed'])
    expect(service.isConfigured()).toBe(false)
    expect(service.providerName()).toBe('none')
  })

  it('tears down (down + remove) and emits infra.down', async () => {
    const provider = new StubProvider()
    const { service, types } = setup(provider)
    await service.provision('run-4', spec('rookery-4'))
    await service.teardown('run-4', 'rookery-4', { remove: true })
    expect(await provider.info('rookery-4')).toBeNull()
    expect(await types()).toEqual(['infra.provisioning', 'infra.up', 'infra.down'])
  })

  it('teardown is a no-op for an absent instance', async () => {
    const { service, types } = setup(new StubProvider())
    await service.teardown('run-5', 'ghost', { remove: true })
    expect(await types()).toEqual([])
  })
})

describe('createInfraProvider', () => {
  it('selects the provider by kind', () => {
    expect(createInfraProvider('none')).toBeNull()
    expect(createInfraProvider('stub')).toBeInstanceOf(StubProvider)
    expect(createInfraProvider('sprig')).toBeInstanceOf(SprigProvider)
    expect(createInfraProvider('unknown')).toBeInstanceOf(SprigProvider)
  })
})

describe('instanceNameForFlight', () => {
  it('is deterministic, path-safe, and short', () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    const name = instanceNameForFlight(id)
    expect(name).toBe(instanceNameForFlight(id))
    expect(name).toMatch(/^rookery-[0-9a-z]{12}$/)
    // The suffix (the run id) carries no dashes — it must stay path-safe.
    expect(name.slice('rookery-'.length)).not.toContain('-')
  })
})
