import type { ComponentPropsWithoutRef, MouseEvent } from "react"

import { navigateTo } from "@/app/router"
import { cn } from "@/lib/utils"

/**
 * A place in the app, drawn as a control rather than as a link.
 *
 * An anchor with an href puts its target in Chromium's status bubble, the strip of URL that appears
 * in the bottom corner on hover. That is right in a browser and wrong here: the shell is a window,
 * the routes behind it are an implementation detail, and the bubble is browser chrome that no page
 * can style or suppress. So everything that navigates inside the app is a button that sets the hash,
 * and `href` is left for destinations that really are on the web.
 *
 * What the anchor gave up with it: the pointer cursor and a left-aligned box, both put back here,
 * and opening in a new window, which a single-window app has nowhere to put.
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
