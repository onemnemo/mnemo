import { useT } from "@/i18n/useT"

import type { ArrowCap, EdgeRouting, LineStyle } from "../model/document"
import { LINES, ROUTES } from "./choices"
import { FlyoutPanel } from "./FlyoutPanel"
import { LineGlyph, RouteGlyph } from "./glyphs"
import { CapRow, Cell, Group } from "./menu"

/**
 * What the connect tool draws with.
 *
 * Its own type rather than a slice of `EdgeStyle`, whose members are all nullable: null there means
 * "inherit from the cascade", and a tool default has nothing above it to inherit from.
 */
export interface ConnectStyle {
  line: LineStyle
  routing: EdgeRouting
  startCap: ArrowCap
  endCap: ArrowCap
}

export interface ConnectFlyoutProps {
  style: ConnectStyle
  onStyle: (patch: Partial<ConnectStyle>) => void
  onClose: () => void
}

/**
 * What the connect tool draws with, set before drawing rather than corrected after.
 *
 * The same panel the edge bar opens, which is the point: an edge armed here and an edge restyled
 * after the fact are offered the same values, in the same order, drawn the same way.
 */
export function ConnectFlyout({ style, onStyle, onClose }: ConnectFlyoutProps) {
  const t = useT()

  return (
    <FlyoutPanel onClose={onClose} className="w-[232px]">
      <Group label={t("Mindmap", "EdgeLine")}>
        {LINES.map((entry) => (
          <Cell
            key={entry.value}
            label={t("Mindmap", entry.key)}
            active={style.line === entry.value}
            onClick={() => onStyle({ line: entry.value })}
          >
            <LineGlyph line={entry.value} />
          </Cell>
        ))}
      </Group>

      <Group label={t("Mindmap", "Routing")}>
        {ROUTES.map((entry) => (
          <Cell
            key={entry.value}
            label={t("Mindmap", entry.key)}
            active={style.routing === entry.value}
            onClick={() => onStyle({ routing: entry.value })}
          >
            <RouteGlyph routing={entry.value} />
          </Cell>
        ))}
      </Group>

      <Group label={t("Mindmap", "Ends")}>
        <div className="flex w-full flex-col gap-1">
          <CapRow
            label={t("Mindmap", "CapStart")}
            end="start"
            value={style.startCap}
            onPick={(cap) => onStyle({ startCap: cap })}
          />
          <CapRow
            label={t("Mindmap", "CapEnd")}
            end="end"
            value={style.endCap}
            onPick={(cap) => onStyle({ endCap: cap })}
          />
        </div>
      </Group>
    </FlyoutPanel>
  )
}
