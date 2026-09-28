import { useCallback, useMemo } from "react"

import { useSettingsStore, useSettingValue } from "@/settings/store"

import type { NodeShape } from "../../model/document"
import { encodeConnector, parseConnector, type ConnectorPick } from "./connector"
import { parseEdge, type DockEdge } from "./placement"

const NODE_STYLES: readonly NodeShape[] = ["card", "pill", "outline", "plain"]

export interface ToolPresets {
  readonly edge: DockEdge
  readonly setEdge: (edge: DockEdge) => void
  /** Null leaves new nodes to the map's template. */
  readonly nodeStyle: NodeShape | null
  readonly setNodeStyle: (style: NodeShape | null) => void
  readonly connector: ConnectorPick
  readonly setConnector: (pick: ConnectorPick) => void
}

/** The toolbar's choices, kept per person rather than per map, as app settings. */
export function useToolPresets(): ToolPresets {
  const storedEdge = useSettingValue("Mindmap.ToolbarEdge", "bottom")
  const storedStyle = useSettingValue("Mindmap.ToolNodeStyle", "")
  const storedConnector = useSettingValue("Mindmap.ToolConnector", "")

  const write = useCallback((key: string, value: string) => {
    void useSettingsStore.getState().setValue(key, value)
  }, [])

  const connector = useMemo(() => parseConnector(storedConnector), [storedConnector])

  return {
    edge: parseEdge(storedEdge),
    setEdge: useCallback((edge: DockEdge) => write("Mindmap.ToolbarEdge", edge), [write]),
    nodeStyle: NODE_STYLES.find((style) => style === storedStyle) ?? null,
    setNodeStyle: useCallback((style: NodeShape | null) => write("Mindmap.ToolNodeStyle", style ?? ""), [write]),
    connector,
    setConnector: useCallback((pick: ConnectorPick) => write("Mindmap.ToolConnector", encodeConnector(pick)), [write]),
  }
}
