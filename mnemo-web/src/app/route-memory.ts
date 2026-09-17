import { rememberLastNoteId } from "@/notes/workspace/session"

/**
 * What a route remembers between visits, and how to make it forget.
 *
 * The notes workspace is the one route that remembers something of its own, the note that
 * was open, and it reopens it on arrival. After a render failure that memory puts the user
 * in front of the same throw on their next visit, and the crash reads as "Notes is broken"
 * rather than as one note. So the route boundary asks here to forget it, and only then: a
 * crash somewhere else is no reason to close the note. The remembered route itself belongs
 * to the crash screen, which clears it on its own recovery action.
 */
export function forgetRouteMemory(routeKey: string): void {
  if (routeKey === "notes") rememberLastNoteId(null)
}
