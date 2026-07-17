// Icon registry. Loads the real Mnemo SVGs (ported verbatim from Mnemo.UI/Icons
// and Assets/Branding) as raw strings at build time and normalizes them for
// inline, currentColor-tinted rendering. Add icons by dropping the source SVG
// into src/assets/icons/<category>/; it becomes available as "<category>/<name>".

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
  const key = path.replace(/^.*\/assets\/icons\//, "").replace(/\.svg$/, "")
  RAW.set(key, content)
}
for (const [path, content] of Object.entries(brandingModules)) {
  // ".../assets/branding/logo-full.svg" -> "branding/logo-full"
  const key = path.replace(/^.*\/assets\//, "").replace(/\.svg$/, "")
  RAW.set(key, content)
}

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

/** Normalized inline SVG markup for an icon, or null (with a dev warning) if unknown. */
export function getIconMarkup(name: string, preserveColors = false): string | null {
  const cacheKey = preserveColors ? `p:${name}` : name
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached

  const raw = RAW.get(name)
  if (raw === undefined) {
    if (import.meta.env.DEV) console.error(`[AppIcon] unknown icon "${name}"`)
    return null
  }

  const normalized = normalizeSvg(raw, preserveColors)
  cache.set(cacheKey, normalized)
  return normalized
}

export function hasIcon(name: string): boolean {
  return RAW.has(name)
}

/** Loose for now (runtime-validated); a generated union can tighten this later. */
export type IconName = string
