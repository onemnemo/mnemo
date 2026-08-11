import { useState } from "react"

import { useT } from "@/i18n/useT"

import type { ElementStyle, FontScale, NodeShape } from "../model/document"
import type { SceneElement } from "../model/scene"
import { fontScaleOf } from "../scene/measure"
import { BRANCH_COUNT, branchColor, branchSlot } from "../scene/tokens"
import { FloatBar, Sep, Slot } from "./bits"
import { FlyoutPanel } from "./FlyoutPanel"
import { NodeShapeGlyph, ScaleGlyph, SwatchGlyph } from "./glyphs"

const SHAPES: readonly { value: NodeShape; key: string }[] = [
  { value: "card", key: "ShapeCard" },
  { value: "pill", key: "ShapePill" },
  { value: "outline", key: "ShapeOutline" },
  { value: "plain", key: "ShapePlain" },
]

const SCALES: readonly { value: FontScale; key: string }[] = [
  { value: "s", key: "SizeSmall" },
  { value: "m", key: "SizeMedium" },
  { value: "l", key: "SizeLarge" },
  { value: "xl", key: "SizeExtraLarge" },
]

/** What a branch swatch can do, or null when this selection has no branch to recolour. */
export interface BranchControl {
  /** The slot showing now, 1 to 8, or null when the node's colour is not one of the eight. */
  slot: number | null
  onPick: (index: number) => void
}

export interface NodeBarProps {
  /** The node the controls read their current values from. */
  element: SceneElement
  /** How many nodes a press will land on. */
  count: number
  onStyle: (patch: ElementStyle) => void
  branch: BranchControl | null
}

/**
 * What a selected node can be.
 *
 * Two flat groups and one popover, which is the split the values themselves ask for: four shapes and
 * four sizes lay out in full the way the edge bar's do, and eight hues do not, at least not without
 * making the bar wider than most of the maps it floats over.
 *
 * Fill, text colour and a leading icon are all real fields on an element and none of them are here.
 * Fill does nothing to a plain or outline node and is usually overridden by the branch wash on a
 * pill, text colour has no precedent to copy anywhere in the app, and an icon needs a picker that
 * does not exist yet. Each is a deliberate omission rather than an oversight.
 */
export function NodeBar({ element, count, onStyle, branch }: NodeBarProps) {
  const t = useT()
  const [swatches, setSwatches] = useState(false)
  const scale = fontScaleOf(element.text.fontSize)

  return (
    <FloatBar>
      {SHAPES.map((entry) => (
        <Slot
          key={entry.value}
          label={t("Mindmap", entry.key)}
          active={element.nodeShape === entry.value}
          onClick={() => onStyle({ nodeShape: entry.value })}
        >
          <NodeShapeGlyph shape={entry.value} />
        </Slot>
      ))}

      <Sep />

      {SCALES.map((entry) => (
        <Slot
          key={entry.value}
          label={t("Mindmap", entry.key)}
          active={scale === entry.value}
          onClick={() => onStyle({ fontScale: entry.value })}
        >
          <ScaleGlyph scale={entry.value} />
        </Slot>
      ))}

      {branch ? (
        <>
          <Sep />
          {/* Relative, because the panel positions against the nearest positioned ancestor and the
              control that owns it is the one that has to be it. */}
          <span className="relative flex">
            <Slot
              label={t("Mindmap", "BranchColor")}
              active={swatches}
              onClick={() => setSwatches((open) => !open)}
            >
              <SwatchGlyph
                color={branch.slot === null ? "var(--line)" : branchColor(branch.slot - 1)}
                active={false}
              />
            </Slot>
            {swatches ? (
              <FlyoutPanel onClose={() => setSwatches(false)}>
                <div className="flex gap-1.5 px-1 py-0.5">
                  {Array.from({ length: BRANCH_COUNT }, (_, index) => (
                    <button
                      key={index}
                      type="button"
                      title={t("Mindmap", "BranchColor")}
                      aria-label={t("Mindmap", "BranchColor")}
                      aria-pressed={branchSlot(index) === branch.slot}
                      onClick={() => {
                        branch.onPick(index)
                        setSwatches(false)
                      }}
                      className="grid size-6 place-items-center rounded-lg hover:bg-frame-hover"
                    >
                      <SwatchGlyph
                        color={branchColor(index)}
                        active={branchSlot(index) === branch.slot}
                      />
                    </button>
                  ))}
                </div>
              </FlyoutPanel>
            ) : null}
          </span>
        </>
      ) : null}

      {count > 1 ? (
        <>
          <Sep />
          <span className="px-1 text-[11.5px] tabular-nums text-ink-3">{count}</span>
        </>
      ) : null}
    </FloatBar>
  )
}
