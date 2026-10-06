import { act } from "react"

/** Settles a rendered `<img>` as decoded at the given size, the way the browser would. */
export function loadImages(root: ParentNode, size = { w: 1000, h: 680 }): void {
  act(() => {
    for (const image of root.querySelectorAll("img")) {
      Object.defineProperty(image, "naturalWidth", { configurable: true, value: size.w })
      Object.defineProperty(image, "naturalHeight", { configurable: true, value: size.h })
      image.dispatchEvent(new Event("load"))
    }
  })
}

/** Fails a rendered `<img>` the way a corrupt or missing file does. */
export function failImages(root: ParentNode): void {
  act(() => {
    for (const image of root.querySelectorAll("img")) image.dispatchEvent(new Event("error"))
  })
}
