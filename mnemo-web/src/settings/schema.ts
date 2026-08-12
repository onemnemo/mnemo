import type { SettingsCategory, SettingsRow } from "./types"

// The settings tree. Mirrors SettingsViewModel.RebuildCategories: same categories in
// the same order, same storage keys, same defaults, same option lists.
//
// Keys named here must also be registered in Mnemo.Host/Settings/SettingsKeyRegistry,
// that allowlist is what makes them readable and writable over the API.

/** Where About's rows point. One constant, because three rows are paths under it. */
const REPOSITORY_URL = "https://github.com/onemnemo/mnemo"

/** Every category, in nav order. Filter with `visibleCategories` before rendering. */
export const SETTINGS_SCHEMA: SettingsCategory[] = [
  {
    id: "Profile",
    icon: "user",
    title: "Profile",
    subtitle: "ProfileSubtitle",
    section: "you",
    groups: [
      {
        id: "Identity",
        title: "Identity",
        rows: [
          {
            kind: "custom",
            id: "profile-picture-gallery",
            title: "ProfilePicture",
            description: "ProfilePictureDescription",
          },
          {
            kind: "text",
            key: "User.DisplayName",
            title: "DisplayName",
            description: "DisplayNameDescription",
            defaultValue: "John Doe",
          },
        ],
      },
    ],
  },

  {
    id: "General",
    icon: "settings-2",
    title: "General",
    subtitle: "GeneralSubtitle",
    section: "app",
    groups: [
      {
        id: "Startup",
        title: "Startup",
        rows: [
          {
            kind: "toggle",
            key: "App.LaunchAtStartup",
            title: "LaunchAtStartup",
            description: "LaunchAtStartupDescription",
            defaultValue: false,
          },
          {
            kind: "dropdown",
            key: "App.OpenTo",
            title: "OpenTo",
            description: "OpenToDescription",
            defaultValue: "last",
            options: [
              { value: "last", label: "OpenToLast" },
              { value: "overview", label: "OpenToOverview" },
              { value: "notes", label: "OpenToNotes" },
              { value: "flashcards", label: "OpenToFlashcards" },
              { value: "soma", label: "OpenToSoma" },
            ],
          },
        ],
      },
      {
        id: "LanguageAndRegion",
        title: "LanguageAndRegion",
        rows: [
          { kind: "custom", id: "language", title: "Language", description: "LanguageDescription" },
        ],
      },
      {
        id: "Experience",
        title: "Experience",
        rows: [
          {
            kind: "toggle",
            key: "App.EnableGamification",
            title: "EnableGamification",
            description: "EnableGamificationDescription",
            defaultValue: true,
          },
          // Untranslated in the desktop too; the literals are carried over verbatim.
          {
            kind: "toggle",
            key: "App.DeveloperMode",
            titleText: "Developer mode",
            descriptionText:
              "Shows a Developer section in Settings. Tap the Settings title seven times within two seconds to reveal this switch.",
            defaultValue: false,
          },
        ],
      },
    ],
  },

  {
    id: "Editor",
    icon: "notebook-text",
    title: "Editor",
    subtitle: "EditorSubtitle",
    section: "modules",
    groups: [
      {
        id: "WritingExperience",
        title: "WritingExperience",
        rows: [
          {
            kind: "toggle",
            key: "Editor.AutoSave",
            title: "AutoSave",
            description: "AutoSaveDescription",
            defaultValue: true,
          },
          {
            kind: "toggle",
            key: "Editor.SpellCheck",
            title: "SpellCheck",
            description: "SpellCheckDescription",
            defaultValue: true,
          },
          {
            kind: "dropdown",
            key: "Editor.SpellCheckLanguages",
            title: "SpellCheckLanguages",
            description: "SpellCheckLanguagesDescription",
            defaultValue: "en",
            options: [
              { value: "en", label: "SpellCheckLanguageEnglish" },
              { value: "de", label: "SpellCheckLanguageGerman" },
              { value: "es", label: "SpellCheckLanguageSpanish" },
              { value: "nb", label: "SpellCheckLanguageNorwegianBokmal" },
            ],
          },
          {
            kind: "slider",
            key: "Editor.Width",
            title: "EditorWidth",
            description: "EditorWidthDescription",
            localizedValues: true,
            defaultValue: "Wide",
            options: [
              { label: "SuperCompact" },
              { label: "Compact" },
              { label: "Wide" },
              { label: "SuperWide" },
            ],
          },
        ],
      },
      {
        id: "MarkdownRendering",
        title: "MarkdownRendering",
        rows: [
          {
            kind: "dropdown",
            key: "Markdown.BlockSpacing",
            title: "BlockSpacing",
            description: "BlockSpacingDescription",
            localizedValues: true,
            defaultValue: "Normal",
            options: [{ label: "Normal" }, { label: "Compact" }, { label: "Relaxed" }],
          },
          {
            kind: "dropdown",
            key: "Markdown.LineHeight",
            title: "LineSpacing",
            description: "LineSpacingDescription",
            defaultValue: "1.5",
            options: ["1.0", "1.2", "1.4", "1.45", "1.5", "1.6", "1.8", "2.0"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Markdown.LetterSpacing",
            title: "LetterSpacing",
            description: "LetterSpacingDescription",
            defaultValue: "0.3",
            options: ["0", "0.2", "0.3", "0.4", "0.5", "0.8", "1.0", "1.5"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Markdown.FontSize",
            title: "BaseFontSize",
            description: "BaseFontSizeDescription",
            defaultValue: "16px",
            options: ["12px", "13px", "14px", "15px", "16px", "17px", "18px"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Markdown.CodeFontSize",
            title: "CodeFontSize",
            description: "CodeFontSizeDescription",
            defaultValue: "16px",
            options: ["12px", "13px", "14px", "15px", "16px"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Markdown.MathFontSize",
            title: "MathFontSize",
            description: "MathFontSizeDescription",
            defaultValue: "16px",
            options: ["14px", "16px", "18px", "20px"].map((v) => ({ value: v })),
          },
          {
            kind: "toggle",
            key: "Markdown.RenderMath",
            title: "RenderLatexMath",
            description: "RenderLatexMathDescription",
            defaultValue: true,
          },
        ],
      },
    ],
  },

  {
    id: "AITools",
    icon: "orbit",
    title: "AITools",
    subtitle: "AIToolsSubtitle",
    section: "modules",
    groups: [
      {
        // One unnamed group: everything AI lives behind the master switch.
        id: "AI",
        offNotice: "AIOffNotice",
        confirmEnable: {
          title: "EnableAIAssistantWarningTitle",
          message: "EnableAIAssistantWarningMessage",
          confirm: "EnableAIAssistantWarningConfirm",
        },
        master: {
          kind: "toggle",
          key: "AI.EnableAssistant",
          title: "EnableAIAssistant",
          description: "EnableAIAssistantDescription",
          defaultValue: false,
        },
        rows: [
          { kind: "subheader", id: "sub-model-provider", title: "ModelProvider" },
          {
            kind: "dropdown",
            key: "AI.Provider.Mode",
            title: "ProviderMode",
            description: "ProviderModeDescription",
            defaultValue: "Cloud",
            // Visible but not selectable, mirroring the desktop: local models are not shipped yet.
            disabled: true,
            options: [
              { value: "Cloud", label: "ProviderModeCloud" },
              { value: "Local", label: "ProviderModeLocal" },
              { value: "Auto", label: "ProviderModeAuto" },
            ],
          },
          {
            kind: "text",
            key: "AI.OpenRouter.ApiKey",
            title: "OpenRouterApiKey",
            description: "OpenRouterApiKeyDescription",
            defaultValue: "",
            secret: true,
          },
          {
            kind: "custom",
            id: "test-connection",
            title: "TestConnection",
            description: "TestConnectionDescription",
          },
          {
            kind: "custom",
            id: "assistant-model",
            title: "AssistantModel",
            description: "AssistantModelDescription",
          },
          {
            kind: "custom",
            id: "utility-model",
            title: "UtilityModel",
            description: "UtilityModelDescription",
          },

          { kind: "subheader", id: "sub-intelligence", title: "Intelligence" },
          {
            kind: "toggle",
            key: "AI.AgentMode",
            title: "AgentMode",
            description: "AgentModeDescription",
            defaultValue: false,
          },
          {
            kind: "dropdown",
            key: "Chat.StreamingReveal",
            title: "ChatStreamingReveal",
            description: "ChatStreamingRevealDescription",
            defaultValue: "balanced",
            options: [
              { value: "instant", label: "StreamingInstant" },
              { value: "balanced", label: "StreamingBalanced" },
              { value: "smooth", label: "StreamingSmooth" },
            ],
          },
          {
            kind: "custom",
            id: "clear-chat-history",
            title: "ClearChatHistory",
            description: "ClearChatHistoryDescription",
          },

          { kind: "subheader", id: "sub-web-search", title: "WebSearch" },
          {
            kind: "toggle",
            key: "AI.WebSearch.Enabled",
            title: "WebSearchEnabled",
            description: "WebSearchEnabledDescription",
            defaultValue: true,
          },
          {
            kind: "dropdown",
            key: "AI.WebSearch.Provider",
            title: "WebSearchProvider",
            description: "WebSearchProviderDescription",
            defaultValue: "DuckDuckGo",
            options: ["None", "DuckDuckGo", "SearXNG", "Brave"].map((v) => ({ value: v })),
          },
          {
            kind: "text",
            key: "AI.WebSearch.SearxngUrl",
            title: "SearxngUrl",
            description: "SearxngUrlDescription",
            defaultValue: "http://localhost:8888",
          },
          {
            kind: "text",
            key: "AI.WebSearch.BraveApiKey",
            title: "BraveApiKey",
            description: "BraveApiKeyDescription",
            defaultValue: "",
            // Plaintext in the desktop's field, but every stored credential is
            // write-only across the process boundary the port introduces.
            secret: true,
          },
        ],
      },
    ],
  },

  {
    id: "Mindmap",
    icon: "network",
    title: "Mindmap",
    subtitle: "MindmapSubtitle",
    section: "modules",
    groups: [
      {
        id: "GridBackground",
        title: "GridBackground",
        rows: [
          {
            kind: "dropdown",
            key: "Mindmap.GridType",
            title: "GridType",
            description: "GridTypeDescription",
            defaultValue: "Dotted",
            options: ["None", "Dotted", "Lines"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Mindmap.GridSize",
            title: "GridSize",
            description: "GridSizeDescription",
            defaultValue: "40",
            options: ["20", "40", "60", "80", "100"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Mindmap.GridDotSize",
            title: "GridDotSize",
            description: "GridDotSizeDescription",
            defaultValue: "1.5",
            options: ["0.5", "1.0", "1.5", "2.0", "2.5", "3.0"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Mindmap.GridOpacity",
            title: "GridOpacity",
            description: "GridOpacityDescription",
            defaultValue: "0.2",
            options: ["0.05", "0.1", "0.15", "0.2", "0.3", "0.5", "0.7", "1.0"].map((v) => ({ value: v })),
          },
        ],
      },
      {
        id: "Interaction",
        title: "Interaction",
        rows: [
          {
            kind: "dropdown",
            key: "Mindmap.MinimapVisibility",
            title: "ShowMinimap",
            description: "ShowMinimapDescription",
            defaultValue: "Auto",
            options: ["Auto", "On", "Off"].map((v) => ({ value: v })),
          },
        ],
      },
    ],
  },

  {
    id: "Appearance",
    icon: "palette",
    title: "Appearance",
    subtitle: "AppearanceSubtitle",
    section: "app",
    groups: [
      {
        id: "Theme",
        title: "Theme",
        rows: [
          { kind: "custom", id: "theme-gallery", title: "AppTheme", description: "AppThemeDescription" },
        ],
      },
      {
        id: "Interface",
        title: "Interface",
        rows: [
          // Custom rather than a plain toggle because there are three states to
          // represent, not two: on, off, and following the operating system because the
          // user has not chosen. A toggle cannot show the third.
          { kind: "custom", id: "reduce-motion", title: "ReduceMotion", description: "ReduceMotionDescription" },
        ],
      },
      {
        id: "AppIconGroup",
        title: "AppIconGroup",
        rows: [
          { kind: "custom", id: "app-icon-gallery", title: "AppIcon", description: "AppIconDescription" },
        ],
      },
    ],
  },

  {
    id: "Keyboard",
    icon: "keyboard",
    title: "KeyboardCategoryTitle",
    subtitle: "KeyboardSubtitle",
    // The page is called Keyboard; nobody looking for one goes hunting for that word.
    keywords: ["shortcut", "shortcuts", "keybind", "keybinds", "hotkey", "hotkeys", "quick actions"],
    section: "app",
    // Its own surface: a searchable catalogue with a recorder in every row is not a
    // list of label/control pairs, and the rest of settings is nothing but those.
    page: "keyboard",
    groups: [],
  },

  {
    id: "Notifications",
    icon: "bell",
    title: "Notifications",
    subtitle: "NotificationsSubtitle",
    section: "app",
    groups: [
      {
        id: "InApp",
        title: "InApp",
        rows: [
          {
            kind: "toggle",
            key: "App.EnableToasts",
            title: "EnableToasts",
            description: "EnableToastsDescription",
            defaultValue: true,
          },
        ],
      },
    ],
  },

  {
    id: "Updates",
    icon: "download",
    title: "UpdatesCategoryTitle",
    subtitle: "UpdatesSubtitle",
    section: "app",
    groups: [
      {
        id: "Updates",
        title: "UpdatesGroupTitle",
        rows: [
          {
            kind: "toggle",
            key: "Updates.AutoCheck",
            title: "AutoCheckUpdates",
            description: "AutoCheckUpdatesDescription",
            defaultValue: true,
          },
          { kind: "custom", id: "check-for-updates", title: "CheckForUpdatesNow" },
          {
            kind: "action",
            id: "release-notes",
            title: "ReleaseNotes",
            description: "ReleaseNotesDescription",
            buttonLabel: "ViewOnGitHub",
            href: `${REPOSITORY_URL}/releases`,
          },
        ],
      },
    ],
  },

  {
    id: "About",
    icon: "info",
    title: "About",
    subtitle: "AboutSubtitle",
    keywords: ["licence", "license", "credits", "open source", "repository", "github", "version"],
    section: "advanced",
    groups: [
      // Untitled: the identity block is the page's own header, not a section of it.
      { id: "Identity", rows: [{ kind: "custom", id: "about-identity" }] },
      {
        id: "Project",
        title: "Project",
        rows: [
          {
            kind: "action",
            id: "repository",
            title: "Repository",
            description: "RepositoryDescription",
            buttonLabel: "ViewOnGitHub",
            href: REPOSITORY_URL,
          },
          {
            kind: "action",
            id: "licence",
            title: "Licence",
            description: "LicenceDescription",
            buttonLabel: "ReadIt",
            href: `${REPOSITORY_URL}/blob/main/LICENSE`,
          },
          {
            kind: "action",
            id: "third-party-licences",
            title: "ThirdPartyLicences",
            description: "ThirdPartyLicencesDescription",
            buttonLabel: "View",
            href: `${REPOSITORY_URL}/blob/main/THIRD-PARTY-NOTICES`,
          },
        ],
      },
      {
        id: "Support",
        title: "Support",
        rows: [
          {
            kind: "action",
            id: "log-folder",
            title: "LogFolder",
            description: "LogFolderDescription",
            buttonLabel: "OpenFolder",
            action: "open-log-folder",
          },
          {
            kind: "action",
            id: "data-folder",
            title: "DataFolder",
            description: "DataFolderDescription",
            buttonLabel: "OpenFolder",
            action: "open-data-folder",
          },
          {
            kind: "action",
            id: "report-problem",
            title: "ReportProblem",
            description: "ReportProblemDescription",
            buttonLabel: "ReportProblemButton",
            href: `${REPOSITORY_URL}/issues/new`,
          },
        ],
      },
    ],
  },

  {
    id: "Developer",
    icon: "terminal",
    // Untranslated in the desktop; carried over as-is.
    title: "Developer",
    section: "advanced",
    visible: (context) => context.developerMode,
    groups: [
      {
        id: "DeveloperTools",
        title: "Developer tools",
        rows: [
          {
            kind: "notice",
            id: "developer-notice",
            titleText: "Reserved for developers",
            descriptionText: "These settings are diagnostic tools, not product features.",
          },
          {
            kind: "toggle",
            key: "App.PerformanceDiagnostics",
            titleText: "Performance diagnostics",
            descriptionText: "Record timings for navigation, rendering and storage operations.",
            defaultValue: false,
          },
        ],
      },
    ],
  },
]

/** The categories to list, given the current developer-gate state. */
export function visibleCategories(context: {
  developerGateUnlocked: boolean
  developerMode: boolean
}): SettingsCategory[] {
  return SETTINGS_SCHEMA.filter((c) => c.visible?.(context) ?? true)
}

/**
 * Rows that persist a setting nothing in the port reads yet. A visible control the
 * app quietly ignores is worse than no control: it tells the user they changed
 * something when they did not. Hidden here rather than deleted, since the fix for
 * each is to wire it up, not to re-author the row; unhiding is then a one-line
 * removal from this set.
 */
const UNWIRED_ROW_IDS = new Set<string>([
  "Markdown.BlockSpacing",
  "Markdown.LineHeight",
  "Markdown.LetterSpacing",
  "Markdown.CodeFontSize",
  "Markdown.MathFontSize",
  "Markdown.RenderMath",
  "App.EnableGamification",
  "Chat.StreamingReveal",
  "AI.WebSearch.Provider",
  "AI.WebSearch.SearxngUrl",
  "AI.WebSearch.BraveApiKey",
  // A custom row, not a value row, but it names the same setting key it writes
  // through {@link CustomRow}'s `settingKey`; nothing reads App.Icon back.
  "app-icon-gallery",
])

/**
 * True when a row should be hidden outright, for one of two reasons: the
 * Developer-mode switch waits for its 7-tap gate, or the row is in
 * {@link UNWIRED_ROW_IDS}. Identified by storage key for value rows, or by id for
 * the custom rows that have no key of their own.
 */
export function isRowHidden(row: SettingsRow, context: { developerGateUnlocked: boolean }): boolean {
  const identity = "key" in row ? row.key : "id" in row ? row.id : undefined
  if (identity === "App.DeveloperMode") return !context.developerGateUnlocked
  return identity !== undefined && UNWIRED_ROW_IDS.has(identity)
}

/** The Developer category's title is untranslated, so the nav renders it literally. */
export const UNTRANSLATED_CATEGORY_TITLES: Record<string, string> = {
  Developer: "Developer",
}
