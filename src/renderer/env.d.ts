/// <reference types="vite/client" />
import type { RookeryApi } from '@shared/api'

declare global {
  interface Window {
    rookery: RookeryApi
  }
}

export {}
