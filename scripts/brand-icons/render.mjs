// Renders the default (Sunset) app icon files the build ships, with the same renderer the
// app uses when a user picks another logo, so the shipped icon and a chosen one match.
//
//   npm install && node render.mjs   (from scripts/brand-icons)
//
// Writes Mnemo.Host/Branding/Default/mnemo.ico (the exe and Windows installer),
// mnemo-256.png (Linux) and mnemo-1024.png (the macOS icns source in release.yml).

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const OUT = path.join(REPO, 'Mnemo.Host/Branding/Default')

// The web app's own bundler, so the renderer's TypeScript runs unchanged.
const require = createRequire(path.join(REPO, 'mnemo-web/package.json'))
const { build } = await import(pathToFileURL(require.resolve('rolldown')).href)
const bundle = await build({
  input: path.join(REPO, 'mnemo-web/src/lib/brand/app-icon.ts'),
  output: { format: 'iife', name: 'appIcon' },
  write: false,
})
const code = bundle.output[0].code

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--force-color-profile=srgb'] })
try {
  const page = await browser.newPage()
  await page.addScriptTag({ content: code })
  const files = await page.evaluate(async () => {
    const encode = (bytes) => Array.from(bytes)
    return {
      ico: encode(await window.appIcon.renderIconFile('ico', 'sunset', '')),
      png256: encode(await window.appIcon.renderIconFile('png256', 'sunset', '')),
      png1024: encode(await window.appIcon.renderIconFile('png1024', 'sunset', '')),
    }
  })
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'mnemo.ico'), Buffer.from(files.ico))
  fs.writeFileSync(path.join(OUT, 'mnemo-256.png'), Buffer.from(files.png256))
  fs.writeFileSync(path.join(OUT, 'mnemo-1024.png'), Buffer.from(files.png1024))
  console.log(`Wrote ${OUT}`)
} finally {
  await browser.close()
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ]
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate))
  if (!found) throw new Error('No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser.')
  return found
}
