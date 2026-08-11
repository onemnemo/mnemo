import { memo } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { cn } from "@/lib/utils"

import { branchWash, mixColor } from "../scene/tokens"
import type { SceneElement } from "../model/scene"

/**
 * One element on the canvas.
 *
 * The shape ladder is a ladder of loudness, not a shape picker: no chrome, a tint, a card, an
 * outline. Diamonds and hexagons are flowchart vocabulary, and in a mindmap nobody can say what a
 * hexagon means. Which rung a node lands on is the cascade's answer, already resolved before this
 * component sees it, so there is no styling logic here beyond turning that answer into CSS.
 *
 * The host carries the class and data attribute the scene index looks for, and its transform is the
 * only thing that moves during a drag. React renders this once per scene; the camera and every
 * position after the first are written straight to the DOM, because a position that lives in a
 * component is a position that costs a render to change.
 */
export const MindmapNode = memo(function MindmapNode({ element }: { element: SceneElement }) {
  const { text, nodeShape, isRoot } = element
  const tinted = element.branchColor !== undefined
  const accentLine = element.branchColor ?? element.stroke

  return (
    <div
      className="mm-node absolute left-0 top-0 select-none will-change-transform"
      data-mm-id={element.id}
      style={{
        transform: `translate(${element.x}px, ${element.y}px)`,
        width: element.width,
        height: element.height,
      }}
    >
      <div
        className={cn(
          "flex h-full w-full items-center",
          isRoot && "justify-center rounded-[14px]",
          !isRoot && nodeShape === "pill" && "rounded-full",
          !isRoot && (nodeShape === "card" || nodeShape === "outline") && "rounded-[10px]",
        )}
        style={bodyStyle(element, tinted, accentLine)}
      >
        {element.icon ? (
          <AppIcon name={element.icon} size={13} strokeWidth={1.6} className="ml-2 shrink-0 text-ink-icon" />
        ) : null}

        {element.content.$type === "task" ? (
          <span
            className={cn(
              "ml-2 grid size-[13px] shrink-0 place-items-center rounded-[4px]",
              "shadow-[inset_0_0_0_1.5px_currentColor]",
            )}
            style={{ color: accentLine }}
          >
            {(element.content as { done?: boolean }).done ? (
              <AppIcon name="check" size={9} strokeWidth={2.5} />
            ) : null}
          </span>
        ) : null}

        <span
          className={cn("mm-label block w-full", isRoot && "text-center")}
          style={{
            fontSize: text.fontSize,
            fontWeight: text.fontWeight,
            lineHeight: `${text.lineHeight}px`,
            letterSpacing: text.letterSpacing,
            color: element.textColor,
            paddingLeft: element.padding.x,
            paddingRight: element.padding.x,
          }}
        >
          {text.lines.map((line, index) => (
            <span key={index} className="block">
              {line}
            </span>
          ))}
        </span>
      </div>

      {element.hiddenCount > 0 ? (
        <span
          className="absolute -right-1 top-1/2 -translate-y-1/2 translate-x-full rounded-full px-1.5 text-[10px] font-medium leading-[15px] text-canvas"
          style={{ background: accentLine }}
        >
          {element.hiddenCount}
        </span>
      ) : null}
    </div>
  )
})

/**
 * A plain node has no box at all: its rule is its whole chrome, and the branch that arrives lands on
 * that rule rather than on an invisible bounding box.
 */
function bodyStyle(
  element: SceneElement,
  tinted: boolean,
  accentLine: string | undefined,
): React.CSSProperties {
  if (element.isRoot) {
    return {
      background: element.fill,
      boxShadow: "0 1px 2px oklch(0 0 0 / 0.12), 0 4px 12px -4px oklch(0 0 0 / 0.18)",
    }
  }

  switch (element.nodeShape) {
    case "plain":
      return { borderBottom: `${element.underline ?? 2}px solid ${accentLine ?? "var(--line)"}` }
    case "pill":
      return {
        background: tinted ? branchWash(element.branch) : element.fill,
        boxShadow: accentLine ? `inset 0 0 0 1px ${mixColor(accentLine, 16)}` : undefined,
      }
    case "outline":
      return { boxShadow: `inset 0 0 0 1px ${accentLine ?? "var(--line)"}` }
    default:
      return {
        background: element.fill,
        boxShadow: accentLine
          ? `0 0 0 1px ${mixColor(accentLine, 32)}, 0 1px 2px oklch(0 0 0 / 0.05)`
          : "0 0 0 1px var(--line-soft), 0 1px 2px oklch(0 0 0 / 0.05)",
      }
  }
}
