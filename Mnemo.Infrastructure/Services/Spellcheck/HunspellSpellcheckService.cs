using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using WeCantSpell.Hunspell;

namespace Mnemo.Infrastructure.Services.Spellcheck;

public sealed class HunspellSpellcheckService : ISpellcheckService
{
    private readonly ISpellDictionaryCatalogService _catalog;
    private readonly IUserSpellbookService _spellbook;
    private readonly ILoggerService _logger;
    private readonly ConcurrentDictionary<string, WordList> _dictionaries = new(StringComparer.OrdinalIgnoreCase);

    private static readonly Regex TokenRegex = new(@"[\p{L}\p{M}][\p{L}\p{M}'’-]*", RegexOptions.Compiled);

    public HunspellSpellcheckService(
        ISpellDictionaryCatalogService catalog,
        IUserSpellbookService spellbook,
        ILoggerService logger)
    {
        _catalog = catalog;
        _spellbook = spellbook;
        _logger = logger;
    }

    public async Task<IReadOnlyList<SpellcheckIssue>> CheckAsync(
        IReadOnlyList<InlineSpan> spans,
        IReadOnlyList<string> languageCodes,
        CancellationToken cancellationToken)
    {
        var dictionaries = ResolveDictionaries(languageCodes);
        if (dictionaries.Count == 0)
            return [];

        var spellbooks = await LoadSpellbooksAsync(languageCodes, cancellationToken).ConfigureAwait(false);

        // LoadSpellbooksAsync resolves synchronously once the cache is warm, meaning
        // ConfigureAwait(false) would leave execution on the UI thread. Task.Run guarantees
        // the Hunspell word-checking loop always runs on a thread-pool thread.
        return await Task.Run(() =>
        {
            var issues = new List<SpellcheckIssue>();
            int offset = 0;

            foreach (var span in spans)
            {
                cancellationToken.ThrowIfCancellationRequested();

                if (span is TextSpan textSpan)
                {
                    if (!ShouldCheckTextSpan(textSpan))
                    {
                        offset += textSpan.Text.Length;
                        continue;
                    }

                    foreach (Match match in TokenRegex.Matches(textSpan.Text))
                    {
                        var token = match.Value;
                        if (token.Length <= 1)
                            continue;
                        if (token.Any(char.IsDigit))
                            continue;
                        if (IsCorrect(token, dictionaries, spellbooks))
                            continue;

                        // Suggestions are deferred, computed on demand when the user right-clicks.
                        // Building them here for every misspelled word (especially with a wrong-language
                        // dictionary where all words are incorrect) was the primary source of lag.
                        issues.Add(new SpellcheckIssue(offset + match.Index, match.Length, token, []));
                    }

                    offset += textSpan.Text.Length;
                    continue;
                }

                offset += 1;
            }

            return (IReadOnlyList<SpellcheckIssue>)issues;
        }, cancellationToken).ConfigureAwait(false);
    }

    public Task<IReadOnlyList<string>> SuggestAsync(
        string word,
        IReadOnlyList<string> languageCodes,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var dictionaries = ResolveDictionaries(languageCodes);
        var spellbooks = dictionaries.ToDictionary(
            static kv => kv.Key,
            static _ => (IReadOnlySet<string>)new HashSet<string>(StringComparer.OrdinalIgnoreCase),
            StringComparer.OrdinalIgnoreCase);
        return Task.Run(
            () => (IReadOnlyList<string>)BuildSuggestions(word, dictionaries, spellbooks),
            cancellationToken);
    }

    public async Task AddWordAsync(
        string word,
        IReadOnlyList<string> languageCodes,
        CancellationToken cancellationToken)
    {
        foreach (var languageCode in NormalizeLanguageCodes(languageCodes))
        {
            cancellationToken.ThrowIfCancellationRequested();
            await _spellbook.AddWordAsync(languageCode, word, cancellationToken).ConfigureAwait(false);
            if (_dictionaries.TryGetValue(languageCode, out var dictionary))
                dictionary.Add(word);
        }
    }

    private async Task<Dictionary<string, IReadOnlySet<string>>> LoadSpellbooksAsync(
        IReadOnlyList<string> languageCodes,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, IReadOnlySet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var languageCode in NormalizeLanguageCodes(languageCodes))
        {
            cancellationToken.ThrowIfCancellationRequested();
            result[languageCode] = await _spellbook.GetWordsAsync(languageCode, cancellationToken).ConfigureAwait(false);
        }

        return result;
    }

    private bool IsCorrect(
        string word,
        IReadOnlyDictionary<string, WordList> dictionaries,
        IReadOnlyDictionary<string, IReadOnlySet<string>> spellbooks)
    {
        foreach (var kv in dictionaries)
        {
            if (spellbooks.TryGetValue(kv.Key, out var words) && words.Contains(word))
                return true;

            if (kv.Value.Check(word))
                return true;
        }

        return false;
    }

    private static List<string> BuildSuggestions(
        string word,
        IReadOnlyDictionary<string, WordList> dictionaries,
        IReadOnlyDictionary<string, IReadOnlySet<string>> spellbooks)
    {
        if (string.IsNullOrWhiteSpace(word))
            return [];

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var candidates = new List<string>();

        foreach (var kv in dictionaries)
        {
            if (spellbooks.TryGetValue(kv.Key, out var words))
            {
                foreach (var customWord in words)
                {
                    if (!customWord.StartsWith(word[..1], StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (seen.Add(customWord))
                        candidates.Add(customWord);
                }
            }

            foreach (var suggestion in kv.Value.Suggest(word))
            {
                if (seen.Add(suggestion))
                    candidates.Add(suggestion);
            }
        }

        return candidates
            .OrderByDescending(s => StartsWithSamePrefix(s, word))
            .ThenBy(s => LevenshteinDistance(s, word))
            .ThenBy(s => Math.Abs(s.Length - word.Length))
            .ThenBy(s => s, StringComparer.OrdinalIgnoreCase)
            .Take(6)
            .ToList();
    }

    private static bool StartsWithSamePrefix(string candidate, string source)
    {
        if (string.IsNullOrEmpty(candidate) || string.IsNullOrEmpty(source))
            return false;
        return candidate[0].ToString().Equals(source[0].ToString(), StringComparison.OrdinalIgnoreCase);
    }

    private static int LevenshteinDistance(string a, string b)
    {
        if (string.Equals(a, b, StringComparison.OrdinalIgnoreCase))
            return 0;
        if (a.Length == 0)
            return b.Length;
        if (b.Length == 0)
            return a.Length;

        var previous = new int[b.Length + 1];
        var current = new int[b.Length + 1];
        for (int j = 0; j <= b.Length; j++)
            previous[j] = j;

        for (int i = 1; i <= a.Length; i++)
        {
            current[0] = i;
            for (int j = 1; j <= b.Length; j++)
            {
                var cost = char.ToLowerInvariant(a[i - 1]) == char.ToLowerInvariant(b[j - 1]) ? 0 : 1;
                current[j] = Math.Min(
                    Math.Min(current[j - 1] + 1, previous[j] + 1),
                    previous[j - 1] + cost);
            }

            (previous, current) = (current, previous);
        }

        return previous[b.Length];
    }

    private Dictionary<string, WordList> ResolveDictionaries(IReadOnlyList<string> languageCodes)
    {
        var result = new Dictionary<string, WordList>(StringComparer.OrdinalIgnoreCase);
        foreach (var code in NormalizeLanguageCodes(languageCodes))
        {
            if (_dictionaries.TryGetValue(code, out var cached))
            {
                result[code] = cached;
                continue;
            }

            try
            {
                if (!_catalog.TryResolve(code, out var affPath, out var dicPath))
                    continue;

                var dictionary = WordList.CreateFromFiles(dicPath, affPath);
                _dictionaries[code] = dictionary;
                result[code] = dictionary;
            }
            catch (Exception ex)
            {
                _logger.Warning(nameof(HunspellSpellcheckService), $"Failed to load dictionary '{code}': {ex.Message}");
            }
        }

        return result;
    }

    private static bool ShouldCheckTextSpan(TextSpan textSpan)
    {
        if (textSpan.Style.Code)
            return false;
        if (!string.IsNullOrEmpty(textSpan.Style.LinkUrl))
            return false;
        return true;
    }

    private static IReadOnlyList<string> NormalizeLanguageCodes(IReadOnlyList<string> languageCodes)
    {
        if (languageCodes.Count == 0)
            return ["en"];

        var result = new List<string>();
        foreach (var languageCode in languageCodes)
        {
            if (string.IsNullOrWhiteSpace(languageCode))
                continue;
            var code = languageCode.Trim().Replace('_', '-');
            var parts = code.Split('-', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0)
                continue;
            code = parts.Length == 1
                ? parts[0].ToLowerInvariant()
                : $"{parts[0].ToLowerInvariant()}-{parts[1].ToUpperInvariant()}";
            if (!result.Contains(code, StringComparer.OrdinalIgnoreCase))
                result.Add(code);
        }

        return result.Count == 0 ? ["en"] : result;
    }
}
