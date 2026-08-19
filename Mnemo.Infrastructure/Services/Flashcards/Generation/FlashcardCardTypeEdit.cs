using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Generation;

/// <summary>
/// What has to hold for a card type to be saveable, and what has to follow when one is edited.
/// </summary>
public static class FlashcardCardTypeEdit
{
    private static readonly Regex FieldPattern = new(@"\{\{([^{}]+)\}\}", RegexOptions.Compiled);

    /// <summary>
    /// Carries a field rename into the templates that mention it, because a template names a field
    /// by its name. Without this, renaming a field would silently blank whatever it filled in.
    /// </summary>
    public static FlashcardCardType CarryRenames(FlashcardCardType? previous, FlashcardCardType next)
    {
        ArgumentNullException.ThrowIfNull(next);
        if (previous is null)
            return next;

        var renamed = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var before in previous.Fields)
        {
            var after = next.Fields.FirstOrDefault(f => string.Equals(f.Id, before.Id, StringComparison.Ordinal));
            if (after is null || string.Equals(after.Name.Trim(), before.Name.Trim(), StringComparison.Ordinal))
                continue;
            renamed[before.Name.Trim()] = after.Name.Trim();
        }

        if (renamed.Count == 0)
            return next;

        return next with
        {
            Layouts =
            [
                .. next.Layouts.Select(layout => layout with
                {
                    Front = Rewrite(layout.Front, renamed),
                    Back = Rewrite(layout.Back, renamed),
                })
            ],
        };
    }

    /// <summary>
    /// Throws when a card type could not do its job. Everything checked here is something the
    /// editor should have stopped first; this is the line the store is not crossed at.
    /// </summary>
    public static void Validate(FlashcardCardType type)
    {
        ArgumentNullException.ThrowIfNull(type);

        if (string.IsNullOrWhiteSpace(type.Id))
            throw new ArgumentException("A card type needs an id.", nameof(type));
        if (string.IsNullOrWhiteSpace(type.Name))
            throw new ArgumentException("A card type needs a name.", nameof(type));
        if (type.Fields.Count == 0)
            throw new ArgumentException("A card type needs at least one field.", nameof(type));

        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var field in type.Fields)
        {
            if (string.IsNullOrWhiteSpace(field.Id))
                throw new ArgumentException("Every field needs an id.", nameof(type));
            if (string.IsNullOrWhiteSpace(field.Name))
                throw new ArgumentException("Every field needs a name.", nameof(type));
            if (!ids.Add(field.Id))
                throw new ArgumentException($"Two fields share the id '{field.Id}'.", nameof(type));
        }

        if (!ids.Contains(type.SortFieldId))
            throw new ArgumentException("The sort field is not one of the fields.", nameof(type));

        if (!string.IsNullOrEmpty(type.Generator))
        {
            if (!ids.Contains(type.EffectiveGenerateFrom))
                throw new ArgumentException("The field cards are generated from is not one of the fields.", nameof(type));
            // A generated type makes its cards from the content, so a layout list would be a
            // promise nothing keeps.
            return;
        }

        if (type.Layouts.Count == 0)
            throw new ArgumentException("A card type needs at least one card, or a generator.", nameof(type));

        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var layout in type.Layouts)
        {
            if (string.IsNullOrWhiteSpace(layout.Id))
                throw new ArgumentException("Every card needs an id.", nameof(type));
            if (!keys.Add(layout.Id))
                throw new ArgumentException($"Two cards share the id '{layout.Id}'.", nameof(type));
            if (!string.IsNullOrEmpty(layout.Requires) && !ids.Contains(layout.Requires))
                throw new ArgumentException($"Card '{layout.Id}' waits on a field that does not exist.", nameof(type));
        }
    }

    private static string Rewrite(string? template, Dictionary<string, string> renamed)
    {
        if (string.IsNullOrEmpty(template))
            return string.Empty;

        // One pass over the markers rather than a replace per rename, so two fields swapping names
        // come out swapped instead of both landing on the same one.
        return FieldPattern.Replace(template, match =>
            renamed.TryGetValue(match.Groups[1].Value.Trim(), out var name)
                ? $"{{{{{name}}}}}"
                : match.Value);
    }
}
