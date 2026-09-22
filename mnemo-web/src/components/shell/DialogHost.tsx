import { Dialog } from "radix-ui"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { useDialogStore } from "@/stores/dialog"

import { getTopLayer } from "./top-layer"

export function DialogHost() {
  const request = useDialogStore((s) => s.queue[0])
  const settle = useDialogStore((s) => s.settle)
  const [value, setValue] = useState("")

  // Reseed the input when a new request surfaces.
  useEffect(() => {
    if (request?.kind === "input") setValue(request.defaultValue)
  }, [request])

  const open = request != null

  function cancel() {
    if (request) settle(request.id, request.kind === "confirm" ? false : null)
  }

  function accept() {
    if (!request) return
    settle(request.id, request.kind === "confirm" ? true : value)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && cancel()}>
      <Dialog.Portal container={getTopLayer()}>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Content
          {...(request?.message ? {} : { "aria-describedby": undefined })}
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-[var(--overlay-background)] p-5 shadow-elevation-4 focus:outline-none"
        >
          {request && (
            <>
              <Dialog.Title className="text-heading-6 font-semibold text-foreground">{request.title}</Dialog.Title>
              {request.message && (
                <Dialog.Description className="mt-1 text-body-small text-muted-foreground">
                  {request.message}
                </Dialog.Description>
              )}

              {request.kind === "input" && (
                <input
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={request.placeholder}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") accept()
                  }}
                  className="mt-3 w-full rounded-md border bg-[var(--text-control-background)] px-3 py-2 text-body-small text-foreground placeholder:text-[var(--text-control-placeholder-foreground)] focus:border-[var(--line)] focus:outline-none"
                />
              )}

              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={cancel}>
                  {request.cancelLabel}
                </Button>
                <Button
                  variant={request.kind === "confirm" && request.destructive ? "danger" : "solid"}
                  autoFocus={request.kind === "confirm"}
                  onClick={accept}
                >
                  {request.confirmLabel}
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
