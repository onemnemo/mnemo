import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { ACTION_NAMESPACE, DEFAULT_CHORDS } from "../keys"

const MODULE = path.resolve(import.meta.dirname, "../../../../../../Mnemo.Infrastructure/Modules/Flashcards/FlashcardsBackendModule.cs")

/** The chords the host registers for the editor, by action, read from the manifest source. */
function registered(): Map<string, string[]> {
  const source = readFileSync(MODULE, "utf8")
  const found = new Map<string, string[]>()
  for (const line of source.matchAll(/Chords\(OcclusionNamespace, "flashcards-occlusion\.([\w-]+)"((?:, "[^"]+")+)\)/g)) {
    // The host spells Enter both ways, as the test screen's manifest does; the browser only ever sees Enter.
    const chords = [...line[2].matchAll(/"([^"]+)"/g)].map((chord) => chord[1].replace(/\bReturn$/, "Enter"))
    found.set(line[1], [...new Set(chords)])
  }
  return found
}

describe("occlusion editor key manifest", () => {
  it("registers exactly the editor's actions under the editor's namespace", () => {
    expect(ACTION_NAMESPACE).toBe("flashcards-occlusion")
    expect([...registered().keys()].sort()).toEqual(Object.keys(DEFAULT_CHORDS).sort())
  })

  it("binds each action to the chords the editor expects by default", () => {
    const manifest = registered()
    for (const [action, chords] of Object.entries(DEFAULT_CHORDS)) {
      expect([...(manifest.get(action) ?? [])].sort(), action).toEqual([...chords].sort())
    }
  })
})
