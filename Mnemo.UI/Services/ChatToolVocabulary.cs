using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Mnemo.UI.Services;

/// <summary>
/// Translates raw tool ids (e.g. <c>list_settings</c>, <c>set_setting</c>) into the student-facing
/// trace vocabulary: a present-progressive label while the tool runs, a past-tense label when it is
/// done, an optional value chip drawn from the call's arguments (a query, a theme name), and an
/// optional quiet count suffix drawn from the result. Labels are localization keys resolved by the
/// caller; only the object ("your theme") is ever named, never the tool. Unmapped tools fall back to
/// a generic "Used a tool" with the humanized name as the chip, never snake_case.
/// </summary>
public static class ChatToolVocabulary
{
    /// <summary>A resolved trace label pair plus the data-derived chip/suffix for one tool call.</summary>
    public readonly record struct ToolStep(string RunningLabel, string DoneLabel, string? Chip, string? Suffix);

    // tool id -> (running label key, done label key) in the "Chat" localization namespace.
    private static readonly Dictionary<string, (string Running, string Done)> LabelKeys = new(StringComparer.Ordinal)
    {
        ["search_notes"] = ("ToolRunSearchNotes", "ToolDoneSearchNotes"),
        ["outline_note"] = ("ToolRunReadNote", "ToolDoneReadNote"),
        ["read_note"] = ("ToolRunReadNote", "ToolDoneReadNote"),
        ["edit_note"] = ("ToolRunEditNote", "ToolDoneEditNote"),
        ["create_note"] = ("ToolRunCreateNote", "ToolDoneCreateNote"),
        ["manage_note"] = ("ToolRunManageNote", "ToolDoneManageNote"),
        ["open_note"] = ("ToolRunOpenNote", "ToolDoneOpenNote"),

        ["list_settings"] = ("ToolRunListSettings", "ToolDoneListSettings"),
        ["get_setting"] = ("ToolRunGetSetting", "ToolDoneGetSetting"),
        ["set_setting"] = ("ToolRunSetSetting", "ToolDoneSetSetting"),
        ["reset_setting"] = ("ToolRunResetSetting", "ToolDoneResetSetting"),

        ["search_mindmaps"] = ("ToolRunSearchMindmaps", "ToolDoneSearchMindmaps"),
        ["find_in_map"] = ("ToolRunSearchMindmaps", "ToolDoneSearchMindmaps"),
        ["create_mindmap"] = ("ToolRunCreateMindmap", "ToolDoneCreateMindmap"),
        ["outline_mindmap"] = ("ToolRunReadMindmap", "ToolDoneReadMindmap"),
        ["read_elements"] = ("ToolRunReadMindmap", "ToolDoneReadMindmap"),
        ["edit_mindmap"] = ("ToolRunEditMindmap", "ToolDoneEditMindmap"),

        ["navigate_to"] = ("ToolRunNavigate", "ToolDoneNavigate"),
        ["open_settings"] = ("ToolRunNavigate", "ToolDoneNavigate"),

        ["web_search"] = ("ToolRunWebSearch", "ToolDoneWebSearch"),
        ["search_web"] = ("ToolRunWebSearch", "ToolDoneWebSearch"),

        // Internal orchestration plumbing, surfaced quietly as "getting ready", never by name.
        ["get_skills"] = ("ToolRunPreparing", "ToolDonePreparing"),
        ["fetch_skill"] = ("ToolRunPreparing", "ToolDonePreparing"),
        ["inject_skill"] = ("ToolRunPreparing", "ToolDonePreparing"),
        ["get_analytics_skills"] = ("ToolRunPreparing", "ToolDonePreparing"),
        ["get_version"] = ("ToolRunPreparing", "ToolDonePreparing"),
        ["get_current_route"] = ("ToolRunPreparing", "ToolDonePreparing"),
    };

    // Tools whose done label reads "Switched your theme" and whose chip is the chosen theme.
    private const string AppearanceThemeKey = "Appearance.Theme";

    /// <summary>
    /// Resolves the full trace vocabulary for one tool call. <paramref name="localize"/> maps a
    /// key in the "Chat" namespace to its localized string.
    /// </summary>
    public static ToolStep Resolve(string toolName, string? argumentsJson, string? resultContent, Func<string, string> localize)
    {
        toolName ??= string.Empty;

        string runningKey, doneKey;
        var chip = ExtractChip(toolName, argumentsJson);

        // Special-case theme writes so the label speaks about the theme, not "a setting".
        if (toolName == "set_setting" && IsThemeWrite(argumentsJson))
        {
            runningKey = "ToolRunSetTheme";
            doneKey = "ToolDoneSetTheme";
        }
        else if (LabelKeys.TryGetValue(toolName, out var keys))
        {
            runningKey = keys.Running;
            doneKey = keys.Done;
        }
        else
        {
            // Unmapped: generic label, humanized name as the chip so nothing shows snake_case.
            return new ToolStep(
                localize("ToolRunGeneric"),
                localize("ToolDoneGeneric"),
                chip ?? Humanize(toolName),
                null);
        }

        var suffix = ExtractSuffix(toolName, resultContent, localize);
        return new ToolStep(localize(runningKey), localize(doneKey), chip, suffix);
    }

    /// <summary>Turns a snake_case tool id into human words, e.g. <c>list_decks</c> → "List decks".</summary>
    public static string Humanize(string toolName)
    {
        if (string.IsNullOrWhiteSpace(toolName))
            return string.Empty;

        var words = toolName.Replace('_', ' ').Trim();
        if (words.Length == 0)
            return string.Empty;

        return char.ToUpperInvariant(words[0]) + words[1..];
    }

    private static bool IsThemeWrite(string? argumentsJson)
    {
        var key = ReadStringArg(argumentsJson, "key");
        return string.Equals(key, AppearanceThemeKey, StringComparison.OrdinalIgnoreCase)
               || string.Equals(key, "theme", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Best-effort value chip from the call arguments: a query, a theme/value, or a title.</summary>
    private static string? ExtractChip(string toolName, string? argumentsJson)
    {
        if (string.IsNullOrWhiteSpace(argumentsJson))
            return null;

        return toolName switch
        {
            "set_setting" or "get_setting" or "reset_setting" =>
                ReadStringArg(argumentsJson, "value") ?? ReadStringArg(argumentsJson, "key"),
            "search_notes" or "search_mindmaps" or "find_in_map" or "web_search" or "search_web" =>
                ReadStringArg(argumentsJson, "query"),
            "create_note" or "create_mindmap" =>
                ReadStringArg(argumentsJson, "title"),
            _ => null,
        };
    }

    /// <summary>Best-effort "· N found" style suffix from a search/list result. Omitted unless confident.</summary>
    private static string? ExtractSuffix(string toolName, string? resultContent, Func<string, string> localize)
    {
        var isCountable = toolName is "search_notes" or "search_mindmaps" or "find_in_map"
            or "list_settings" or "web_search" or "search_web";
        if (!isCountable || string.IsNullOrWhiteSpace(resultContent))
            return null;

        var count = TryCountResults(resultContent);
        if (count is null)
            return null;

        var formatKey = toolName is "web_search" or "search_web" ? "ToolSuffixSources" : "ToolSuffixFound";
        return string.Format(localize(formatKey), count.Value);
    }

    private static string? ReadStringArg(string? argumentsJson, string name)
    {
        if (string.IsNullOrWhiteSpace(argumentsJson))
            return null;

        try
        {
            using var doc = JsonDocument.Parse(argumentsJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return null;
            if (doc.RootElement.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String)
            {
                var s = prop.GetString();
                return string.IsNullOrWhiteSpace(s) ? null : s!.Trim();
            }
        }
        catch (JsonException)
        {
            // Malformed args: no chip rather than a wrong one.
        }
        return null;
    }

    /// <summary>
    /// Counts result rows only when the shape is unambiguous: a top-level JSON array, or an object
    /// carrying a recognised array property. Returns null (no suffix) rather than risk a wrong number.
    /// </summary>
    private static int? TryCountResults(string resultContent)
    {
        try
        {
            using var doc = JsonDocument.Parse(resultContent);
            var root = doc.RootElement;

            if (root.ValueKind == JsonValueKind.Array)
                return root.GetArrayLength();

            if (root.ValueKind == JsonValueKind.Object)
            {
                foreach (var name in ResultArrayNames)
                {
                    if (root.TryGetProperty(name, out var arr) && arr.ValueKind == JsonValueKind.Array)
                        return arr.GetArrayLength();
                }

                if (root.TryGetProperty("count", out var c) && c.ValueKind == JsonValueKind.Number
                    && c.TryGetInt32(out var n))
                    return n;
            }
        }
        catch (JsonException)
        {
            // Non-JSON or unexpected shape: no suffix.
        }
        return null;
    }

    private static readonly string[] ResultArrayNames =
        { "results", "items", "notes", "matches", "settings", "mindmaps", "sources", "hits", "blocks" };
}
