using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models.Proofing;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Proofing;
using WeCantSpell.Hunspell;

namespace Mnemo.Infrastructure.Modules.Proofing;

/// <summary>
/// Spelling over the bundled Hunspell dictionaries.
/// <para>
/// Each language is read once, on a thread pool thread, behind a <c>Lazy</c> that every later caller
/// awaits. A <c>WordList</c> is immutable and safe to query from any number of threads, which is why
/// one instance is shared for the life of the process. It is never mutated: personal words and
/// per-note ignores are filtered out above this class, because adding them to a live word list has
/// no stated safety guarantee against concurrent queries and would also make one user's dictionary
/// leak into every note.
/// </para>
/// </summary>
public sealed class HunspellProofingEngine : IProofingEngine
{
    /// <summary>How many suggestions a single request will ever return.</summary>
    public const int MaxSuggestions = 8;

    private const string SpellingKind = "spelling";
    private const string ErrorTone = "error";
    private const string LogCategory = "Proofing";

    private readonly ProofingDictionaryCatalog _catalog;
    private readonly ILoggerService _logger;
    private readonly ConcurrentDictionary<string, Lazy<Task<WordList?>>> _loads =
        new(StringComparer.OrdinalIgnoreCase);

    public HunspellProofingEngine(ProofingDictionaryCatalog catalog, ILoggerService logger)
    {
        _catalog = catalog;
        _logger = logger;
    }

    public string Id => "hunspell";

    public IReadOnlyList<string> Languages => _catalog.InstalledLanguages;

    public bool IsReady(string language) =>
        _loads.TryGetValue(language, out var load)
        && load.IsValueCreated
        && load.Value is { IsCompletedSuccessfully: true, Result: not null };

    public async ValueTask<IReadOnlyList<ProofingIssue>> CheckAsync(string language, string text, CancellationToken ct)
    {
        // The load is awaited before the empty-text shortcut on purpose: a caller with nothing to
        // check is how the status endpoint asks this engine to start warming a language.
        var words = await LoadAsync(language, ct).ConfigureAwait(false);
        if (words is null || string.IsNullOrEmpty(text))
            return [];

        var tokens = ProofingTokenizer.Tokenize(text, ct);
        if (tokens.Count == 0)
            return [];

        var issues = new List<ProofingIssue>();
        foreach (var token in tokens)
        {
            ct.ThrowIfCancellationRequested();

            var word = text[token.Start..token.End];
            if (words.Check(Composed(word)))
                continue;

            issues.Add(new ProofingIssue(
                token.Start,
                token.End,
                word,
                SpellingKind,
                ErrorTone,
                RuleId: null,
                TitleKey: null,
                MessageKey: null,
                Fixes: []));
        }

        return issues;
    }

    public async ValueTask<IReadOnlyList<ProofingFix>> SuggestAsync(
        string language,
        ProofingIssue issue,
        string text,
        CancellationToken ct)
    {
        var words = await LoadAsync(language, ct).ConfigureAwait(false);
        if (words is null || string.IsNullOrEmpty(issue.Text))
            return [];

        // Suggesting costs roughly six thousand times what checking one word costs, so it runs on a
        // thread pool thread and only ever for the one word the user asked about.
        var word = Composed(issue.Text);
        var suggestions = await Task.Run(
            () => words.Suggest(word).Take(MaxSuggestions).ToArray(),
            ct).ConfigureAwait(false);

        return [.. suggestions.Select(s => new ProofingFix(s, null))];
    }

    /// <summary>
    /// The composed (NFC) form of a word, for the dictionary lookup only.
    /// <para>
    /// A word list stores composed forms, so a decomposed one misses every entry and the whole word is
    /// reported as wrong. macOS hands out decomposed text on several paste and filename paths, which in
    /// Spanish underlines most of a pasted document. Only the looked-up copy is normalised, never the
    /// text the offsets index, because composing that would move every offset after the first accent.
    /// </para>
    /// </summary>
    private static string Composed(string word)
    {
        try
        {
            return word.IsNormalized(NormalizationForm.FormC) ? word : word.Normalize(NormalizationForm.FormC);
        }
        catch (ArgumentException)
        {
            // Both calls refuse a string holding half a surrogate pair, which a range carried over from
            // an earlier check can slice out of otherwise valid text. The raw word is the right lookup:
            // it misses, which is the same answer as for any other word the list does not have. Keeping
            // the guard here rather than only at the caller means neither path depends on a tokenizer
            // invariant that lives in another file.
            return word;
        }
    }

    private async Task<WordList?> LoadAsync(string language, CancellationToken ct)
    {
        var entry = _catalog.Find(language);
        if (entry is not { Installed: true, AffixPath: not null, DictionaryPath: not null })
            return null;

        var load = _loads.GetOrAdd(
            entry.Id,
            id => new Lazy<Task<WordList?>>(() => Task.Run(() => Read(id, entry.DictionaryPath!, entry.AffixPath!))));

        var words = await load.Value.WaitAsync(ct).ConfigureAwait(false);
        if (words is null)
        {
            // A read that failed is not cached as the answer forever: dropping the entry lets a later
            // request try again, which is what a file that was locked or half-written needs.
            _loads.TryRemove(new KeyValuePair<string, Lazy<Task<WordList?>>>(entry.Id, load));
        }

        return words;
    }

    private WordList? Read(string id, string dictionaryPath, string affixPath)
    {
        try
        {
            return WordList.CreateFromFiles(dictionaryPath, affixPath);
        }
        catch (Exception ex)
        {
            // A dictionary that will not parse is a broken install, not a request fault. Reporting it
            // as "no issues" keeps the editor usable, and the log line is the only place it shows.
            _logger.Log(LogLevel.Error, LogCategory, $"Dictionary '{id}' could not be read.", ex);
            return null;
        }
    }
}
