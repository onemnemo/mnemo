import type { ComponentPropsWithoutRef, MouseEvent } from "react"

import { navigateTo } from "@/app/router"
import { cn } from "@/lib/utils"

/**
 * A place in the app, drawn as a control rather than as a link.
 *
 * The shell is a window, and the routes behind it are an implementation detail. An anchor offers
 * its target to a new window on a middle click or a modifier click, and a single-window app has
 * nowhere to put that. So everything that navigates inside the app is a button that sets the hash,
 * and `href` is left for destinations that really are on the web. (The host also turns off the
 * status bubble WebView2 draws for a hovered href, so that is no longer a reason on its own.)
 *
 * What the anchor gave up with it: the pointer cursor and a left-aligned box, both put back here.
 */
export interface RouteLinkProps extends Omit<ComponentPropsWithoutRef<"button">, "type"> {
  /** A route hash, the way the address bar holds it: "#/settings", `#/notes/${id}`. */
  to: string
}

export function RouteLink({ to, className, onClick, ...rest }: RouteLinkProps) {
  const press = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event)
    // A handler that took the press for itself (a row that opens a menu instead, say) keeps it.
    if (event.defaultPrevented) return
    navigateTo(to)
  }

  return (
    <button {...rest} type="button" onClick={press} className={cn("cursor-pointer text-left", className)} />
  )
}
