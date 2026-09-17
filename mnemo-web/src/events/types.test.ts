import { describe, expect, it } from "vitest"

import { EventType } from "./types"

// Mnemo.Host publishes these names; each is a literal on both sides of the wire. The host's own
// test reads this file to hold the two together, so a rename here has to land there as well.
describe("server event names", () => {
  it("keeps the shutdown name the host's closing handler publishes", () => {
    expect(EventType.Shutdown).toBe("shutdown")
  })

  it("keeps the names the other host producers publish", () => {
    expect(EventType.Hello).toBe("hello")
    expect(EventType.Toast).toBe("toast")
    expect(EventType.MindmapChanged).toBe("mindmap-changed")
    expect(EventType.UpdateStatus).toBe("update-status")
  })
})
