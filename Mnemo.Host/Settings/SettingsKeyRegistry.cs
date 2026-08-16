using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Linq;

namespace Mnemo.Host.Settings;

/// <summary>How a setting is stored, and therefore what JSON the SPA may write for it.</summary>
public enum SettingValueKind
{
    /// <summary>Persisted as a real JSON boolean so the desktop's <c>GetAsync&lt;bool&gt;</c> reads it back.</summary>
    Boolean,

    /// <summary>Persisted as a JSON string. Dropdown, slider and free-text rows all land here.</summary>
    Text,
}

/// <summary>One settings key the SPA is allowed to touch.</summary>
/// <param name="Key">The storage key, identical to the one the desktop reads and writes.</param>
/// <param name="Kind">The stored value shape; a write of the wrong JSON kind is rejected.</param>
/// <param name="WriteOnly">
/// True for secrets: the value is never returned, only whether one is set.
/// </param>
public sealed record SettingKeyDescriptor(string Key, SettingValueKind Kind, bool WriteOnly = false);

/// <summary>
/// The allowlist behind the generic settings key/value endpoints.
/// <para>
/// Settings share one storage table with chat history, mindmap documents and the
/// overview layout, so an unrestricted key/value API would expose all of it. This
/// registry is the boundary: only these keys are readable or writable over HTTP.
/// </para>
/// <para>
/// Declaring each key's value kind also makes writes deterministic. The SPA holds the
/// presentation schema (labels, options, defaults); duplicating just the kind here
/// turns a client-side type slip into a 400 instead of a silently unreadable value —
/// the desktop's typed <c>GetAsync&lt;T&gt;</c> falls back to its default when the
/// stored JSON has the wrong shape, which would look like the setting resetting itself.
/// </para>
/// </summary>
public static class SettingsKeyRegistry
{
    // App.Language and the theme are deliberately absent: both need a side effect
    // beyond the write (switching the active culture, applying the theme), so they
    // keep their dedicated endpoints in SettingsEndpoints.
    private static readonly SettingKeyDescriptor[] Descriptors =
    [
        new("User.DisplayName", SettingValueKind.Text),
        new("User.ProfilePicture", SettingValueKind.Text),

        new("App.LaunchAtStartup", SettingValueKind.Boolean),
        // Which route a launch lands on: a route key, or "last" to resume where the
        // window was closed. The SPA owns the route names, so this stores whatever it
        // sends and an unknown one falls back to the default page there.
        new("App.OpenTo", SettingValueKind.Text),
        new("App.ConfirmExit", SettingValueKind.Boolean),
        new("App.EnableToasts", SettingValueKind.Boolean),
        new("App.EnableGamification", SettingValueKind.Boolean),
        new("App.Icon", SettingValueKind.Text),
        // Tri-state, stored as text: "full", "reduced", or absent meaning follow the OS.
        // A boolean cannot express the third, and defaulting an absent value to false
        // would override prefers-reduced-motion for everyone who never opened Settings.
        new("App.ReduceMotion", SettingValueKind.Text),
        new("App.DeveloperMode", SettingValueKind.Boolean),
        new("App.DeveloperModeGateUnlocked", SettingValueKind.Boolean),
        new("App.PerformanceDiagnostics", SettingValueKind.Boolean),

        new("Editor.AutoSave", SettingValueKind.Boolean),
        new("Editor.SpellCheck", SettingValueKind.Boolean),
        new("Editor.SpellCheckLanguages", SettingValueKind.Text),
        // Editor.Width and Markdown.BlockSpacing store the *translated* option label,
        // not a stable id. That is how the desktop persists step-slider and some
        // dropdown rows, and it still reads the same database during the port, so the
        // quirk is preserved rather than corrected here.
        new("Editor.Width", SettingValueKind.Text),

        new("Markdown.BlockSpacing", SettingValueKind.Text),
        new("Markdown.LineHeight", SettingValueKind.Text),
        new("Markdown.LetterSpacing", SettingValueKind.Text),
        new("Markdown.FontSize", SettingValueKind.Text),
        new("Markdown.CodeFontSize", SettingValueKind.Text),
        new("Markdown.MathFontSize", SettingValueKind.Text),
        new("Markdown.RenderMath", SettingValueKind.Boolean),

        new("AI.EnableAssistant", SettingValueKind.Boolean),
        new("AI.Provider.Mode", SettingValueKind.Text),
        new("AI.OpenRouter.ApiKey", SettingValueKind.Text, WriteOnly: true),
        new("AI.OpenRouter.AssistantModel", SettingValueKind.Text),
        new("AI.OpenRouter.UtilityModel", SettingValueKind.Text),
        new("AI.AgentMode", SettingValueKind.Boolean),
        new("Chat.StreamingReveal", SettingValueKind.Text),
        new("AI.WebSearch.Enabled", SettingValueKind.Boolean),
        new("AI.WebSearch.Provider", SettingValueKind.Text),
        new("AI.WebSearch.SearxngUrl", SettingValueKind.Text),
        // Plaintext in the desktop's textbox, but the process boundary makes every
        // stored credential write-only over the API.
        new("AI.WebSearch.BraveApiKey", SettingValueKind.Text, WriteOnly: true),

        // Mindmap.GridType, Mindmap.GridSize, Mindmap.GridDotSize and Mindmap.GridOpacity
        // are deliberately absent: the SPA no longer has controls for them (nothing in
        // its schema reads or writes them), though the desktop app's own settings page
        // still does through its own in-process ISettingsService, not this HTTP allowlist.
        new("Mindmap.MinimapVisibility", SettingValueKind.Text),

        new("Updates.AutoCheck", SettingValueKind.Boolean),

        new("Onboarding.Completed", SettingValueKind.Boolean),
    ];

    private static readonly Dictionary<string, SettingKeyDescriptor> ByKey =
        Descriptors.ToDictionary(d => d.Key, StringComparer.Ordinal);

    /// <summary>Every key the SPA may read or write, in declaration order.</summary>
    public static IReadOnlyList<SettingKeyDescriptor> All => Descriptors;

    /// <summary>Resolves a key to its descriptor, or false when the key is not exposed.</summary>
    public static bool TryGet(string key, [NotNullWhen(true)] out SettingKeyDescriptor? descriptor) =>
        ByKey.TryGetValue(key, out descriptor);
}
