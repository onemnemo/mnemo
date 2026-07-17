import { create } from "zustand"

import type { NavCategoryModel, NavItemModel } from "./types"

interface NavState {
  categories: NavCategoryModel[]
  setCategories: (categories: NavCategoryModel[]) => void
}

export const useNavStore = create<NavState>((set) => ({
  categories: [],
  setCategories: (categories) => set({ categories }),
}))

export function useNavCategories(): NavCategoryModel[] {
  return useNavStore((s) => s.categories)
}

/** The nav item to highlight as active for a route key (following child routes). */
export function activeNavRoute(categories: NavCategoryModel[], routeKey: string): string {
  for (const category of categories) {
    for (const item of category.items) {
      if (item.route === routeKey) return item.route
      if (item.childRoutes.includes(routeKey)) return item.route
    }
  }
  return routeKey
}

/** The top-level nav item for a route key, or null if it is not one (e.g. a sub-page). */
export function navItemForRoute(categories: NavCategoryModel[], routeKey: string): NavItemModel | null {
  for (const category of categories) {
    for (const item of category.items) {
      if (item.route === routeKey) return item
    }
  }
  return null
}

/** Category header shows for non-footer categories other than the hub (order 0). */
export function categoryShowsHeader(category: NavCategoryModel): boolean {
  return !category.footer && category.order !== 0
}
