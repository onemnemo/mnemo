import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import type { ElementStyle } from "../model/document"
import type { SceneElement } from "../model/scene"
import { nodeKindOf, type NodeKind } from "../scene/content"
import { fontScaleOf } from "../scene/measure"
import { BRANCH_COUNT, branchColor, branchSlot, branchToken } from "../scene/tokens"
import { FloatBar, Sep, Slot } from "./bits"
import { SCALES, SHAPES } from "./choices"
import { FlyoutPanel } from "./FlyoutPanel"
import { NodeShapeGlyph, ScaleGlyph, SwatchGlyph } from "./glyphs"
import { KindMenu } from "./KindMenu"
import { Cell, Group, MenuItem, MenuSep, MenuToggle, Popped } from "./menu"

/** What the colour control can do, or null when this selection has no colour to set. */
export interface ColorControl {
  /** The palette slot showing now, 1 to 8, or null when the colour is not one of the eight. */
  slot: number | null
  /** The colour drawn now, whatever it is, so the face can show a hue off the palette. */
  color: string | undefined
  /** Whether there is anything under the selected node for a subtree option to reach. */
  hasSubtree: boolean
  /** Whether the reset hands the node back to a branch or to the plain default. */
  branching: boolean
  /** A null token takes the colour away rather than setting one. */
  onPick: (token: string | null, subtree: boolean) => void
}

/** Everything the overflow menu offers, so the bar itself keeps one width as the list grows. */
export interface NodeActions {
  /** Hold everything selected where it is, or hand it all back to the layout. */
  onPin: (pinned: boolean) => void
  /** Fold this node's children out of sight, or null when there is nothing under it. */
  collapse: { collapsed: boolean; onToggle: () => void } | null
  /** Save this branch's styling as a template, or null when the selection is not one branch. */
  onSaveTemplate: (() => void) | null
  /** Move the node out from under its parent, or null when it has no grandparent to land under. */
  onOutdent: (() => void) | null
  onDuplicate: () => void
  onDelete: () => void
  /**
   * How many elements a delete actually removes, selection plus every descendant it takes with it.
   * Always at least the selection's own size; larger the moment a selected node has children,
   * collapsed ones included since a delete reaches those too.
   */
  deleteCount: number
}

export interface NodeBarProps {
  /** The node the controls read their current values from. */
  element: SceneElement
  /** How many nodes a press will land on. */
  count: number
  onStyle: (patch: ElementStyle) => void
  color: ColorControl | null
  /** Turn this node into another kind, or null when the selection is not a single node. */
  onKind: ((kind: NodeKind) => void) | null
  actions: NodeActions
}

/**
 * What a selected node can be.
 *
 * One slot per family rather than one per value. Laid out flat this was four shapes, four sizes, a
 * swatch, a template button and a pin, and the row was wider than most of the maps it floats over
 * while still reading as a heap: nothing on it said which buttons belonged together. Grouped, the
 * bar says what a node has, each slot shows what this node is now, and the values are one press
 * behind the one that holds them.
 *
 * The overflow menu is what keeps that true. Everything a node can be told to do goes in it, so the
 * bar stays the same width however long that list gets.
 *
 * Fill, text colour and a leading icon are all real fields on an element and none of them are here.
 * Fill does nothing to a plain or outline node and is usually overridden by the wash on a pill, text
 * colour has no precedent to copy anywhere in the app, and an icon needs a picker that does not
 * exist yet. Each is a deliberate omission rather than an oversight.
 */
export function NodeBar({ element, count, onStyle, color, onKind, actions }: NodeBarProps) {
  const t = useT()
  const [open, setOpen] = useState<"color" | "shape" | "size" | "more" | null>(null)
  const [subtree, setSubtree] = useState(false)
  const scale = fontScaleOf(element.text.fontSize)
  const shown = (which: typeof open) => (on: boolean) => setOpen(on ? which : null)

  return (
    <FloatBar>
      {/* First, because what a node is comes before how it looks, and because three of the kinds go
          on to ask a question of their own. */}
      {onKind ? (
        <>
          <KindMenu kind={nodeKindOf(element.content)} onPick={onKind} />
          <Sep />
        </>
      ) : null}

      {color ? (
        <Popped
          label={t("Mindmap", "Color")}
          face={<SwatchGlyph color={color.color ?? "var(--line)"} active={false} />}
          open={open === "color"}
          onOpen={shown("color")}
          width="w-[188px]"
        >
          <Group label={t("Mindmap", "Color")}>
            <div className="grid w-full grid-cols-4 gap-1">
              {Array.from({ length: BRANCH_COUNT }, (_, index) => (
                <Cell
                  key={index}
                  label={`${t("Mindmap", "Color")} ${index + 1}`}
                  active={branchSlot(index) === color.slot}
                  onClick={() => {
                    color.onPick(branchToken(index), subtree && color.hasSubtree)
                    setOpen(null)
                  }}
                >
                  <SwatchGlyph color={branchColor(index)} active={branchSlot(index) === color.slot} />
                </Cell>
              ))}
            </div>
          </Group>

          {/* Off by default, and only offered when there is something under the node to reach. A
              colour used to always be written down the whole branch, which meant recolouring one
              node repainted its parent and every cousin it had. */}
          <MenuToggle
            label={t("Mindmap", "ApplyToSubtree")}
            on={subtree && color.hasSubtree}
            disabled={!color.hasSubtree}
            onToggle={setSubtree}
          />

          {/* The way back out. A node with no colour of its own takes its branch's, which is what
              makes a coloured map read as branches rather than as a hundred separate boxes, and
              there has to be one press that gives that back. */}
          <button
            type="button"
            onClick={() => {
              color.onPick(null, subtree && color.hasSubtree)
              setOpen(null)
            }}
            className="block w-full rounded-lg px-2 py-1.5 text-left text-[11.5px] text-ink-2 hover:bg-frame-hover hover:text-ink"
          >
            {t("Mindmap", color.branching ? "MatchBranch" : "DefaultColor")}
          </button>
        </Popped>
      ) : null}

      <Popped
        label={t("Mindmap", "Shape")}
        face={<NodeShapeGlyph shape={element.nodeShape} />}
        open={open === "shape"}
        onOpen={shown("shape")}
        width="w-[168px]"
      >
        <Group label={t("Mindmap", "Shape")}>
          {SHAPES.map((entry) => (
            <Cell
              key={entry.value}
              label={t("Mindmap", entry.key)}
              active={element.nodeShape === entry.value}
              onClick={() => {
                onStyle({ nodeShape: entry.value })
                setOpen(null)
              }}
            >
              <NodeShapeGlyph shape={entry.value} />
            </Cell>
          ))}
        </Group>
      </Popped>

      <Popped
        label={t("Mindmap", "Size")}
        face={<ScaleGlyph scale={scale} />}
        open={open === "size"}
        onOpen={shown("size")}
        width="w-[148px]"
      >
        <Group label={t("Mindmap", "Size")}>
          {SCALES.map((entry) => (
            <Cell
              key={entry.value}
              label={t("Mindmap", entry.key)}
              active={scale === entry.value}
              onClick={() => {
                onStyle({ fontScale: entry.value })
                setOpen(null)
              }}
            >
              <ScaleGlyph scale={entry.value} />
            </Cell>
          ))}
        </Group>
      </Popped>

      <Sep />

      {/* Relative, because the panel positions against the nearest positioned ancestor and the
          control that owns it is the one that has to be it. */}
      <span className="relative flex">
        <Slot
          label={t("Mindmap", "More")}
          active={open === "more"}
          onClick={() => setOpen(open === "more" ? null : "more")}
        >
          <AppIcon name="ellipsis" size={15} />
        </Slot>
        {open === "more" ? (
          <FlyoutMore actions={actions} pinned={element.pinned === true} onDone={() => setOpen(null)} />
        ) : null}
      </span>

      {count > 1 ? (
        <>
          <Sep />
          <span className="px-1 text-[11.5px] tabular-nums text-ink-3">{count}</span>
        </>
      ) : null}
    </FloatBar>
  )
}

/**
 * Everything a node can be told to do.
 *
 * A menu rather than more buttons on the bar, because none of these is a style: they act once and
 * are done, and a row of them next to the controls that set how a node looks reads as if pin were a
 * kind of shape. Delete is last and behind a rule, since it is the only one here that another press
 * on the bar cannot walk back.
 */
function FlyoutMore({
  actions,
  pinned,
  onDone,
}: {
  actions: NodeActions
  pinned: boolean
  onDone: () => void
}) {
  const t = useT()
  const { collapse, onSaveTemplate } = actions
  const run = (act: () => void) => () => {
    onDone()
    act()
  }

  return (
    <FlyoutPanel onClose={onDone} className="w-[186px]">
      <MenuItem
        label={t("Mindmap", pinned ? "Unpin" : "Pin")}
        icon="common/pin"
        onClick={run(() => actions.onPin(!pinned))}
      />
      {collapse ? (
        <MenuItem
          label={t("Mindmap", collapse.collapsed ? "ExpandBranch" : "CollapseBranch")}
          icon={collapse.collapsed ? "chevron-down" : "chevron-up"}
          onClick={run(collapse.onToggle)}
        />
      ) : null}
      {/* Here rather than in the map's style panel, because what gets captured is this branch and
          the bar is the only thing on screen that knows which branch that is. The panel lists the
          templates; this is where one comes from. */}
      {onSaveTemplate ? (
        <MenuItem label={t("Mindmap", "SaveAsTemplate")} icon="palette" onClick={run(onSaveTemplate)} />
      ) : null}
      {actions.onOutdent ? (
        <MenuItem label={t("Mindmap", "Outdent")} icon="chevron-left" onClick={run(actions.onOutdent)} />
      ) : null}
      <MenuItem label={t("Mindmap", "Duplicate")} icon="copy" onClick={run(actions.onDuplicate)} />
      <MenuSep />
      <MenuItem
        label={
          actions.deleteCount > 1
            ? `${t("Mindmap", "Delete")} (${actions.deleteCount})`
            : t("Mindmap", "Delete")
        }
        icon="common/trash"
        danger
        onClick={run(actions.onDelete)}
      />
    </FlyoutPanel>
  )
}
