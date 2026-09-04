// The settings tree, declared as data rather than built imperatively.
//
// The desktop constructs the same tree in ~640 lines of view-model wiring
// (SettingsViewModel.RebuildCategories). Declaring it instead means one generic
// renderer walks the schema, and cross-category search reduces to filtering it, 
// no second traversal that can drift out of step with what is rendered.
//
// Storage semantics are the desktop's, not new ones: toggles persist a JSON
// boolean, every other value-bound row persists a string, and both apps read the
// same database during the port.

/** Which nav section a category is listed under. */
export type SettingsSection = "you" | "app" | "modules" | "advanced"

/**
 * Runtime facts the schema branches on, a few rows exist only in certain states,
 * and the desktop rebuilds its whole tree when these change.
 */
export interface SettingsSchemaContext {
  /** The 7-tap gate has been unlocked, revealing the Developer-mode switch. */
  developerGateUnlocked: boolean
  /** Developer mode is on, revealing the Developer category. */
  developerMode: boolean
}

/** A row's label: an i18n key in the Settings namespace, or a literal for rows the desktop never translated. */
export interface Labelled {
  /** Key in the Settings i18n namespace. */
  title?: string
  /** Literal title, winning over {@link title}. Used by the untranslated Developer rows. */
  titleText?: string
  /** Key in the Settings i18n namespace. */
  description?: string
  /** Literal description, winning over {@link description}. */
  descriptionText?: string
}

/** One choice in a dropdown or step slider. */
export interface SettingOption {
  /**
   * The persisted value. Omitted when the group sets `localizedValues`, in which
   * case the resolved label is itself what gets stored.
   */
  value?: string
  /** Key in the Settings i18n namespace. */
  label?: string
  /** Literal label, winning over {@link label}. Defaults to {@link value}. */
  labelText?: string
}

interface RowBase extends Labelled {
  /**
   * Stable id for search results and scroll targets. Defaults to the storage key;
   * required for rows that have none.
   */
  id?: string
}

interface ValueRowBase extends RowBase {
  /** The storage key, identical to the one the desktop reads and writes. */
  key: string
}

/** A boolean switch. Persists a real JSON boolean. */
export interface ToggleRow extends ValueRowBase {
  kind: "toggle"
  defaultValue: boolean
}

/** A single-select list. Persists the chosen option's string value. */
export interface DropdownRow extends ValueRowBase {
  kind: "dropdown"
  options: SettingOption[]
  defaultValue: string
  /**
   * The desktop persists the *translated* option label for these rows, so the stored
   * value changes meaning with the UI language. Preserved rather than corrected: the
   * Avalonia app reads the same database during the port, and normalizing to stable
   * ids here would make previously saved values unreadable there.
   */
  localizedValues?: boolean
  /** Renders inert, mirroring a desktop row that is visible but not yet selectable. */
  disabled?: boolean
}

/** A free-text field. `secret` fields are write-only: the API never returns the value. */
export interface TextRow extends ValueRowBase {
  kind: "text"
  defaultValue: string
  secret?: boolean
  placeholder?: string
}

/** A discrete slider over named steps. Persists like a dropdown. */
export interface StepSliderRow extends ValueRowBase {
  kind: "slider"
  options: SettingOption[]
  defaultValue: string
  localizedValues?: boolean
}

/** A section label between rows. Not searchable, not value-bound. */
export interface SubheaderRow extends RowBase {
  kind: "subheader"
  id: string
}

/** Read-only explanatory text. */
export interface NoticeRow extends RowBase {
  kind: "notice"
  id: string
}

/** Everything an action row can do in the app instead of opening a link. */
export type ActionRowAction = "open-log-folder" | "open-data-folder"

/** A button row. What it does comes from {@link ActionRow.href} or {@link ActionRow.action}. */
export interface ActionRow extends RowBase {
  kind: "action"
  id: string
  /** Key in the Settings i18n namespace for the button label. */
  buttonLabel?: string
  buttonLabelText?: string
  destructive?: boolean
  /**
   * An absolute URL to hand to the system browser. A row with one is a link and is
   * always live; a row with neither this nor {@link action} has nothing behind it and
   * renders disabled, which is the honest reading of a button that does nothing.
   */
  href?: string
  /**
   * Runs in the app rather than opening a link, dispatched by name in the renderer.
   * A row carries this or {@link href}, never both.
   */
  action?: ActionRowAction
}

/**
 * A row with bespoke rendering (galleries, model pickers, the language switch).
 * The renderer dispatches on {@link CustomRow.id}; the schema keeps its position,
 * labels and searchability alongside every other row.
 */
export interface CustomRow extends RowBase {
  kind: "custom"
  id: CustomRowId
}

/** Every bespoke row the renderer knows how to build. */
export type CustomRowId =
  | "language"
  | "theme-gallery"
  | "reduce-motion"
  | "app-icon-gallery"
  | "profile-picture-gallery"
  | "assistant-model"
  | "utility-model"
  | "test-connection"
  | "clear-chat-history"
  | "check-for-updates"
  | "release-channel"
  | "about-identity"

export type SettingsRow =
  | ToggleRow
  | DropdownRow
  | TextRow
  | StepSliderRow
  | SubheaderRow
  | NoticeRow
  | ActionRow
  | CustomRow

/** A row that carries a value the user can change, and is therefore searchable and persisted. */
export type ValueRow = ToggleRow | DropdownRow | TextRow | StepSliderRow

/**
 * A run of rows under an optional heading. When `master` is set the group collapses
 * to a single switch plus a notice while that switch is off, matching the AI category.
 */
export interface SettingsGroup {
  id: string
  /** Key in the Settings i18n namespace. Empty for the AI category's single unnamed group. */
  title?: string
  /** The toggle gating this group's rows. */
  master?: ToggleRow
  /** Key in the Settings i18n namespace for the body shown while the master is off. */
  offNotice?: string
  /**
   * Turning the master on asks first (turning it off never does). Values are keys in
   * the Settings i18n namespace.
   */
  confirmEnable?: { title: string; message: string; confirm: string }
  rows: SettingsRow[]
}

/**
 * A category whose body is one bespoke surface rather than a list of rows.
 *
 * Almost every page in settings is label/control pairs, and the schema describes those
 * completely. Keyboard is not one of those: it is a searchable catalogue of actions with
 * a recorder in each row, and squeezing it into the row vocabulary would mean inventing
 * row kinds that only ever have one instance. Trash is the same shape of exception: a live
 * list of content with two verbs on every row, and nothing about it is a setting.
 */
export type SettingsPageId = "keyboard" | "proofing" | "trash"

/** One page in the settings nav. */
export interface SettingsCategory {
  id: string
  /** Key in the Settings i18n namespace. */
  title: string
  /** AppIcon name for the rail. Every category has one: a list where some rows have a mark and
      others do not reads as an oversight rather than as a distinction. */
  icon: string
  /** Key in the Settings i18n namespace. */
  subtitle?: string
  /**
   * Extra literal search terms for the page itself. People look for the setting, not the
   * page it lives on, so these are the words someone would type when the page's own name
   * is not one they would think of.
   */
  keywords?: string[]
  section: SettingsSection
  groups: SettingsGroup[]
  /** Renders this component instead of {@link groups}, which are then empty. */
  page?: SettingsPageId
  /** Omitted from the nav when this returns false. */
  visible?: (context: SettingsSchemaContext) => boolean
}

// --- Wire contracts ---------------------------------------------------------
// Mirrors Mnemo.Host/Contracts/SettingsValuesDto.cs and ThemeDto.cs; the C# side
// is authoritative.

/** The stored value of a settings key: a boolean or a string, matching its registered kind. */
export type SettingValue = boolean | string

/**
 * A snapshot of the settings the SPA renders. Keys with nothing stored are absent,
 * so the schema's own default applies. Secrets never appear in `values`, `secrets`
 * reports only whether each one currently has a value.
 */
export interface SettingsValues {
  values: Record<string, SettingValue>
  secrets: Record<string, boolean>
}

/** Build identity, shown by the updates row and the onboarding footer. */
export interface AppInfo {
  version: string
}
