import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Mnemo.Host's fixed dev-mode listen address.
const API_PROXY_TARGET = 'http://127.0.0.1:47210'
const DEV_API_CONFIG_PATH = path.resolve(import.meta.dirname, '.dev/api.json')

/** Shape of `.dev/api.json`, written by the C# dev host at startup. */
interface DevApiConfig {
  port: number
  token: string
}

function isDevApiConfig(value: unknown): value is DevApiConfig {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return typeof record.port === 'number' && typeof record.token === 'string'
}

// Re-reading and re-parsing .dev/api.json on every proxied request would be
// wasteful, so cache the parsed token and only refresh it when the file's
// mtime changes (e.g. the dev host restarted and rewrote it with a new token).
let cachedMtimeMs: number | undefined
let cachedToken: string | undefined

function readDevToken(): string | undefined {
  let stat: fs.Stats
  try {
    stat = fs.statSync(DEV_API_CONFIG_PATH)
  } catch {
    // Dev host hasn't written the file yet (or isn't running) - proxy without auth.
    cachedMtimeMs = undefined
    cachedToken = undefined
    return undefined
  }

  if (stat.mtimeMs === cachedMtimeMs) {
    return cachedToken
  }

  try {
    const raw = fs.readFileSync(DEV_API_CONFIG_PATH, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    cachedToken = isDevApiConfig(parsed) ? parsed.token : undefined
  } catch {
    // Missing, empty, or mid-write JSON - proxy without auth rather than crash.
    cachedToken = undefined
  }
  cachedMtimeMs = stat.mtimeMs

  return cachedToken
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const token = readDevToken()
            if (token) {
              proxyReq.setHeader('authorization', `Bearer ${token}`)
            }
          })
        },
      },
    },
  },
})
