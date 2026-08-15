using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Services;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// The folders the user has saved exports into, most recent first.
/// </summary>
/// <remarks>
/// Remembered rather than configured. Where a file goes is a decision made once and then repeated,
/// so the last folder is a better default than anything the app could pick, and the two before it
/// are worth one click. Nothing here is a setting anybody edits on the settings page.
/// </remarks>
public static class ExportFolders
{
    public const string SettingKey = "App.ExportFolders";

    /// <summary>How many are kept. A list this short stays a shortcut instead of a history.</summary>
    private const int Remembered = 4;

    /// <summary>Where exports land before the user has ever chosen anywhere else.</summary>
    public static string Fallback() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Mnemo");

    public static async Task<IReadOnlyList<string>> ListAsync(ISettingsService settings)
    {
        var saved = await settings.GetAsync<string[]>(SettingKey, []).ConfigureAwait(false);
        var folders = saved.Where(path => !string.IsNullOrWhiteSpace(path)).ToList();
        // The fallback is appended rather than stored, so it follows the account's Documents
        // folder if that moves and never lingers in the list once real choices push it out.
        if (folders.Count == 0)
            folders.Add(Fallback());
        return folders;
    }

    public static async Task RememberAsync(ISettingsService settings, string path)
    {
        var clean = Normalize(path);
        if (clean.Length == 0)
            return;

        var saved = await settings.GetAsync<string[]>(SettingKey, []).ConfigureAwait(false);
        var next = new[] { clean }
            .Concat(saved.Where(existing =>
                !string.IsNullOrWhiteSpace(existing)
                && !string.Equals(Normalize(existing), clean, StringComparison.OrdinalIgnoreCase)))
            .Take(Remembered)
            .ToArray();

        await settings.SetAsync(SettingKey, next).ConfigureAwait(false);
    }

    /// <summary>Trims and drops any trailing separator, so one folder is one entry.</summary>
    private static string Normalize(string? path)
    {
        var trimmed = path?.Trim() ?? string.Empty;
        var clean = trimmed.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        // A drive root is the one place the separator is part of the name: "C:" is the process's
        // current directory on that drive, which is not the folder anybody chose.
        return clean.EndsWith(':') ? trimmed : clean;
    }
}
