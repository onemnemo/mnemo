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
/// Puts the engines, the personal dictionary and the per-note lists together into the answers the
/// API returns.
/// <para>
/// Filtering happens here rather than inside an engine. An engine holds one immutable word list
/// shared by every request, and folding a user's words into it would both give up that immutability
/// and let one note's exceptions silently apply to every other note.
/// </para>
/// <para>
/// A person writing in two languages is writing one document, so a word is a mistake only when
/// every dictionary that answered says it is. That makes checking an intersection rather than a
/// merge, and it is why a dictionary that could not be read has to be told apart from one that
/// found nothing wrong.
/// </para>
/// </summary>
public sealed class ProofingService : IProofingService
{
    /// <summary>Settings key holding whether proofing runs at all.</summary>
    public const string EnabledKey = "Proofing.Enabled";

    /// <summary>Settings key holding the user's ordered set of languages.</summary>
    public const string LanguagesKey = "Proofing.Languages";

    /// <summary>The older single choice, read only as a fallback when no set is stored.</summary>
    public const string LanguageKey = "Proofing.Language";

    /// <summary>The older editor setting, read only as a fallback when neither of the above is stored.</summary>
    public const string LegacyLanguageKey = "Editor.SpellCheckLanguages";

    private const string SpellingKind = "spelling";
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
    private readonly INoteLanguageService _noteLanguages;
    private readonly ISettingsService _settings;

    public ProofingService(
        IProofingEngineRegistry engines,
        ProofingDictionaryCatalog catalog,
        IPersonalDictionaryService personal,
        INoteIgnoreService ignores,
        INoteLanguageService noteLanguages,
        ISettingsService settings)
    {
        _engines = engines;
        _catalog = catalog;
        _personal = personal;
        _ignores = ignores;
        _noteLanguages = noteLanguages;
        _settings = settings;
    }

    public bool IsInstalled(string language) => _catalog.Find(language) is { Installed: true };

    public async Task<ProofingStatus> GetStatusAsync(string? noteId, CancellationToken ct)
    {
        var enabled = await _settings.GetAsync(EnabledKey, true).ConfigureAwait(false);
        var active = await ResolveActiveAsync(ct).ConfigureAwait(false);
        var note = string.IsNullOrWhiteSpace(noteId)
            ? null
            : await ResolveForNoteAsync(noteId, ct).ConfigureAwait(false);
        var personal = await _personal.ListAsync(ct).ConfigureAwait(false);

        foreach (var language in active.Concat(note?.Effective ?? []).Distinct(StringComparer.OrdinalIgnoreCase))
            StartLoading(language);

        var languages = _catalog.Entries
            .Select(entry => new ProofingLanguageStatus(
                entry.Id,
                entry.Name,
                entry.NameKey,
                entry.Region,
                entry.RegionKey,
                entry.Installed,
                entry.Bundled,
                StateOf(entry),
                entry.ReasonKey,
                entry.License))
            .ToArray();

        return new ProofingStatus(enabled, active, languages, personal.Count, note);
    }

    public async Task<IReadOnlyList<string>> ResolveActiveAsync(CancellationToken ct)
    {
        // A stored set answers even when it is empty. Switching the last language off is a choice,
        // and falling through to a default there would hand back a language the user just removed.
        var stored = await _settings.GetAsync<string[]?>(LanguagesKey, null).ConfigureAwait(false);
        if (stored is not null)
            return [.. ProofingLanguages.Canonical(_catalog, stored).Where(IsInstalled)];

        var single = await _settings.GetAsync<string?>(LanguageKey, null).ConfigureAwait(false);
        if (_catalog.Find(single) is { Installed: true } entry)
            return [entry.Id];

        var legacy = await _settings.GetAsync<string?>(LegacyLanguageKey, null).ConfigureAwait(false);
        if (legacy is not null
            && LegacyLanguageMap.TryGetValue(legacy.Trim(), out var mapped)
            && IsInstalled(mapped))
        {
            return [mapped];
        }

        if (IsInstalled(DefaultLanguage))
            return [DefaultLanguage];

        return _catalog.InstalledLanguages.Take(1).ToArray();
    }

    public async Task<NoteProofing> ResolveForNoteAsync(string noteId, CancellationToken ct)
    {
        var entry = string.IsNullOrWhiteSpace(noteId)
            ? null
            : await _noteLanguages.GetAsync(noteId, ct).ConfigureAwait(false);

        if (string.Equals(entry?.Mode, NoteProofingMode.Off, StringComparison.Ordinal))
            return new NoteProofing(NoteProofingMode.Off, [], []);

        // Anything other than the two stored modes, including a row written by a later build, means
        // the note has said nothing this build understands, and following settings is the answer
        // that still checks the document.
        if (!string.Equals(entry?.Mode, NoteProofingMode.Custom, StringComparison.Ordinal))
        {
            var active = await ResolveActiveAsync(ct).ConfigureAwait(false);
            return new NoteProofing(NoteProofingMode.Default, [], active);
        }

        var languages = ProofingLanguages.Canonical(_catalog, entry!.Languages);
        return new NoteProofing(NoteProofingMode.Custom, languages, [.. languages.Where(IsInstalled)]);
    }

    public async Task<IReadOnlyList<ProofingIssue>> CheckAsync(
        IReadOnlyList<string> languages,
        string? noteId,
        string text,
        CancellationToken ct)
    {
        if (languages is null || languages.Count == 0 || string.IsNullOrEmpty(text))
            return [];

        var contributing = new List<string>();
        var answers = new List<List<ProofingIssue>>();

        foreach (var language in languages)
        {
            var engines = _engines.EnginesFor(language);
            if (engines.Count == 0)
                continue;

            var found = new List<ProofingIssue>();
            foreach (var engine in engines)
                found.AddRange(await engine.CheckAsync(language, text, ct).ConfigureAwait(false));

            // A word list that could not be read answers with no issues, which is indistinguishable
            // from a clean paragraph and would empty the intersection for every other language. The
            // engine is left not ready by a failed read, so that is what separates the two.
            if (!engines.Any(e => e.IsReady(language)))
                continue;

            contributing.Add(language);
            answers.Add(found);
        }

        if (contributing.Count == 0)
            return [];

        var merged = Merge(answers);
        if (merged.Count == 0)
            return [];

        var ignored = string.IsNullOrWhiteSpace(noteId)
            ? []
            : await _ignores.ListAsync(noteId, ct).ConfigureAwait(false);
        // Composed, like the personal list, so a word ignored from the editor still matches the text
        // it was ignored from however the two encoded its accents.
        var ignoredSet = new HashSet<string>(
            ignored.Select(PersonalWordLookup.Normalize),
            StringComparer.OrdinalIgnoreCase);

        var personal = await _personal.LookupAsync(ct).ConfigureAwait(false);

        var kept = new List<ProofingIssue>(merged.Count);
        foreach (var issue in merged)
        {
            if (ignoredSet.Contains(PersonalWordLookup.Normalize(issue.Text)))
                continue;
            if (personal.Accepts(issue.Text, contributing))
                continue;
            kept.Add(issue);
        }

        return kept.OrderBy(i => i.Start).ToArray();
    }

    public async Task<IReadOnlyList<ProofingFix>> SuggestAsync(
        IReadOnlyList<string> languages,
        string text,
        int start,
        int end,
        string? ruleId,
        CancellationToken ct)
    {
        if (languages is null || languages.Count == 0)
            return [];

        if (text is null || start < 0 || end > text.Length || end <= start)
            return [];

        var issue = new ProofingIssue(
            start,
            end,
            text[start..end],
            SpellingKind,
            "error",
            ruleId,
            TitleKey: null,
            MessageKey: null,
            Fixes: []);

        foreach (var language in languages)
        {
            foreach (var engine in _engines.EnginesFor(language))
            {
                var fixes = await engine.SuggestAsync(language, issue, text, ct).ConfigureAwait(false);
                if (fixes.Count > 0)
                    return fixes;
            }
        }

        return [];
    }

    /// <summary>
    /// One list out of one per language: a spelling issue survives only where every language flagged
    /// the same span, and an issue of any other kind survives from any of them.
    /// <para>
    /// The two halves differ because they mean different things. A misspelling is a word no
    /// dictionary knows, so a word one language accepts is not a mistake. Anything else, a grammar
    /// or a wording issue, is about a stretch of writing rather than a token, and no two languages
    /// would ever report it over exactly the same span, so intersecting would delete all of them.
    /// </para>
    /// </summary>
    private static List<ProofingIssue> Merge(List<List<ProofingIssue>> answers)
    {
        var merged = new List<ProofingIssue>();

        // One language can already report the same span twice, when two engines serve it, so the
        // comparison is over the distinct spans each language produced rather than over a count.
        var common = Spans(answers[0]);
        for (var i = 1; i < answers.Count && common.Count > 0; i++)
            common.IntersectWith(Spans(answers[i]));

        var taken = new HashSet<(int Start, int End)>();
        foreach (var issue in answers[0])
        {
            if (!IsSpelling(issue))
                continue;
            if (common.Contains((issue.Start, issue.End)) && taken.Add((issue.Start, issue.End)))
                merged.Add(issue);
        }

        var seen = new HashSet<(int Start, int End, string Kind, string? RuleId)>();
        foreach (var issue in answers.SelectMany(a => a))
        {
            if (IsSpelling(issue))
                continue;
            if (seen.Add((issue.Start, issue.End, issue.Kind, issue.RuleId)))
                merged.Add(issue);
        }

        return merged;
    }

    private static bool IsSpelling(ProofingIssue issue) =>
        string.Equals(issue.Kind, SpellingKind, StringComparison.Ordinal);

    private static HashSet<(int Start, int End)> Spans(List<ProofingIssue> issues) =>
        [.. issues.Where(IsSpelling).Select(i => (i.Start, i.End))];

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
