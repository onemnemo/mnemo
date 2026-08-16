import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The theme names its type scale ("text-body-extra-small") rather than using
// t-shirt sizes. tailwind-merge cannot tell those from colours - both are `text-*`
// - so left unconfigured it treats them as colours and drops the size whenever a
// class list carries both, e.g. cn("text-caption", "text-text-primary") silently
// renders at the inherited size. Declaring them here keeps the two groups apart.
const FONT_SIZES = [
  "heading-1",
  "heading-2",
  "heading-3",
  "heading-4",
  "heading-5",
  "heading-6",
  "body-large",
  "body-medium",
  "body-small",
  "body-extra-small",
  "stat-hero",
  "caption",
  "body-caption",
  "caption-button",
  "tooltip",
  "micro",
]

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: FONT_SIZES }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
