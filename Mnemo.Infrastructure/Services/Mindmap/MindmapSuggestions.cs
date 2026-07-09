using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Infrastructure.Services.Mindmap;

/// <summary>
/// Nearest-text id suggestions for a not-found element reference. A small model mistypes short ids, so
/// when an id does not resolve we offer the closest existing element ids (by edit distance) with a snippet
/// of their text. The single home for this so the service's edit path and the tool layer never diverge.
/// </summary>
internal static class MindmapSuggestions
{
    private const int MaxDistance = 2;
    private const int MaxSuggestions = 3;
    private const int TextCap = 24;

    /// <summary>
    /// Up to three existing element ids within <see cref="MaxDistance"/> edits of <paramref name="missingId"/>,
    /// each formatted <c>"{id}: {truncated text}"</c>, nearest first. Null when nothing is close enough.
    /// </summary>
    public static IReadOnlyList<string>? NearestElementIds(IEnumerable<MindmapElement> elements, string missingId)
    {
        if (string.IsNullOrEmpty(missingId))
            return null;

        var ranked = new List<(int Distance, string Id, string Text)>();
        foreach (var element in elements)
        {
            var distance = BoundedLevenshtein(missingId, element.Id, MaxDistance);
            if (distance > MaxDistance)
                continue;
            ranked.Add((distance, element.Id, MindmapSearchText.Extract(element)));
        }

        if (ranked.Count == 0)
            return null;

        return ranked
            .OrderBy(r => r.Distance)
            .ThenBy(r => r.Id, StringComparer.Ordinal)
            .Take(MaxSuggestions)
            .Select(r => Format(r.Id, r.Text))
            .ToList();
    }

    private static string Format(string id, string text)
    {
        if (string.IsNullOrEmpty(text))
            return id;
        var trimmed = text.Length <= TextCap ? text : text[..TextCap] + "…";
        return $"{id}: {trimmed}";
    }

    /// <summary>
    /// Levenshtein distance with an early-out at <paramref name="max"/> — short ids make the full table
    /// trivial, and the bound skips far-apart candidates outright. Returns <c>max + 1</c> when past the bound.
    /// </summary>
    private static int BoundedLevenshtein(string a, string b, int max)
    {
        if (Math.Abs(a.Length - b.Length) > max)
            return max + 1;

        var previous = new int[b.Length + 1];
        var current = new int[b.Length + 1];
        for (var j = 0; j <= b.Length; j++)
            previous[j] = j;

        for (var i = 1; i <= a.Length; i++)
        {
            current[0] = i;
            var rowMin = current[0];
            for (var j = 1; j <= b.Length; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                current[j] = Math.Min(Math.Min(previous[j] + 1, current[j - 1] + 1), previous[j - 1] + cost);
                rowMin = Math.Min(rowMin, current[j]);
            }

            if (rowMin > max)
                return max + 1;

            (previous, current) = (current, previous);
        }

        return previous[b.Length];
    }
}
