import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await chromium.launch({ headless: true, executablePath })
try {
  const page = await browser.newPage()
  await page.addInitScript(() => {
    window.__TAURI__ = {
      core: {
        invoke: async (command, args = {}) => {
          if (command === 'get_server') return 'https://sb.example'
          if (command === 'get_diagnostics') {
            return {
              version: '0.2.23',
              server: 'https://sb.example',
              local: { ok: true, items: 25, revision: 25 },
              backup: { ok: true, at: '2026-10-27T20:03:20.551Z' },
            }
          }
          if (command === 'connect_server') {
            window.__connected = args.url
            return args.url
          }
          throw new Error('unexpected command: ' + command)
        },
      },
    }
  })
  await page.goto(pathToFileURL(path.resolve('desktop/setup.html')).href)
  await assert.doesNotReject(page.waitForSelector('#diag'))

  assert.equal(await page.inputValue('#url'), 'https://sb.example')
  await page.click('#diag')
  await page.waitForFunction(() => document.querySelector('#diagOut')?.textContent?.includes('0.2.23'))
  const info = await page.textContent('#diagOut')
  assert.match(info, /"items": 25/)
  assert.match(info, /"backup"/)

  await page.fill('#url', 'https://other.example')
  await page.click('#connect')
  await page.waitForFunction(() => window.__connected === 'https://other.example')
  console.log('desktop setup UI: saved URL, diagnostics, and connect action work')
} finally {
  await browser.close()
}
