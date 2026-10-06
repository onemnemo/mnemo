// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"

import { useTrashInvalidator } from "./api"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Probe({ onReady }: { onReady: (invalidate: () => void) => void }) {
  onReady(useTrashInvalidator())
  return null
}

describe("a restore from the trash", () => {
  it("marks the material behind every card stale, so the editor reads the restored masks", () => {
    const client = new QueryClient()
    const factKey = ["flashcards", "fact-for-card", "card-1"]
    client.setQueryData(factKey, { id: "fact-1" })

    let invalidate: () => void = () => {}
    const host = document.createElement("div")
    const root = createRoot(host)
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe onReady={(fn) => (invalidate = fn)} />
        </QueryClientProvider>,
      ),
    )
    expect(client.getQueryState(factKey)?.isInvalidated).toBe(false)

    act(() => invalidate())

    expect(client.getQueryState(factKey)?.isInvalidated).toBe(true)
    act(() => root.unmount())
  })
})
