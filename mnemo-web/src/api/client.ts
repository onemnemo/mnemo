// Typed fetch wrapper for the Mnemo.Host API.
//
// All requests are same-origin (`/api${path}`) by design: the desktop host
// serves the built frontend and the API from the same origin in production,
// so there is no CORS story to maintain. In dev, Vite's proxy (see
// vite.config.ts) forwards `/api/*` to the running Mnemo.Host instance and
// injects the bearer token read from `.dev/api.json`.

declare global {
  interface Window {
    /**
     * Bearer token for the Mnemo.Host API, templated into index.html by the
     * desktop host at production runtime. Absent in dev - the Vite proxy
     * injects the Authorization header instead (see vite.config.ts).
     */
    __MNEMO_TOKEN__?: string
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

interface ApiErrorBody {
  error?: string
  message?: string
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  const errorOk = record.error === undefined || typeof record.error === "string"
  const messageOk = record.message === undefined || typeof record.message === "string"
  return errorOk && messageOk
}

async function readErrorBody(response: Response): Promise<ApiErrorBody | undefined> {
  try {
    const data: unknown = await response.json()
    return isApiErrorBody(data) ? data : undefined
  } catch {
    // Non-JSON or empty error body - fall back to the status text.
    return undefined
  }
}

/**
 * The bearer token for the Mnemo.Host API, or undefined in dev (where the Vite
 * proxy injects the Authorization header instead). Shared with non-JSON callers
 * such as the SSE event stream, which cannot go through {@link apiFetch}.
 */
export function apiToken(): string | undefined {
  return window.__MNEMO_TOKEN__
}

function send(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)

  const token = apiToken()
  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  return fetch(`/api${path}`, { ...init, headers })
}

async function fail(response: Response): Promise<never> {
  const body = await readErrorBody(response)
  const message =
    body?.message ?? body?.error ?? response.statusText ?? `Request failed with status ${response.status}`
  throw new ApiError(message, response.status, body?.error)
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set("Accept", "application/json")

  const response = await send(path, { ...init, headers })
  if (!response.ok) {
    await fail(response)
  }

  const data: unknown = await response.json()
  return data as T
}

/**
 * Like {@link apiFetch} but for requests with no response body to parse (e.g. a
 * PUT that returns 204). Adds the same auth header and error handling.
 */
export async function apiSend(path: string, init?: RequestInit): Promise<void> {
  const response = await send(path, init)
  if (!response.ok) {
    await fail(response)
  }
}

/**
 * Like {@link apiFetch}, but hands back the parsed body for statuses the caller
 * names instead of throwing on them.
 *
 * A few endpoints answer a *protocol* outcome with a non-2xx status and a body
 * that carries the answer: a content commit reports a stale write as 409 with
 * the version actually stored, and that version is the entire point of the
 * response. {@link apiFetch}'s error path reads only `error` and `message`, so
 * it would discard the field precisely when it is needed. Everything not listed
 * still throws, so this does not quietly turn real failures into values.
 */
export async function apiFetchExpecting<T>(
  path: string,
  expected: readonly number[],
  init?: RequestInit,
): Promise<{ status: number; data: T }> {
  const headers = new Headers(init?.headers)
  headers.set("Accept", "application/json")

  const response = await send(path, { ...init, headers })
  if (!response.ok && !expected.includes(response.status)) {
    await fail(response)
  }

  const data: unknown = await response.json()
  return { status: response.status, data: data as T }
}
