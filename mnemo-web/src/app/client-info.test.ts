// @vitest-environment jsdom


import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const client = vi.hoisted(() => ({ apiSend: vi.fn() }))
vi.mock("@/api/client", () => client)

const { reportClientInfo } = await import("./client-info")

beforeEach(() => {
  client.apiSend.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("reportClientInfo", () => {
  it("posts the browser's user agent to the host", async () => {
    reportClientInfo()

    await vi.waitFor(() => expect(client.apiSend).toHaveBeenCalled())

    expect(client.apiSend).toHaveBeenCalledWith("/app/client-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userAgent: navigator.userAgent }),
    })
  })

  it("does not throw when the request fails", async () => {
    client.apiSend.mockRejectedValue(new Error("offline"))

    expect(() => reportClientInfo()).not.toThrow()
    await vi.waitFor(() => expect(client.apiSend).toHaveBeenCalled())
  })
})
