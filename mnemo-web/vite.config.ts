import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Mnemo.Host's dev-mode listen port, used until the host has written its
// handshake file. The host honours MNEMO_DEV_API_PORT, which is how a second
// host runs beside the first one without either touching the other's profile,
// so the port is read back from the file rather than assumed.
const DEFAULT_API_PORT = 47210
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

function readDevApiConfig(): DevApiConfig | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(DEV_API_CONFIG_PATH, 'utf-8'))
    return isDevApiConfig(parsed) ? parsed : undefined
  } catch {
    // Missing, empty, or mid-write JSON. Callers fall back to the default port
    // and to proxying without auth, rather than crashing the dev server.
    return undefined
  }
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

  cachedToken = readDevApiConfig()?.token
  cachedMtimeMs = stat.mtimeMs

  return cachedToken
}

// The port is read once, at config load, because the target address is fixed
// when the dev server starts. Vite restarts itself when this file changes, and
// pointing at a different host is a restart either way.
const API_PROXY_TARGET = `http://127.0.0.1:${readDevApiConfig()?.port ?? DEFAULT_API_PORT}`

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
