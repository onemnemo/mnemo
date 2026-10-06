import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { ACCENTS } from "@/lib/accents"

const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf-8")
const accents = readFileSync(new URL("./accents.css", import.meta.url), "utf-8")

/** The light --accent of a preset: tokens.css for the default, the light block of accents.css otherwise. */
function lightAccent(id: string): string | null {
  if (id === "blue") {
    const light = tokens.slice(tokens.indexOf('[data-theme="light"]'))
    return /--accent:\s*([^;]+);/.exec(light)?.[1] ?? null
  }
  const block = new RegExp(`\\[data-theme="light"\\]\\[data-accent="${id}"\\][^{]*\\{[^}]*?--accent:\\s*([^;]+);`)
  return block.exec(accents)?.[1] ?? null
}

function paperAccent(id: string): string | null {
  return new RegExp(`\\[data-accent="${id}"\\]\\s*\\{\\s*--accent-paper:\\s*([^;]+);`).exec(accents)?.[1] ?? null
}

describe("--accent-paper", () => {
  it.each(ACCENTS.map((accent) => accent.id))("matches the light accent of %s", (id) => {
    expect(lightAccent(id)).not.toBeNull()
    expect(paperAccent(id)).toBe(lightAccent(id))
  })

  it("has a theme-free default equal to the default preset", () => {
    const fallback = /:root\s*\{[^}]*--accent-paper:\s*([^;]+);/.exec(tokens)?.[1]
    expect(fallback).toBe(lightAccent("blue"))
  })
})

/** Relative luminance of an `oklch(l c h)` colour, through linear sRGB. */
function luminance(oklch: string): number {
  const [l, c, h] = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(oklch)!.slice(1).map(Number)
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const lms = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b]
  const [L, M, S] = lms.map((v) => v ** 3)
  const rgb = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ].map((v) => Math.min(1, Math.max(0, v)))
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

function askedFill(id: string): string | null {
  return new RegExp(`\\[data-accent="${id}"\\]\\s*\\{[^}]*--accent-paper-asked:\\s*([^;]+);`).exec(accents)?.[1] ?? null
}

describe("--accent-paper-asked", () => {
  const glyph = luminance(/--paper-fg:\s*([^;]+);/.exec(tokens)![1])

  it.each(ACCENTS.map((accent) => accent.id))("carries the white ? at 4.5:1 or more on %s", (id) => {
    const fill = askedFill(id)
    expect(fill).not.toBeNull()
    expect((glyph + 0.05) / (luminance(fill!) + 0.05)).toBeGreaterThanOrEqual(4.5)
  })

  it("has a theme-free default equal to the default preset", () => {
    expect(/:root\s*\{[^}]*--accent-paper-asked:\s*([^;]+);/.exec(tokens)?.[1]).toBe(askedFill("blue"))
  })
})

describe("paper tokens", () => {
  it.each(["--paper", "--paper-fg", "--paper-ink", "--paper-line", "--mask", "--mask-edge"])(
    "defines %s once",
    (name) => {
      const defined = tokens.match(new RegExp(`^\\s*${name}:`, "gm")) ?? []
      expect(defined).toHaveLength(1)
    },
  )
})
