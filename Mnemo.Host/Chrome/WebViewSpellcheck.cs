using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using Mnemo.Core.Services;

namespace Mnemo.Host.Chrome;

/// <summary>
/// Points the WebView's spell checker at the language the editor was told to use.
/// </summary>
/// <remarks>
/// Chromium does not read the document's <c>lang</c> attribute when it picks a
/// dictionary. It checks text against the dictionaries enabled in the browser
/// profile, and a profile that was never configured inherits the Windows display
/// language. Text written in a different language then comes back underlined word
/// by word no matter what the editor asks for.
///
/// WebView2 exposes no API for the dictionary list, and the profile is a Chromium
/// profile: the setting lives in its <c>Preferences</c> file. Mnemo owns that
/// folder (the window points it inside the app's data root), so the preference is
/// written directly, before the window and the WebView that owns the file exist.
/// The runtime fills in every other default and rewrites the file on exit, which
/// is why this only ever runs at startup and why a change to the setting takes
/// effect on the next launch.
/// </remarks>
public static class WebViewSpellcheck
{
    private const string LogCategory = "Mnemo.Host";

    /// <summary>
    /// The editor's language codes mapped to the dictionaries Chromium names.
    /// The names are the runtime's own, not BCP-47 tags of our choosing: most are
    /// the bare language, and English is only ever offered by region. A name the
    /// runtime does not know enables no dictionary at all.
    /// </summary>
    private static readonly Dictionary<string, string> Dictionaries = new(StringComparer.OrdinalIgnoreCase)
    {
        ["en"] = "en-US",
        ["de"] = "de",
        ["es"] = "es",
        ["nb"] = "nb",
    };

    /// <summary>
    /// Writes the chosen spellcheck dictionary into the WebView2 profile under
    /// <paramref name="userDataFolder"/>. A language the editor does not offer, or
    /// a profile that cannot be read or written, leaves the profile untouched.
    /// </summary>
    public static void Apply(string userDataFolder, string language, ILoggerService logger)
    {
        if (!Dictionaries.TryGetValue(language.Trim(), out var dictionary))
        {
            logger.Warning(LogCategory, $"No spellcheck dictionary for language '{language}'; leaving the WebView profile as it is.");
            return;
        }

        // The layout WebView2 creates under the folder it is given. The profile
        // directory does not exist before the first run, hence the create.
        var profile = Path.Combine(userDataFolder, "EBWebView", "Default");
        var file = Path.Combine(profile, "Preferences");

        try
        {
            Directory.CreateDirectory(profile);
            var root = ReadProfile(file, logger);

            if (root["spellcheck"] is not JsonObject spellcheck)
            {
                spellcheck = new JsonObject();
                root["spellcheck"] = spellcheck;
            }

            var alreadySet = spellcheck["dictionaries"] is JsonArray current && current.Count == 1 &&
                current[0]?.GetValue<string>() == dictionary;

            // One dictionary, not an added one: Chromium checks against every
            // enabled dictionary at once, so leaving the inherited one in place
            // would keep accepting the words this is meant to start flagging.
            spellcheck["dictionaries"] = new JsonArray(dictionary);

            // A dictionary for a language the profile does not list is not offered,
            // so the language joins the list. Appended rather than replacing it:
            // this list is also the Accept-Language header and the runtime's own UI
            // language order, neither of which is ours to decide.
            var listed = OfferLanguage(root, dictionary);

            if (alreadySet && !listed) return;

            File.WriteAllText(file, root.ToJsonString(new JsonSerializerOptions { WriteIndented = false }));
            logger.Info(LogCategory, $"WebView spellcheck dictionary set to '{dictionary}'.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            // The window must open either way; the cost of failing here is
            // squiggles in the wrong language, which is what it was before.
            logger.Error(LogCategory, $"Could not set the WebView spellcheck dictionary in '{file}'.", ex);
        }
    }

    /// <summary>
    /// The profile's preferences, or an empty object when there are none to read.
    /// </summary>
    /// <remarks>
    /// A file that is not there is the first run. A file that is there but does not
    /// parse is a profile the runtime will rewrite from its defaults anyway, so the
    /// preference is seeded into a fresh object rather than abandoned; it is worth
    /// a log line because it is not a state the runtime should leave behind.
    /// </remarks>
    private static JsonObject ReadProfile(string file, ILoggerService logger)
    {
        if (!File.Exists(file)) return new JsonObject();
        try
        {
            if (JsonNode.Parse(File.ReadAllText(file)) is JsonObject parsed) return parsed;
            logger.Warning(LogCategory, $"WebView profile '{file}' is not a JSON object; seeding a fresh one.");
        }
        catch (JsonException ex)
        {
            logger.Error(LogCategory, $"WebView profile '{file}' did not parse; seeding a fresh one.", ex);
        }

        return new JsonObject();
    }

    /// <summary>
    /// Adds <paramref name="dictionary"/>'s language to the profile's language
    /// list if neither it nor a regional variant of it is there already, and
    /// reports whether the list changed.
    /// </summary>
    private static bool OfferLanguage(JsonObject root, string dictionary)
    {
        if (root["intl"] is not JsonObject intl)
        {
            intl = new JsonObject();
            root["intl"] = intl;
        }

        var selected = intl["selected_languages"]?.GetValue<string>() ?? string.Empty;
        var language = dictionary.Split('-')[0];
        foreach (var entry in selected.Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            if (entry.Split('-')[0].Equals(language, StringComparison.OrdinalIgnoreCase)) return false;
        }

        intl["selected_languages"] = selected.Length == 0 ? dictionary : $"{selected},{dictionary}";
        return true;
    }
}
