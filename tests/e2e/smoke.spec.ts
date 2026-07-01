import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('app boots, migrates, and shows the app.booted event in the log', async () => {
  const app = await electron.launch({
    args: [join(projectRoot, 'out', 'main', 'index.js')]
  })

  try {
    const window = await app.firstWindow()
    await expect(window.locator('h1')).toHaveText('Rookery')
    // The boot event is appended before the window loads and rendered live via IPC.
    await expect(window.getByText('app.booted').first()).toBeVisible()
  } finally {
    await app.close()
  }
})
