import { createContext, useContext } from "react"

import type { DockEdge } from "./placement"

/** The edge the toolbar is docked to, for the floating bars that have to keep off it. */
export const DockedEdgeContext = createContext<DockEdge>("bottom")

export const useDockedEdge = (): DockEdge => useContext(DockedEdgeContext)
