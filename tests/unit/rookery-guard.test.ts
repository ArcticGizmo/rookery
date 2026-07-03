// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { RookeryApi } from '../../src/shared/api'
import { rookery } from '../../src/renderer/lib/rookery'

const win = window as Window & { rookery?: RookeryApi }

afterEach(() => {
  delete win.rookery
})

describe('rookery() guard', () => {
  it('throws an actionable error when the preload bridge is missing', () => {
    delete win.rookery
    expect(() => rookery()).toThrowError(/Electron window, not a browser tab/)
  })

  it('returns the bridge when present', () => {
    const api = { ping: () => Promise.resolve('pong') } as unknown as RookeryApi
    win.rookery = api
    expect(rookery()).toBe(api)
  })
})
