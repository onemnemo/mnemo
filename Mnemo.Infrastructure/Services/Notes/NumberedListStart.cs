using System.Text.Json;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Notes;

/// <summary>
/// The number a run of numbered items starts at. Only the run's first item stores it; every later
/// item shows the start plus its place. The per-item numbers older imports wrote under other keys
/// are never read, so a note from before shows the numbers it always showed.
/// </summary>
internal static class NumberedListStart
{
    /// <summary>The meta key the start is stored under.</summary>
    public const string Key = "listStart";

    private const double Largest = 999_999_999;

    /// <summary>
    /// The start <paramref name="first"/> gives its run, <paramref name="listDepth"/> list items
    /// down: the stored whole number from 0 up, else 1. A 0 counts only at a decimal depth, since
    /// the letter and roman labels below it have no zero.
    /// </summary>
    public static int Of(Block first, int listDepth)
    {
        if (Stored(first) is not int start)
            return 1;
        return start == 0 && listDepth % 3 != 0 ? 1 : start;
    }

    /// <summary>The start <paramref name="block"/> stores, or null when it stores none.</summary>
    public static int? Stored(Block block)
    {
        if (!block.Meta.TryGetValue(Key, out var value) || value is null)
            return null;
        double? n = value switch
        {
            int i => i,
            long l => l,
            double d => d,
            JsonElement { ValueKind: JsonValueKind.Number } je => je.GetDouble(),
            _ => null
        };
        return n is double v && v >= 0 && v <= Largest && v == System.Math.Floor(v) ? (int)v : null;
    }
}
