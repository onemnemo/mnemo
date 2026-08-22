using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Generation;

/// <summary>
/// Turns a card type and a fact into the cards they currently make. Pure and side effect free, so
/// it can be called wherever a count is shown rather than storing one that goes stale.
/// </summary>
/// <remarks>
/// The web editor keeps a matching copy so it can show the count while someone types, before
/// anything is saved. The two must agree; the tests either side cover the same cases.
/// </remarks>
public static class FlashcardGeneration
{
    /// <summary>What a masked deletion reads as when it carries no hint.</summary>
    public const string ClozePlaceholder = "[…]";

    /// <summary>
    /// What a deletion or its hint may contain: anything at all, except a blank line and except
    /// the start of the next deletion.
    /// </summary>
    /// <remarks>
    /// A deletion is allowed to wrap a line, because a deletion long enough to be a clause is
    /// normally typed as one. It is not allowed to cross a blank line, which is where one thought
    /// ends and the marker was clearly left unclosed. Refusing the next deletion's opening is what
    /// keeps a half typed <c>{{c1::</c> from swallowing the finished marker after it, which is the
    /// case a plain <c>.</c> used to rule out by stopping at the first newline.
    /// </remarks>
    private const string ClozeBody = @"(?:(?!\r?\n\r?\n|\{\{c\d+::)[\s\S])+?";

    private static readonly Regex ClozePattern = new(
        @"\{\{c(\d+)::(" + ClozeBody + @")(?:::(" + ClozeBody + @"))?\}\}", RegexOptions.Compiled);

    private static readonly Regex FieldPattern = new(
        @"\{\{([^{}]+)\}\}", RegexOptions.Compiled);

    private static readonly Regex BlankRunPattern = new(@"\n{3,}", RegexOptions.Compiled);

    /// <summary>
    /// The deletion numbers present in a piece of text, ascending and deduplicated. A number too
    /// large to be one is ignored rather than throwing, since it came from typed text.
    /// </summary>
    public static IReadOnlyList<int> ClozeOrdinals(string? text)
    {
        if (string.IsNullOrEmpty(text))
            return [];

        var found = new SortedSet<int>();
        foreach (Match match in ClozePattern.Matches(text))
        {
            if (int.TryParse(match.Groups[1].Value, out var ordinal))
                found.Add(ordinal);
        }

        return [.. found];
    }

    /// <summary>
    /// One cloze card's view of the text: its own deletion hidden, every other one shown.
    /// </summary>
    /// <remarks>
    /// The other deletions are the context that makes the question answerable. Blanking all of
    /// them at once, which one card per paragraph forces, turns a question into a puzzle.
    /// A <c>::hint</c> is shown in place of the placeholder where one was written.
    /// </remarks>
    public static string MaskCloze(string? text, int ordinal, bool reveal)
    {
        if (string.IsNullOrEmpty(text))
            return string.Empty;

        return ClozePattern.Replace(text, match =>
        {
            var answer = match.Groups[2].Value;
            if (!int.TryParse(match.Groups[1].Value, out var n) || n != ordinal || reveal)
                return answer;

            var hint = match.Groups[3];
            return hint.Success ? $"[{hint.Value}]" : ClozePlaceholder;
        });
    }

    /// <summary>Field names a template mentions, in the order they appear.</summary>
    public static IReadOnlyList<string> FieldsUsed(string? template)
    {
        if (string.IsNullOrEmpty(template))
            return [];

        return [.. FieldPattern.Matches(template).Select(m => m.Groups[1].Value.Trim())];
    }

    /// <summary>
    /// Substitutes <c>{{Field}}</c> markers against a fact. A marker naming a field the type no
    /// longer has is dropped rather than printed, along with the blank line it leaves behind, so a
    /// stale layout looks thin instead of showing markup to someone mid review.
    /// </summary>
    public static string RenderSide(string? template, FlashcardCardType type, FlashcardFact fact)
    {
        ArgumentNullException.ThrowIfNull(type);
        ArgumentNullException.ThrowIfNull(fact);
        if (string.IsNullOrEmpty(template))
            return string.Empty;

        var byName = FieldIdsByName(type);
        var substituted = FieldPattern.Replace(template, match =>
        {
            var name = match.Groups[1].Value.Trim();
            return byName.TryGetValue(name, out var id) ? fact.Value(id).Trim() : string.Empty;
        });

        return BlankRunPattern.Replace(substituted, "\n\n").Trim();
    }

    /// <summary>Every card a fact currently makes, in the order they are shown.</summary>
    public static IReadOnlyList<FlashcardGeneratedCard> Generate(FlashcardCardType type, FlashcardFact fact)
    {
        ArgumentNullException.ThrowIfNull(type);
        ArgumentNullException.ThrowIfNull(fact);

        var source = type.EffectiveGenerateFrom;

        if (string.Equals(type.Generator, FlashcardGenerators.Cloze, StringComparison.Ordinal))
            return GenerateCloze(type, fact, source);

        if (string.Equals(type.Generator, FlashcardGenerators.Occlusion, StringComparison.Ordinal))
            return GenerateOcclusion(type, fact, source);

        return
        [
            .. type.Layouts
                .Where(layout => Filled(fact, layout.Requires))
                .Select(layout => new FlashcardGeneratedCard(
                    Key: layout.Id,
                    LayoutName: layout.Name,
                    Front: RenderSide(layout.Front, type, fact),
                    Back: RenderSide(layout.Back, type, fact),
                    FrontMedia: MediaFor(layout.Front, type, fact),
                    BackMedia: MediaFor(layout.Back, type, fact)))
        ];
    }

    /// <summary>
    /// Layouts that exist but are not firing, with the field that would switch each one on.
    /// Empty for a generated type, whose cards come from the content rather than from a list.
    /// </summary>
    public static IReadOnlyList<FlashcardDormantLayout> Dormant(FlashcardCardType type, FlashcardFact fact)
    {
        ArgumentNullException.ThrowIfNull(type);
        ArgumentNullException.ThrowIfNull(fact);
        if (!string.IsNullOrEmpty(type.Generator))
            return [];

        return
        [
            .. type.Layouts
                .Where(layout => !Filled(fact, layout.Requires))
                .Select(layout => new FlashcardDormantLayout(
                    layout,
                    type.Fields.FirstOrDefault(f => string.Equals(f.Id, layout.Requires, StringComparison.Ordinal))?.Name ?? string.Empty))
        ];
    }

    /// <summary>The key a cloze deletion number is stored under.</summary>
    public static string ClozeKey(int ordinal) => $"c{ordinal}";

    /// <summary>The deletion number a cloze key names, or null when the key is not one.</summary>
    public static int? ClozeOrdinalFromKey(string? key) =>
        key is { Length: > 1 } && key[0] == 'c' && int.TryParse(key[1..], out var ordinal)
            ? ordinal
            : null;

    private static IReadOnlyList<FlashcardGeneratedCard> GenerateCloze(
        FlashcardCardType type, FlashcardFact fact, string source)
    {
        var text = fact.Value(source);
        var extra = type.Fields.FirstOrDefault(f => !string.Equals(f.Id, source, StringComparison.Ordinal));
        var tail = extra is null ? string.Empty : fact.Value(extra.Id).Trim();
        var extraMedia = extra is null ? [] : fact.MediaOn(extra.Id);

        return
        [
            .. ClozeOrdinals(text).Select(ordinal => new FlashcardGeneratedCard(
                Key: ClozeKey(ordinal),
                LayoutName: null,
                Front: MaskCloze(text, ordinal, reveal: false),
                Back: JoinParagraphs([MaskCloze(text, ordinal, reveal: true), tail]),
                // The figure stays up while the text is blanked. It is what the sentence is read
                // against, not the answer to it.
                FrontMedia: fact.MediaOn(source),
                BackMedia: extraMedia))
        ];
    }

    private static IReadOnlyList<FlashcardGeneratedCard> GenerateOcclusion(
        FlashcardCardType type, FlashcardFact fact, string source)
    {
        var rest = type.Fields
            .Where(f => !string.Equals(f.Id, source, StringComparison.Ordinal))
            .ToArray();

        return
        [
            new FlashcardGeneratedCard(
                Key: "m1",
                LayoutName: null,
                Front: fact.Value(source),
                Back: JoinParagraphs(rest.Select(f => fact.Value(f.Id).Trim())),
                FrontMedia: fact.MediaOn(source),
                BackMedia: [.. rest.SelectMany(f => fact.MediaOn(f.Id))])
        ];
    }

    private static Dictionary<string, string> FieldIdsByName(FlashcardCardType type)
    {
        // Assignment rather than Add: two fields sharing a name is a state the type editor can
        // pass through, and the later one winning matches how a template reads top to bottom.
        var byName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var field in type.Fields)
            byName[field.Name.Trim()] = field.Id;
        return byName;
    }

    private static IReadOnlyList<FlashcardAttachment> MediaFor(
        string? template, FlashcardCardType type, FlashcardFact fact)
    {
        if (fact.Media.Count == 0)
            return [];

        var byName = FieldIdsByName(type);
        return
        [
            .. FieldsUsed(template)
                .Where(name => byName.ContainsKey(name))
                .SelectMany(name => fact.MediaOn(byName[name]))
        ];
    }

    private static bool Filled(FlashcardFact fact, string? fieldId) =>
        string.IsNullOrEmpty(fieldId) || fact.Value(fieldId).Trim().Length > 0;

    private static string JoinParagraphs(IEnumerable<string> parts) =>
        string.Join("\n\n", parts.Where(p => !string.IsNullOrEmpty(p)));
}
