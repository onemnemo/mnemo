using System;
using System.Collections.Generic;
using System.Text;

namespace Mnemo.Core.Models.Proofing;

/// <summary>
/// A snapshot of the personal dictionary, shaped for answering many words at once.
/// <para>
/// A paragraph is checked in every contributing language and each flagged word is then asked about
/// once per language, so walking the stored list per question made filtering cost more than the
/// checking that produced the questions. One of these is built per check and answers from sets.
/// </para>
/// <para>
/// Words are compared in composed form. A dictionary and an editor can encode the same accented
/// letter two ways, and without this a word the user added would go on being flagged while looking
/// identical to the one they added.
/// </para>
/// </summary>
public sealed class PersonalWordLookup
{
    /// <summary>The lookup for a user who has added nothing.</summary>
    public static readonly PersonalWordLookup Empty = new([]);

    private readonly HashSet<string> _everywhere = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, HashSet<string>> _byLanguage = new(StringComparer.OrdinalIgnoreCase);

    public PersonalWordLookup(IEnumerable<PersonalWord> words)
    {
        foreach (var entry in words ?? [])
        {
            var word = Normalize(entry?.Word ?? string.Empty);
            if (word.Length == 0)
                continue;

            if (string.IsNullOrWhiteSpace(entry!.Language))
            {
                _everywhere.Add(word);
                continue;
            }

            var primary = PrimarySubtag(entry.Language);
            if (!_byLanguage.TryGetValue(primary, out var bucket))
            {
                bucket = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                _byLanguage[primary] = bucket;
            }

            bucket.Add(word);
        }
    }

    /// <summary>
    /// The form two spellings have to share before they can be compared: trimmed and composed. Text
    /// that is not valid Unicode is returned trimmed, because a lone surrogate has no composed form
    /// and refusing to answer about it would flag it forever.
    /// </summary>
    public static string Normalize(string? word)
    {
        var trimmed = (word ?? string.Empty).Trim();
        if (trimmed.Length == 0)
            return string.Empty;

        try
        {
            return trimmed.Normalize(NormalizationForm.FormC);
        }
        catch (ArgumentException)
        {
            return trimmed;
        }
    }

    /// <summary>
    /// Whether the user has vouched for this word in any of these languages. A word added with no
    /// scope counts everywhere; a scoped one counts for every language sharing its primary subtag,
    /// so a word vouched for in English is not a mistake in American English.
    /// </summary>
    public bool Accepts(string word, IReadOnlyList<string> languages)
    {
        var probe = Normalize(word);
        if (probe.Length == 0)
            return false;

        if (_everywhere.Contains(probe))
            return true;

        if (_byLanguage.Count == 0 || languages is null)
            return false;

        foreach (var language in languages)
        {
            if (_byLanguage.TryGetValue(PrimarySubtag(language), out var bucket) && bucket.Contains(probe))
                return true;
        }

        return false;
    }

    /// <summary>The part of a language tag before its first separator, which is what scopes compare on.</summary>
    public static string PrimarySubtag(string? tag)
    {
        var value = tag ?? string.Empty;
        var cut = value.IndexOfAny(['-', '_']);
        return cut < 0 ? value : value[..cut];
    }
}
