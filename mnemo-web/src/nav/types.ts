// The sidebar model served by GET /api/nav, built from the same module
// registrations the desktop app uses. Labels are translation keys the SPA
// localizes. Mirrors Mnemo.Host/Contracts/NavDto.

export interface NavItemModel {
  route: string
  labelKey: string
  /** i18n namespace for labelKey (usually "Sidebar"). */
  namespace: string
  icon: string
  order: number
  childRoutes: string[]
  /** False when a visibility requirement (e.g. the AI-assistant toggle) hides it. */
  visible: boolean
}

export interface NavCategoryModel {
  key: string
  /** i18n namespace for key (the category header label). */
  namespace: string
  order: number
  /** Footer categories render flat at the bottom, with no section header. */
  footer: boolean
  items: NavItemModel[]
}
