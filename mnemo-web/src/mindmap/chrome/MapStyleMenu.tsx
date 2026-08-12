import { AppIcon } from "@/components/icon/AppIcon"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverGroupLabel,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import {
  LAYOUT_ALGORITHMS,
  type CanvasBackground,
  type LayoutAlgorithm,
  type StyleTemplate,
} from "../model/document"
import { branchColor } from "../scene/tokens"
import { BackgroundGlyph, BranchGlyph, LayoutGlyph } from "./glyphs"
import { BRANCH_MATERIALS, type BranchMaterial } from "./material"

const BACKGROUNDS: readonly { value: CanvasBackground; key: string }[] = [
  { value: "dots", key: "BackgroundDots" },
  { value: "grid", key: "BackgroundGrid" },
  { value: "plain", key: "BackgroundPlain" },
]

/** Layout names, in the order the algorithms are declared. */
const LAYOUT_KEY: Record<LayoutAlgorithm, string> = {
  balanced: "LayoutBalanced",
  treeRight: "LayoutTreeRight",
  treeDown: "LayoutTreeDown",
  radial: "LayoutRadial",
  timeline: "LayoutTimeline",
  free: "LayoutFree",
}

/** The four hues a template's ramp starts with, which is enough to tell two palettes apart. */
const PREVIEW_HUES = [0, 1, 2, 3]

export interface MapStyleMenuProps {
  /** The arrangement every cluster agrees on, or null when they disagree or none was chosen. */
  algorithm: LayoutAlgorithm | null
  onAlgorithm: (algorithm: LayoutAlgorithm) => void
  /** Lay the map out again under the arrangement it already has. */
  onArrange: () => void
  /** False for a map with nothing in it to arrange. */
  canArrange: boolean
  material: BranchMaterial
  onMaterial: (material: BranchMaterial) => void
  templates: readonly StyleTemplate[]
  templateId: string | null
  onTemplate: (id: string) => void
  /** Which templates ship in the build. Everything else is the user's, and can be thrown away. */
  builtInIds: readonly string[]
  onDeleteTemplate: (template: StyleTemplate) => void
  background: CanvasBackground
  onBackground: (background: CanvasBackground) => void
}

/**
 * One control for everything about how the map looks.
 *
 * One rather than several, because the alternative is what the desktop has: an arrangement row in
 * the header and a Layout section in an inspector, free to disagree about which arrangement is on.
 * Everything here is a document-wide or per-cluster property, which is exactly what does not belong
 * on a bar that only appears when something is selected.
 *
 * Every choice is an ordinary edit. Picking an arrangement lays the map out and remembers the
 * choice in the same step, so one undo puts back both. Laying out again is here too, under the
 * arrangement it uses, since a header button for it reads as a second control for the same thing.
 */
export function MapStyleMenu({
  algorithm,
  onAlgorithm,
  onArrange,
  canArrange,
  material,
  onMaterial,
  templates,
  templateId,
  onTemplate,
  builtInIds,
  onDeleteTemplate,
  background,
  onBackground,
}: MapStyleMenuProps) {
  const t = useT()

  // Free is the arrangement that keeps every node where it is, so arranging under it is a button
  // that provably does nothing rather than one that might.
  const idle = !canArrange || algorithm === "free"

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("Mindmap", "MapStyle")}
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-ink transition-colors hover:bg-frame-hover"
        >
          <span className="text-ink-2">
            {algorithm ? <LayoutGlyph algorithm={algorithm} /> : <AppIcon name="common/sitemap" size={15} />}
          </span>
          {algorithm ? t("Mindmap", LAYOUT_KEY[algorithm]) : t("Mindmap", "MapStyle")}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[262px]">
        <PopoverGroupLabel>{t("Mindmap", "GroupArrangement")}</PopoverGroupLabel>
        <div className="grid grid-cols-3 gap-1 px-1">
          {LAYOUT_ALGORITHMS.map((value) => (
            <Tile
              key={value}
              label={t("Mindmap", LAYOUT_KEY[value])}
              active={algorithm === value}
              onClick={() => onAlgorithm(value)}
            >
              <LayoutGlyph algorithm={value} />
            </Tile>
          ))}
        </div>

        {/* Laying out again lives with the arrangement rather than in the header, where a button
            named Layout sat beside a control already reading Tree (vertical) and the two looked
            like two names for one thing. Picking an arrangement already arranges; this is for the
            map that has been added to since. */}
        <div className="px-1 pt-1">
          <PopoverClose asChild>
            <button
              type="button"
              // Called with no arguments on purpose: the handler is passed the click, and an arrange
              // reads its first argument as the arrangement to use.
              onClick={() => onArrange()}
              disabled={idle}
              title={t("Mindmap", "LayoutTooltip")}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13px] text-ink-2 transition-colors hover:bg-frame-hover hover:text-ink",
                idle && "pointer-events-none opacity-35",
              )}
            >
              <AppIcon name="common/sitemap" size={15} />
              {t("Mindmap", "ArrangeNow")}
            </button>
          </PopoverClose>
        </div>

        {/* Its own control rather than a side effect of the palette. Burying "how are the lines
            drawn" inside a colour preset is what made the prototype's edge system feel missing. */}
        <PopoverGroupLabel>{t("Mindmap", "GroupBranches")}</PopoverGroupLabel>
        <div className="grid grid-cols-3 gap-1 px-1">
          {BRANCH_MATERIALS.map((entry) => (
            <Tile
              key={entry.value}
              label={t("Mindmap", entry.key)}
              active={material === entry.value}
              onClick={() => onMaterial(entry.value)}
            >
              <BranchGlyph material={entry.value} />
            </Tile>
          ))}
        </div>

        <PopoverGroupLabel>{t("Mindmap", "GroupPalette")}</PopoverGroupLabel>
        <div className="px-1">
          {templates.map((template) => {
            // A built-in lives in the build, not the store, so there is nothing about it to throw
            // away. Which is which is told by the server rather than read off the id, so an
            // imported template is not mistaken for a shipped one by the shape of its name.
            const mine = !builtInIds.includes(template.id)
            return (
              <div key={template.id} className="group relative flex items-center">
                <button
                  type="button"
                  onClick={() => onTemplate(template.id)}
                  className={cn(
                    "flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors",
                    mine && "pr-8",
                    template.id === templateId
                      ? "bg-frame-active text-ink"
                      : "text-ink-2 hover:bg-frame-hover hover:text-ink",
                  )}
                >
                  {/* The hues are the theme's, the same eight for every template, so the dots say
                      whether a template colours its branches at all rather than which colours it uses.
                      A template that does not is drawn in one neutral, which is what it looks like. */}
                  <span className="flex shrink-0 gap-[3px]">
                    {PREVIEW_HUES.map((hue) => (
                      <span
                        key={hue}
                        className="size-[9px] rounded-full"
                        style={{
                          background:
                            template.branchColors === "byBranch" ? branchColor(hue) : "var(--line)",
                        }}
                      />
                    ))}
                  </span>
                  <span className="truncate">{template.name}</span>
                </button>
                {mine ? (
                  <button
                    type="button"
                    title={t("Mindmap", "DeleteTemplate")}
                    aria-label={t("Mindmap", "DeleteTemplate")}
                    onClick={() => onDeleteTemplate(template)}
                    className="absolute right-1 grid size-6 place-items-center rounded-md text-ink-3 opacity-0 transition-opacity hover:bg-frame-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <AppIcon name="common/trash" size={13} />
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>

        <PopoverGroupLabel>{t("Mindmap", "GroupBackground")}</PopoverGroupLabel>
        <div className="grid grid-cols-3 gap-1 px-1 pb-1">
          {BACKGROUNDS.map((entry) => (
            <Tile
              key={entry.value}
              label={t("Mindmap", entry.key)}
              active={background === entry.value}
              onClick={() => onBackground(entry.value)}
            >
              <BackgroundGlyph background={entry.value} />
            </Tile>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** A preview over its own name. Every choice in this panel is a picture of what it does. */
function Tile({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg py-1.5 transition-colors",
        active ? "bg-frame-active text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
      )}
    >
      {children}
      <span className="max-w-full truncate px-1 text-[10.5px]">{label}</span>
    </button>
  )
}
