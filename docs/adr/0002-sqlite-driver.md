# ADR 0002 — SQLite driver: libsql instead of better-sqlite3

**Status:** Accepted · **Date:** 2026-07-01 · **Supersedes** the driver choice in [ADR 0001](./0001-stack.md)

## Context

ADR 0001 selected **better-sqlite3** as the SQLite driver. During Phase 1 implementation
two hard blockers emerged in this environment:

1. **No Electron-43 prebuilt.** better-sqlite3 12.11.1 publishes no prebuilt binary for
   Electron 43's ABI (module version 148), so it must compile from source for Electron.
2. **Corporate TLS proxy blocks the source build.** `@electron/rebuild` / node-gyp must
   download Electron headers, and the network injects a self-signed certificate
   (`SELF_SIGNED_CERT_IN_CHAIN`), so the compile fails. (GitHub-hosted prebuilds download
   fine — the block is specific to the header/source path.)

better-sqlite3 is also a classic native V8 addon: its binary is ABI-specific, so a build for
Electron can't be loaded by Node — which would prevent running the audit-store logic under
Vitest (Node) at all.

## Decision

Use **libsql** (`@libsql/client`) with Drizzle's first-class `drizzle-orm/libsql` adapter and
`drizzle-orm/libsql/migrator`.

- **N-API / ABI-stable:** one registry-installed prebuilt binary loads in both Electron and
  Node — no per-runtime rebuild, no ABI split between the app and tests.
- **No post-install compile or download:** the platform binary ships as a normal npm optional
  dependency (`@libsql/win32-x64-msvc`), so the corporate proxy is a non-issue.
- **Minimal deviation:** it stays within Drizzle ORM + drizzle-kit migrations, as ADR 0001
  intended — only the driver changed. The DB code is isolated behind the `EventStore` port,
  so the driver is swappable.

Local databases use a `file:` URL (`createClient({ url: pathToFileURL(dbPath) })`).

## Consequences

- The libsql API is **async** (Promise-based), where better-sqlite3 is synchronous. The
  `EventStore` / `AuditLog` methods are async accordingly; this composes naturally with the
  already-async IPC layer.
- Packaging: electron-builder auto-unpacks the native module to `app.asar.unpacked`. Only the
  current platform's libsql binary is bundled (a build for another OS would need that platform's
  `@libsql/*` optional dependency present).
- Unit tests run against an `InMemoryEventStore` (no native module); the libsql-backed
  `SqliteEventStore` is exercised end-to-end by the Playwright e2e inside Electron.
