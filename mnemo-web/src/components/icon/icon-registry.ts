// Icon registry: the single place that decides what an icon name resolves to.
//
// Two sources, one namespace.
//
//   "house", "search"          a lucide glyph, from the curated set in lucide-set.ts
//   "sidebar/overview"         a project SVG, from src/assets/icons/<category>/<name>.svg
//
// Lucide is the default source, and the categorised keys are the project's own icons.
// Custom art wins wherever the two meet: a file dropped at the root of the icons folder
// claims a bare name and shadows the lucide glyph of the same name, which is how a
// specific icon gets replaced without touching a single call site.
//
// Keeping the lookup here rather than importing lucide at call sites is the point. Size
// and stroke normalise in one component, an icon can be swapped for hand-drawn art
// later, and nothing downstream has to know which of the two it is getting.

import type { LucideIcon } from "lucide-react"

import { LUCIDE_SET } from "./lucide-set"

const iconModules = import.meta.glob("../../assets/icons/**/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

const brandingModules = import.meta.glob("../../assets/branding/**/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

const RAW = new Map<string, string>()
for (const [path, content] of Object.entries(iconModules)) {
  // ".../assets/icons/sidebar/overview.svg" -> "sidebar/overview"
  // ".../assets/icons/search.svg"           -> "search"        (shadows lucide)
  const key = path.replace(/^.*\/assets\/icons\//, "").replace(/\.svg$/, "")
  RAW.set(key, content)
}
for (const [path, content] of Object.entries(brandingModules)) {
  // ".../assets/branding/logo-full.svg" -> "branding/logo-full"
  const key = path.replace(/^.*\/assets\//, "").replace(/\.svg$/, "")
  RAW.set(key, content)
}

const LUCIDE = new Map<string, LucideIcon>(Object.entries(LUCIDE_SET))

function normalizeSvg(raw: string, preserveColors: boolean): string {
  let svg = raw
    .replace(/^﻿/, "") // strip BOM
    .replace(/<\?xml[^>]*\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim()

  // Drop root width/height so the component owns sizing (the viewBox scales content).
  svg = svg.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => `<svg${attrs.replace(/\s(?:width|height)="[^"]*"/gi, "")}>`)

  if (!preserveColors) {
    // Concrete fill/stroke colors -> currentColor, leaving "none" and existing currentColor.
    svg = svg.replace(/\b(fill|stroke)="(?!none"|currentColor")[^"]*"/gi, '$1="currentColor"')
  }

  return svg
}

const cache = new Map<string, string>()

/** Normalized inline SVG markup for a project icon, or null when the name is not one. */
export function getIconMarkup(name: string, preserveColors = false): string | null {
  const cacheKey = preserveColors ? `p:${name}` : name
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached

  const raw = RAW.get(name)
  if (raw === undefined) return null

  const normalized = normalizeSvg(raw, preserveColors)
  cache.set(cacheKey, normalized)
  return normalized
}

/** The lucide component for a name, or null when no glyph goes by it. */
export function getLucideIcon(name: string): LucideIcon | null {
  return LUCIDE.get(name) ?? null
}

export function hasIcon(name: string): boolean {
  return RAW.has(name) || LUCIDE.has(name)
}

/** Loose on purpose: names come from both a file tree and lucide, so a union would be generated, not written. */
export type IconName = string
