import { apiFetch, apiSend } from "@/api/client"

// The AI feature surface (GET /api/ai/models, POST /api/ai/validate-key,
// GET/PUT /api/ai/settings). Shared by the chat composer and the settings page.
// Mirrors Mnemo.Host/Contracts/AiDto.cs; the C# side is authoritative.

/** An AI model offered by the provider, as the model pickers show it. */
export interface AiModel {
  id: string
  displayName: string
  contextLength: number | null
  promptPricePerMillionUsd: number | null
  completionPricePerMillionUsd: number | null
  supportsToolCalls: boolean
  supportsStructuredOutput: boolean
  supportsReasoning: boolean
}

/** Outcome of a key test. `failureKind` is null on success, else the shared snake_case AI error token. */
export interface AiKeyValidationResult {
  isValid: boolean
  failureKind: string | null
  creditsUsed: number | null
  creditsLimit: number | null
}

/** The AI feature settings the chat composer and settings page hydrate. */
export interface AiSettings {
  webSearchEnabled: boolean
}

/**
 * Lists models. `scope: "all"` requests the full provider catalog (which can fail
 * with an AI error); the default curated shortlist never throws server-side.
 */
export function fetchAiModels(scope?: "all"): Promise<AiModel[]> {
  const query = scope === "all" ? "?scope=all" : ""
  return apiFetch<AiModel[]>(`/ai/models${query}`)
}

/**
 * Tests an OpenRouter key. Pass the value the user typed; leave it undefined to
 * test the saved key server-side (the write-only-secret rule means the SPA can
 * never read the saved key back to send it here).
 */
export function validateAiKey(apiKey?: string): Promise<AiKeyValidationResult> {
  return apiFetch<AiKeyValidationResult>("/ai/validate-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: apiKey ?? null }),
  })
}

export function fetchAiSettings(): Promise<AiSettings> {
  return apiFetch<AiSettings>("/ai/settings")
}

export function putWebSearchEnabled(enabled: boolean): Promise<void> {
  return apiSend("/ai/settings/web-search", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: enabled }),
  })
}
