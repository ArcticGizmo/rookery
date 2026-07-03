import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('app boots, migrates, and opens on the Desk with the boot event logged', async () => {
  // Isolate from the real user database (a fresh DB migrates cleanly to the baseline).
  const dbPath = join(tmpdir(), `rookery-e2e-${randomUUID()}.db`)
  const app = await electron.launch({
    args: [join(projectRoot, 'out', 'main', 'index.js')],
    env: { ...process.env, ROOKERY_DB_PATH: dbPath }
  })

  try {
    const window = await app.firstWindow()
    // The brand lives in the top nav; the app now opens on the Desk.
    await expect(window.getByText('Rookery').first()).toBeVisible()
    await expect(window.locator('h1')).toHaveText('What do you want done?')
    // The boot event is appended before the window loads — visible in the log.
    await window.getByRole('link', { name: 'History' }).click()
    await expect(window.locator('h1')).toHaveText('History')
    await expect(window.getByText('app.booted').first()).toBeVisible()
  } finally {
    await app.close()
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (existsSync(`${dbPath}${suffix}`)) rmSync(`${dbPath}${suffix}`, { force: true })
      } catch {
        // best-effort
      }
    }
  }
})
