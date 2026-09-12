import { describe, expect, it } from "vitest"

import type { ToastType } from "@/stores/toast"

import { notificationMark } from "./notification-model"

describe("notificationMark", () => {
  it("falls back to the information mark for an unknown host type", () => {
    expect(notificationMark("task" as ToastType).icon).toBe("info")
  })
})
