using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Proofing;

namespace Mnemo.Infrastructure.Modules.Proofing;

/// <summary>
/// Puts the engines, the personal dictionary and the per-note ignore lists together into the answers
/// the API returns.
/// <para>
/// Filtering happens here rather than inside an engine. An engine holds one immutable word list
/// shared by every request, and folding a user's words into it would both give up that immutability
/// and let one note's exceptions silently apply to every other note.
/// </para>
/// </summary>
public sealed class ProofingService : IProofingService
{
    /// <summary>Settings key holding whether proofing runs at all.</summary>
    public const string EnabledKey = "Proofing.Enabled";

    /// <summary>Settings key holding the user's chosen language tag.</summary>
    public const string LanguageKey = "Proofing.Language";

    /// <summary>The older editor setting, read only as a fallback when no proofing language is stored.</summary>
    public const string LegacyLanguageKey = "Editor.SpellCheckLanguages";

    private const string DefaultLanguage = "en-US";

    // The older setting stored bare codes for four languages. Only the two that ship as dictionaries
    // can be honoured; the rest fall through to the default.
    private static readonly Dictionary<string, string> LegacyLanguageMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["en"] = "en-US",
        ["es"] = "es-ES",
    };

    private readonly IProofingEngineRegistry _engines;
    private readonly ProofingDictionaryCatalog _catalog;
    private readonly IPersonalDictionaryService _personal;
    private readonly INoteIgnoreService _ignores;
    private readonly ISettingsService _settings;

    public ProofingService(
        IProofingEngineRegistry engines,
        ProofingDictionaryCatalog catalog,
        IPersonalDictionaryService personal,
        INoteIgnoreService ignores,
        ISettingsService settings)
    {
        _engines = engines;
        _catalog = catalog;
        _personal = personal;
        _ignores = ignores;
        _settings = settings;
    }

    public bool IsInstalled(string language) => _catalog.Find(language) is { Installed: true };

    public async Task<ProofingStatus> GetStatusAsync(CancellationToken ct)
    {
        var enabled = await _settings.GetAsync(EnabledKey, true).ConfigureAwait(false);
        var language = await ResolveLanguageAsync(ct).ConfigureAwait(false);
        var personal = await _personal.ListAsync(ct).ConfigureAwait(false);

        StartLoading(language);

        var languages = _catalog.Entries
            .Select(entry => new ProofingLanguageStatus(
                entry.Id,
                entry.Name,
                entry.Region,
                entry.Installed,
                entry.Bundled,
                StateOf(entry),
                entry.ReasonKey,
                entry.License))
            .ToArray();

        return new ProofingStatus(enabled, language, languages, personal.Count);
    }

    public async Task<string> ResolveLanguageAsync(CancellationToken ct)
    {
        var stored = await _settings.GetAsync<string?>(LanguageKey, null).ConfigureAwait(false);
        if (IsInstalled(stored ?? string.Empty))
            return _catalog.Find(stored)!.Id;

        var legacy = await _settings.GetAsync<string?>(LegacyLanguageKey, null).ConfigureAwait(false);
        if (legacy is not null
            && LegacyLanguageMap.TryGetValue(legacy.Trim(), out var mapped)
            && IsInstalled(mapped))
        {
            return mapped;
        }

        if (IsInstalled(DefaultLanguage))
            return DefaultLanguage;

        return _catalog.InstalledLanguages.FirstOrDefault() ?? DefaultLanguage;
    }

    public async Task<IReadOnlyList<ProofingIssue>> CheckAsync(
        string language,
        string? noteId,
        string text,
        CancellationToken ct)
    {
        var engines = _engines.EnginesFor(language);
        if (engines.Count == 0 || string.IsNullOrEmpty(text))
            return [];

        var found = new List<ProofingIssue>();
        foreach (var engine in engines)
            found.AddRange(await engine.CheckAsync(language, text, ct).ConfigureAwait(false));

        if (found.Count == 0)
            return [];

        var ignored = string.IsNullOrWhiteSpace(noteId)
            ? []
            : await _ignores.ListAsync(noteId, ct).ConfigureAwait(false);
        var ignoredSet = new HashSet<string>(ignored, StringComparer.OrdinalIgnoreCase);

        var kept = new List<ProofingIssue>(found.Count);
        foreach (var issue in found)
        {
            if (ignoredSet.Contains(issue.Text))
                continue;
            if (await _personal.ContainsAsync(issue.Text, language, ct).ConfigureAwait(false))
                continue;
            kept.Add(issue);
        }

        return kept.OrderBy(i => i.Start).ToArray();
    }

    public async Task<IReadOnlyList<ProofingFix>> SuggestAsync(
        string language,
        string text,
        int start,
        int end,
        string? ruleId,
        CancellationToken ct)
    {
        if (text is null || start < 0 || end > text.Length || end <= start)
            return [];

        var engines = _engines.EnginesFor(language);
        if (engines.Count == 0)
            return [];

        var issue = new ProofingIssue(
            start,
            end,
            text[start..end],
            "spelling",
            "error",
            ruleId,
            TitleKey: null,
            MessageKey: null,
            Fixes: []);

        foreach (var engine in engines)
        {
            var fixes = await engine.SuggestAsync(language, issue, text, ct).ConfigureAwait(false);
            if (fixes.Count > 0)
                return fixes;
        }

        return [];
    }

    private string StateOf(ProofingDictionaryEntry entry)
    {
        if (!entry.Installed)
            return ProofingLanguageState.Absent;

        return _engines.EnginesFor(entry.Id).Any(e => e.IsReady(entry.Id))
            ? ProofingLanguageState.Ready
            : ProofingLanguageState.Loading;
    }

    /// <summary>
    /// Asks every engine for this language to check nothing, which is how a word list starts being
    /// read without a request waiting on it. Without this the first status call after launch would
    /// report a language that nobody has touched as loading and it would stay that way until a check
    /// arrived.
    /// </summary>
    private void StartLoading(string language)
    {
        foreach (var engine in _engines.EnginesFor(language))
        {
            if (engine.IsReady(language))
                continue;

            _ = engine.CheckAsync(language, string.Empty, CancellationToken.None).AsTask();
        }
    }
}
