import { memo, useMemo } from "react"

import { anchorsFor, boxOf, isFilled, strokeToPathData } from "../canvas/edge-paths"
import { strokeFor } from "../canvas/edge-canvas"
import { dashAttribute, strokeStyleFor } from "../canvas/edge-style"
import { accentOf } from "../scene/branch"
import { estimateWidth, measurersFrom } from "../scene/measure"
import { projectScene } from "../scene/project"
import { boundsOf } from "../model/scene"
import type { MindmapDocument, StyleTemplate } from "../model/document"

const WIDTH = 232
const HEIGHT = 132
const MARGIN = 12

/**
 * A card that draws the map it stands for.
 *
 * Through the same projector the canvas uses, so a thumbnail cannot show a different branch colour or
 * a different edge style from the map it opens into. Text is measured by estimate rather than by
 * canvas: at this scale a label is a few pixels wide and the difference is invisible, while a real
 * measurement per node across a whole gallery is not.
 *
 * Nodes are drawn as blocks. At three pixels a line, type is a smudge, and the shape of a map is
 * carried by where its branches go.
 */
export const MindmapThumbnail = memo(function MindmapThumbnail({
  document,
  templates,
  defaultTemplateId,
}: {
  document: MindmapDocument
  templates: readonly StyleTemplate[]
  defaultTemplateId: string
}) {
  const view = useMemo(() => {
    const scene = projectScene(document, { templates, defaultTemplateId, measurers: measurersFrom(estimateWidth) })
    if (scene.elements.length === 0) {
      return null
    }
    const bounds = boundsOf(scene.elements)
    const width = Math.max(1, bounds.maxX - bounds.minX)
    const height = Math.max(1, bounds.maxY - bounds.minY)
    const scale = Math.min((WIDTH - MARGIN * 2) / width, (HEIGHT - MARGIN * 2) / height, 1)
    return {
      scene,
      transform: `translate(${WIDTH / 2 - ((bounds.minX + bounds.maxX) / 2) * scale}, ${
        HEIGHT / 2 - ((bounds.minY + bounds.maxY) / 2) * scale
      }) scale(${scale})`,
    }
  }, [document, templates, defaultTemplateId])

  if (!view) {
    return <div className="h-[132px] bg-canvas-sunken" />
  }

  const boxes = new Map(view.scene.elements.map((element) => [element.id, element]))

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="block h-[132px] w-full bg-canvas-sunken"
      aria-hidden
    >
      <g transform={view.transform}>
        {view.scene.edges.map((edge) => {
          const from = boxes.get(edge.fromId)
          const to = boxes.get(edge.toId)
          if (!from || !to) {
            return null
          }
          const stroke = strokeFor(edge, anchorsFor(boxOf(from), boxOf(to)))
          const style = strokeStyleFor(edge)
          const filled = isFilled(stroke)
          return (
            <path
              key={edge.id}
              d={strokeToPathData(stroke)}
              fill={filled ? style.color : "none"}
              stroke={filled ? "none" : style.color}
              strokeWidth={filled ? undefined : style.width}
              strokeDasharray={filled ? undefined : dashAttribute(style.dash)}
            />
          )
        })}

        {view.scene.elements.map((element) => (
          <rect
            key={element.id}
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            rx={element.isRoot ? 8 : element.nodeShape === "pill" ? element.height / 2 : 4}
            fill={element.nodeShape === "plain" ? "none" : element.fill}
            stroke={element.nodeShape === "plain" ? "none" : accentOf(element)}
            strokeWidth={1}
          />
        ))}
      </g>
    </svg>
  )
})
