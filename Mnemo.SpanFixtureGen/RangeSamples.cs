using Mnemo.Core.Models;

namespace Mnemo.SpanFixtureGen;

/// <summary>Generates (start, end) caret ranges, weighted toward the edge cases the span algorithms special-case.</summary>
public static class RangeSamples
{
    public static (int start, int end) PickRange(ref SplitMix64 rng, int total, IReadOnlyList<InlineSpan> spans)
    {
        switch (rng.NextInt(0, 12))
        {
            case 0: return (0, 0);
            case 1: return (total, total);
            case 2: return (-rng.NextInt(1, 6), rng.NextInt(0, total + 1)); // negative start, in-bounds end
            case 3: return (rng.NextInt(0, total + 1), total + rng.NextInt(1, 6)); // in-bounds start, overflowing end
            case 4: return (-rng.NextInt(3, 10), -rng.NextInt(1, 3)); // fully negative
            case 5: return (total + rng.NextInt(1, 4), total + rng.NextInt(5, 12)); // fully beyond the end
            case 6: return (0, total); // the whole document
            case 7: return (total, 0); // reversed (start > end)
            case 8: return AtomRange(ref rng, spans, total, offset => (offset, offset + 1)); // exactly covers an atom
            case 9: return AtomRange(ref rng, spans, total, offset => (offset - 1, offset)); // stops just before an atom
            case 10: return AtomRange(ref rng, spans, total, offset => (offset - 1, offset + 1)); // atom plus one char before
            case 11: return (total / 2, total / 2); // empty range mid-document
            default: return RandomInBounds(ref rng, total);
        }
    }

    private static (int, int) AtomRange(
        ref SplitMix64 rng, IReadOnlyList<InlineSpan> spans, int total, Func<int, (int, int)> fromAtomOffset)
    {
        var offset = FindAtomOffset(ref rng, spans);
        return offset is { } o ? fromAtomOffset(o) : RandomInBounds(ref rng, total);
    }

    private static (int, int) RandomInBounds(ref SplitMix64 rng, int total)
    {
        if (total == 0) return (0, 0);
        int a = rng.NextInt(0, total + 1);
        int b = rng.NextInt(0, total + 1);
        return a <= b ? (a, b) : (b, a);
    }

    /// <summary>Caret offset of a randomly chosen atom (equation/fraction) span, or null if the list has none.</summary>
    private static int? FindAtomOffset(ref SplitMix64 rng, IReadOnlyList<InlineSpan> spans)
    {
        var offsets = new List<int>();
        int offset = 0;
        foreach (var span in spans)
        {
            if (span is EquationSpan or FractionSpan) offsets.Add(offset);
            offset += span is TextSpan t ? t.Text.Length : 1;
        }
        return offsets.Count == 0 ? null : offsets[rng.NextInt(0, offsets.Count)];
    }
}
