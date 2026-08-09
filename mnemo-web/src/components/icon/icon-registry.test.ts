import { describe, expect, it } from "vitest"

import { getIconMarkup, getLucideIcon, hasIcon } from "./icon-registry"

describe("lucide lookup", () => {
  it("resolves a single-word name", () => {
    expect(getLucideIcon("house")).not.toBeNull()
  })

  it("resolves a multi-word name as kebab-case", () => {
    // lucide exports these as NotebookText/SquareStack; the codebase spells them the way
    // lucide's own docs do.
    expect(getLucideIcon("notebook-text")).not.toBeNull()
    expect(getLucideIcon("square-stack")).not.toBeNull()
    expect(getLucideIcon("chevrons-left")).not.toBeNull()
  })

  it("does not resolve the PascalCase spelling", () => {
    expect(getLucideIcon("House")).toBeNull()
  })

  it("returns null for a glyph the build does not ship", () => {
    // Not a typo: a real lucide icon that is simply not in the curated set. The set is
    // the shipped inventory, so anything outside it has to miss rather than resolve.
    expect(getLucideIcon("arrow-up-wide-narrow")).toBeNull()
    expect(getLucideIcon("definitely-not-an-icon")).toBeNull()
  })
})

describe("project icons", () => {
  it("resolves a categorised name to inline markup", () => {
    const markup = getIconMarkup("common/search")
    expect(markup).toContain("<svg")
  })

  it("tints to currentColor and drops the root size so the component owns it", () => {
    const markup = getIconMarkup("common/search") ?? ""
    expect(markup).toContain("currentColor")
    expect(markup).not.toMatch(/<svg[^>]*\swidth=/i)
    expect(markup).not.toMatch(/<svg[^>]*\sheight=/i)
  })

  it("keeps the source colors when asked", () => {
    // An icon that actually carries literal colors. Most do not, and asserting this
    // against one that is already currentColor proves nothing, because both paths
    // legitimately return the same string.
    expect(getIconMarkup("toast/system_error", true)).toMatch(/(fill|stroke)="#[0-9a-fA-F]+"/)
    expect(getIconMarkup("toast/system_error")).not.toMatch(/(fill|stroke)="#[0-9a-fA-F]+"/)
  })

  it("returns null for a lucide-only name, so the caller falls through to lucide", () => {
    expect(getIconMarkup("house")).toBeNull()
  })
})

describe("hasIcon", () => {
  it("covers both sources", () => {
    expect(hasIcon("common/search")).toBe(true)
    expect(hasIcon("house")).toBe(true)
    expect(hasIcon("definitely-not-an-icon")).toBe(false)
  })
})
