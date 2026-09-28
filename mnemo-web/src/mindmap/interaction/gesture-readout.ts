/**
 * What a resize or rotate shows while it runs: a chip with the live size or angle, and the grip
 * that is held. Written to the DOM rather than rendered, like the marquee, because it changes on
 * every pointer move and a render per frame would redraw the canvas to change one string.
 */

/** Below the element's bottom edge, in screen pixels. */
const SIZE_CHIP_GAP = 12
/** Right of and above the pointer, in screen pixels, so the hand does not cover it. */
const ANGLE_CHIP_OFFSET = { x: 22, y: -34 }

export function openChip(pane: HTMLElement): HTMLElement {
  const chip = document.createElement("div")
  chip.dataset.mmChip = ""
  chip.style.cssText = [
    "position:absolute",
    "left:0",
    "top:0",
    "z-index:30",
    "height:22px",
    "padding:0 7px",
    "border-radius:6px",
    "background:var(--solid)",
    "color:var(--solid-fg)",
    "font-size:11.5px",
    "font-weight:500",
    "line-height:22px",
    "font-variant-numeric:tabular-nums",
    "white-space:nowrap",
    "pointer-events:none",
  ].join(";")
  pane.appendChild(chip)
  return chip
}

/** Centred under the element as drawn, which for a rotated shape is its turned bounds. */
export function placeSizeChip(chip: HTMLElement, pane: HTMLElement, host: HTMLElement | null, width: number, height: number): void {
  chip.textContent = `${Math.round(width)} × ${Math.round(height)}`
  const drawn = host?.querySelector<HTMLElement>("[data-mm-rotor]") ?? host
  if (!drawn) return
  const rect = drawn.getBoundingClientRect()
  place(chip, pane, rect.left + rect.width / 2, rect.bottom + SIZE_CHIP_GAP)
}

export function placeAngleChip(chip: HTMLElement, pane: HTMLElement, clientX: number, clientY: number, degrees: number): void {
  chip.textContent = `${wholeDegrees(degrees)}°`
  place(chip, pane, clientX + ANGLE_CHIP_OFFSET.x, clientY + ANGLE_CHIP_OFFSET.y)
}

/** Rounded the way the slider reports it, so 359.6 reads 0 rather than a 360 past the slider max. */
export function wholeDegrees(degrees: number): number {
  return Math.round(degrees) % 360
}

function place(chip: HTMLElement, pane: HTMLElement, clientX: number, clientY: number): void {
  const bounds = pane.getBoundingClientRect()
  chip.style.transform = `translate(${clientX - bounds.left}px, ${clientY - bounds.top}px) translate(-50%, 0)`
}

/** Marks the grip under the pointer as held, so it stays lit once the pointer slides off it. */
export function holdGrip(target: EventTarget | null): Element | null {
  const grip = (target as Element | null)?.closest?.("[data-mm-handle]") ?? null
  grip?.setAttribute("data-mm-active", "")
  return grip
}

export function releaseGrip(grip: Element | null): void {
  grip?.removeAttribute("data-mm-active")
}
