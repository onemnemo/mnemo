using System;
using System.Threading.Tasks;

namespace Mnemo.Core.Services;

/// <summary>
/// The two switches that decide whether the assistant exists for this install.
///
/// The AI is unfinished, so developer mode gates the whole of it: the AI &amp; Tools
/// settings page carrying the assistant's own switch is only listed once developer mode
/// is on, and that switch only takes effect while it stays on. Everything that shows or
/// registers an AI surface asks here rather than reading <see cref="EnabledKey"/> alone,
/// so no corner of the app keeps offering an assistant the rest of it has hidden.
/// </summary>
public static class AiAvailability
{
    /// <summary>The assistant's own switch, on the AI &amp; Tools page.</summary>
    public const string EnabledKey = "AI.EnableAssistant";

    /// <summary>Developer mode, the switch the assistant's own switch sits behind.</summary>
    public const string DeveloperModeKey = "App.DeveloperMode";

    /// <summary>True when a change to <paramref name="settingKey"/> can flip <see cref="IsEnabledAsync"/>.</summary>
    public static bool IsGatedBy(string settingKey) =>
        string.Equals(settingKey, EnabledKey, StringComparison.Ordinal)
        || string.Equals(settingKey, DeveloperModeKey, StringComparison.Ordinal);

    /// <summary>Reads both switches; the assistant is available only when both are on.</summary>
    public static async Task<bool> IsEnabledAsync(ISettingsService settings) =>
        await settings.GetAsync(DeveloperModeKey, false).ConfigureAwait(false)
        && await settings.GetAsync(EnabledKey, false).ConfigureAwait(false);
}
