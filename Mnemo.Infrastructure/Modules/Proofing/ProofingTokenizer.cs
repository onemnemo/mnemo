using System;
using System.Buffers;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Mnemo.Infrastructure.Modules.Proofing;

/// <summary>One word found in a text, as a half-open range of UTF-16 code units.</summary>
public readonly record struct ProofingToken(int Start, int End)
{
    public int Length => End - Start;
}

/// <summary>
/// Splits text into the words a spelling dictionary can be asked about.
/// <para>
/// It belongs to the Hunspell engine rather than to the seam above it, because word tokenization is
/// what a spelling engine needs and not what a grammar engine needs.
/// </para>
/// <para>
/// Offsets are UTF-16 code unit indices, which is what a JavaScript string index is, so a range
/// crosses the wire and lands on the same characters without conversion. Text is walked by
/// <see cref="Rune"/>, so a surrogate pair is one step and is never split, and a lone surrogate is
/// stepped over rather than throwing.
/// </para>
/// </summary>
public static class ProofingTokenizer
{
    /// <summary>
    /// Every checkable word in <paramref name="text"/>, in order. Skips anything holding a digit,
    /// anything inside a URL or an email address, and any word with fewer than two letters, because
    /// none of those is a spelling mistake a dictionary can rule on.
    /// </summary>
    public static IReadOnlyList<ProofingToken> Tokenize(string text)
    {
        if (string.IsNullOrEmpty(text))
            return [];

        var tokens = new List<ProofingToken>();
        var skips = FindAddressSpans(text);

        var i = 0;
        while (i < text.Length)
        {
            if (!TryDecode(text, i, out var rune, out var consumed) || !IsWordish(rune))
            {
                i += consumed;
                continue;
            }

            var start = i;
            var hasDigit = false;
            var letters = 0;
            var j = i;

            while (j < text.Length)
            {
                if (!TryDecode(text, j, out var current, out var step))
                    break;

                if (IsWordish(current))
                {
                    if (Rune.IsDigit(current))
                        hasDigit = true;
                    else if (Rune.IsLetter(current))
                        letters++;
                    j += step;
                    continue;
                }

                // A connector only joins; it never opens or closes a word. Requiring a word character
                // on the far side is what keeps a trailing apostrophe out of 'color' and stops an em
                // rule from gluing two words into one token.
                if (IsConnector(current)
                    && TryDecode(text, j + step, out var next, out _)
                    && IsWordish(next))
                {
                    j += step;
                    continue;
                }

                break;
            }

            i = j;

            if (hasDigit || letters < 2 || OverlapsAny(skips, start, j))
                continue;

            tokens.Add(new ProofingToken(start, j));
        }

        return tokens;
    }

    private static bool TryDecode(string text, int index, out Rune rune, out int consumed)
    {
        if (index >= text.Length)
        {
            rune = default;
            consumed = 1;
            return false;
        }

        var status = Rune.DecodeFromUtf16(text.AsSpan(index), out rune, out consumed);
        if (status == OperationStatus.Done)
            return true;

        // An unpaired surrogate: step over exactly one code unit so the walk always makes progress.
        consumed = Math.Max(1, consumed);
        return false;
    }

    private static bool IsWordish(Rune rune)
    {
        if (Rune.IsLetter(rune) || Rune.IsDigit(rune))
            return true;

        return Rune.GetUnicodeCategory(rune)
            is UnicodeCategory.NonSpacingMark
            or UnicodeCategory.SpacingCombiningMark
            or UnicodeCategory.EnclosingMark;
    }

    private static bool IsConnector(Rune rune) =>
        rune.Value is '\'' or '’' or '-';

    /// <summary>
    /// Whitespace-delimited runs that are addresses rather than prose: anything holding a scheme
    /// separator, an at sign, or a leading <c>www.</c>. Their pieces are real words often enough
    /// (<c>github</c>, <c>com</c>) that checking them would flag half of every link.
    /// </summary>
    private static List<ProofingToken> FindAddressSpans(string text)
    {
        var spans = new List<ProofingToken>();
        var i = 0;
        while (i < text.Length)
        {
            while (i < text.Length && char.IsWhiteSpace(text[i]))
                i++;
            if (i >= text.Length)
                break;

            var start = i;
            while (i < text.Length && !char.IsWhiteSpace(text[i]))
                i++;

            var run = text.AsSpan(start, i - start);
            if (run.Contains("://", StringComparison.Ordinal)
                || run.Contains('@')
                || run.StartsWith("www.", StringComparison.OrdinalIgnoreCase))
            {
                spans.Add(new ProofingToken(start, i));
            }
        }

        return spans;
    }

    private static bool OverlapsAny(List<ProofingToken> spans, int start, int end)
    {
        foreach (var span in spans)
        {
            if (start < span.End && end > span.Start)
                return true;
        }

        return false;
    }
}
