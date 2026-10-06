using System;
using System.Collections.Generic;
using System.Linq;

namespace Mnemo.Core.Models.Flashcards;

/// <summary>The masks that are asked together as one card, and the key that card is stored under.</summary>
public sealed record OcclusionUnit(string Key, IReadOnlyList<OcclusionMask> Members);

/// <summary>What <see cref="FlashcardOcclusionUnits.Build"/> found in a document.</summary>
/// <param name="Collisions">Keys a later unit claimed after an earlier one already held them.</param>
public sealed record OcclusionUnitSet(IReadOnlyList<OcclusionUnit> Units, IReadOnlyList<string> Collisions);

/// <summary>Turns a document into its cards: one per ungrouped mask and one per group.</summary>
public static class FlashcardOcclusionUnits
{
    /// <summary>The key a card made from a mask id or a group label is stored under.</summary>
    public static string KeyFor(string idOrGroup) => $"m{idOrGroup}";

    /// <summary>
    /// A group is one unit placed where its first member sits. A unit that reuses a key is dropped and reported.
    /// </summary>
    public static OcclusionUnitSet Build(OcclusionDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);

        var ordered = document.Masks
            .OrderBy(m => m.Order)
            .ThenBy(m => m.Id, StringComparer.Ordinal)
            .ToArray();

        var byName = new Dictionary<string, List<OcclusionMask>>(StringComparer.Ordinal);
        var names = new List<string>();
        foreach (var mask in ordered)
        {
            var name = mask.Group is { Length: > 0 } ? $"g:{mask.Group}" : $"i:{mask.Id}";
            if (!byName.TryGetValue(name, out var members))
            {
                byName[name] = members = [];
                names.Add(name);
            }

            members.Add(mask);
        }

        var units = new List<OcclusionUnit>(names.Count);
        var collisions = new List<string>();
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var name in names)
        {
            var members = byName[name];
            var key = KeyFor(members[0].Group is { Length: > 0 } group ? group : members[0].Id);
            if (keys.Add(key))
                units.Add(new OcclusionUnit(key, members));
            else
                collisions.Add(key);
        }

        return new OcclusionUnitSet(units, collisions);
    }

    /// <summary>The answer text of a unit: its labels in member order, blanks skipped, joined by commas.</summary>
    public static string LabelOf(OcclusionUnit unit) =>
        string.Join(", ", unit.Members.Select(m => m.Label?.Trim()).Where(l => !string.IsNullOrEmpty(l)));

    /// <summary>The heading a list shows for a card: question and label, or the type's name when both are blank.</summary>
    public static string TitleOf(string? front, string? back)
    {
        var question = front?.Trim() ?? string.Empty;
        var label = back?.Trim() ?? string.Empty;
        if (question.Length > 0 && label.Length > 0)
            return $"{question}: {label}";

        var either = question.Length > 0 ? question : label;
        return either.Length > 0 ? either : FlashcardCardType.OcclusionName;
    }
}
