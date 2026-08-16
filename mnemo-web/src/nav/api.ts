import { apiFetch } from "@/api/client"

import type { NavCategoryModel } from "./types"

export function fetchNav(): Promise<NavCategoryModel[]> {
  return apiFetch<NavCategoryModel[]>("/nav")
}
