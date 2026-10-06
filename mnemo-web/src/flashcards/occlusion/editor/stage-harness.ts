import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"

import type { OcclusionDocument } from "../../facts/occlusion"
import { loadImages } from "../image-test-helpers"
import { EditorStage } from "./EditorStage"
import { trio } from "./test-kit"
import { useOcclusionEditor, type OcclusionEditor } from "./useOcclusionEditor"

/** English for the stage's strings, so tests read real names. */
export const ENGLISH: Record<string, string> = {
  OcclusionStageLabel: "Image masks",
  OcclusionMask: "Mask {number}",
  OcclusionMaskDetail: "{name}, {detail}",
  OcclusionGroupOfOne: "group of {count}",
  OcclusionGroupOfMany: "group of {count}",
}

export function translate(_ns: string, key: string, params: Record<string, string | number> = {}): string {
  return (ENGLISH[key] ?? key).replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name]))
}

// The pane is 800 by 600 and the image 1000 by 500, so it fits as 800 by 400 with 100px above and below.
export const PANE = { w: 800, h: 600 }
export const IMAGE = { w: 1000, h: 500 }
export const FRAME = { x: 0, y: 100, w: 800, h: 400 }

let host: HTMLDivElement
let root: Root

export function setup(): void {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => PANE.w })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => PANE.h })
}

export function teardown(): void {
  act(() => root.unmount())
  host.remove()
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth")
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight")
}

export const container = () => host

function Harness({ initial, onEditor }: { initial: OcclusionDocument; onEditor: (editor: OcclusionEditor) => void }) {
  const editor = useOcclusionEditor(initial)
  onEditor(editor)
  return createElement(EditorStage, { editor, imageUrl: "blob:x", margin: 0 })
}

export function mountStage(onEditor: (editor: OcclusionEditor) => void, initial: OcclusionDocument = trio()): void {
  act(() => root.render(createElement(Harness, { initial, onEditor })))
  loadImages(host, IMAGE)
}

export const pane = () => host.querySelector<HTMLElement>('[data-testid="occlusion-editor-stage"]')!
export const option = (id: string) => host.querySelector<HTMLElement>(`[role="option"][data-mask="${id}"]`)!
export const badges = () => host.querySelectorAll('[data-testid="mask-badge"]')
export const handles = () => host.querySelectorAll("[data-handle]")

/** Client pixels of a point given as fractions of the image. */
export const at = (fx: number, fy: number): [number, number] => [FRAME.x + fx * FRAME.w, FRAME.y + fy * FRAME.h]

export function fire(target: Element, type: string, [x, y]: [number, number], init: MouseEventInit = {}): void {
  const buttons = type === "pointerup" || type === "pointermove" ? (init.buttons ?? 0) : 1
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, ...init }))
  })
}

/** Presses, drags through the given points and releases. */
export function drag(points: [number, number][], init: MouseEventInit = {}, target: Element = pane()): void {
  fire(target, "pointerdown", points[0], init)
  for (const point of points.slice(1)) fire(pane(), "pointermove", point, { ...init, buttons: 1 })
  fire(pane(), "pointerup", points.at(-1)!, { ...init, buttons: 0 })
}

export const click = (point: [number, number], init: MouseEventInit = {}) => drag([point], init)
