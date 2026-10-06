using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters;

public sealed partial class FlashcardsAnkiFormatAdapter
{
    /// <summary>The material one image occlusion note stands for: its picture, masks and each card's schedule.</summary>
    /// <returns>Null, counted, when the picture cannot be found or copied: masks over no image are no use.</returns>
    private async Task<FlashcardFactDraft?> OcclusionMaterialAsync(
        AnkiMaterialNote note,
        OpenedApkg opened,
        CollectionInfo collectionInfo,
        IReadOnlyDictionary<long, List<AnkiRevlogRow>> revlog,
        double[] weights,
        DateTimeOffset now,
        ICollection<TransferWarning> warnings,
        ImportTally tally,
        CancellationToken cancellationToken)
    {
        var occlusion = note.Occlusion!;
        var fields = note.Note.Fields;
        string FieldText(int? position) => position is { } i && i < fields.Length ? fields[i] : string.Empty;

        // The type holds exactly one picture, so the first one on the Image field is the one kept.
        var imageTag = ImageTagRegex.Match(FieldText(occlusion.ImageField));
        IReadOnlyList<FlashcardAttachment> attachments = imageTag.Success
            ? (await BuildSideAsync(
                imageTag.Value, FlashcardAttachment.FrontSide, opened.TempDirectory, opened.Media, warnings, cancellationToken)
                .ConfigureAwait(false)).Attachments
            : [];
        if (attachments.Count == 0)
        {
            tally.OcclusionSkippedNoImage++;
            return null;
        }

        // The editor and the review show only the text of Header and Back Extra, so a picture
        // there would be copied and never seen. It is counted instead.
        var mapped = occlusion.Mapped;
        var header = await BuildTextOnlyAsync(
            FieldText(occlusion.HeaderField), FlashcardAttachment.FrontSide, opened, warnings, tally, cancellationToken)
            .ConfigureAwait(false);
        var backParts = new List<string>();
        foreach (var field in occlusion.BackFields)
        {
            backParts.Add((await BuildTextOnlyAsync(
                FieldText(field), FlashcardAttachment.BackSide, opened, warnings, tally, cancellationToken)
                .ConfigureAwait(false)).Text);
        }

        var back = string.Join(
            "\n\n", backParts.Concat(mapped.TextLabels).Where(part => !string.IsNullOrWhiteSpace(part)));

        var carried = new Dictionary<string, FlashcardImportedCard>(StringComparer.Ordinal);
        foreach (var (key, ordinal) in mapped.OrdinalByKey)
        {
            if (!note.Rows.TryGetValue(ordinal, out var row))
                continue;
            carried[key] = new FlashcardImportedCard(
                BuildImportedSchedule(row, collectionInfo.CollectionCreatedAt, revlog, weights, now, tally),
                row.Queue == AnkiQueueSuspended ? FlashcardCardState.Suspended : FlashcardCardState.Active);
        }

        tally.OcclusionTextLabels += mapped.TextLabels.Count;
        tally.OcclusionCardsWithoutShape += note.Rows.Keys.Count(ordinal => !mapped.OrdinalByKey.Values.Contains(ordinal));
        tally.OcclusionRotatedShapes += mapped.RotatedShapes;
        if (!string.IsNullOrWhiteSpace(ToPlainText(FieldText(occlusion.CommentsField))))
            tally.OcclusionCommentsLeftBehind++;

        var media = new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(StringComparer.Ordinal)
        {
            [FlashcardCardType.OcclusionImageFieldId] = [attachments[0]],
        };

        return new FlashcardFactDraft(
            Id: null,
            DeckId: string.Empty,
            TypeId: FlashcardCardType.OcclusionId,
            Values: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [FlashcardCardType.OcclusionFrontFieldId] = header.Text,
                [FlashcardCardType.OcclusionBackFieldId] = back,
                [FlashcardCardType.OcclusionMasksFieldId] = mapped.MasksJson,
            },
            Media: media,
            Tags: ParseTags(note.Note.Tags),
            Cards: carried);
    }

    /// <summary>Image Occlusion Enhanced notes gathered into sets, one per picture, and the note each set lands as.</summary>
    /// <param name="MemberOf">For each note in a set, the note the set lands as and the card it stands for.</param>
    /// <param name="Repeats">Copies of a note whose card number the set already has, left out of the import.</param>
    private sealed record EnhancedOcclusionPlan(
        IReadOnlyDictionary<long, (long LeadNoteId, int Ordinal)> MemberOf,
        IReadOnlyDictionary<long, AnkiOcclusionNote> NoteByLead,
        IReadOnlySet<long> Repeats);

    private const long MaxMaskSvgBytes = 4 * 1024 * 1024;

    /// <summary>
    /// Finds the add-on's notes and reads their mask files. A set whose masks cannot be read is
    /// left out, so its notes import as the plain cards they are.
    /// </summary>
    private static EnhancedOcclusionPlan PlanEnhancedOcclusion(
        IReadOnlyDictionary<long, NoteRow> notes,
        IReadOnlyDictionary<long, AnkiNoteType> noteTypes,
        OpenedApkg opened)
    {
        var sets = new Dictionary<(long ModelId, string SetId), List<(NoteRow Note, int Ordinal, bool HideOne)>>();
        var layouts = new Dictionary<long, EnhancedLayout>();
        foreach (var byType in notes.Values.GroupBy(n => n.ModelId))
        {
            if (!noteTypes.TryGetValue(byType.Key, out var type)
                || AnkiEnhancedOcclusion.Layout(type, [.. byType.Select(n => n.Fields)]) is not { } layout)
                continue;

            layouts[byType.Key] = layout;
            foreach (var note in byType)
            {
                if (AnkiEnhancedOcclusion.ReadId(layout.Id < note.Fields.Length ? note.Fields[layout.Id] : null) is not { } id)
                    continue;
                if (!sets.TryGetValue((note.ModelId, id.SetId), out var members))
                    sets[(note.ModelId, id.SetId)] = members = [];
                members.Add((note, id.Ordinal, id.HideOne));
            }
        }

        var memberOf = new Dictionary<long, (long, int)>();
        var noteByLead = new Dictionary<long, AnkiOcclusionNote>();
        var repeats = new HashSet<long>();
        foreach (var ((modelId, _), members) in sets)
        {
            var layout = layouts[modelId];
            var ordered = members.OrderBy(m => m.Ordinal).ThenBy(m => m.Note.Id).ToArray();
            var cards = ordered.DistinctBy(m => m.Ordinal).ToArray();
            var lead = cards[0].Note;
            var originalSvg = cards
                .Select(m => ReadMaskSvg(m.Note, layout.OriginalMask, opened))
                .FirstOrDefault(svg => svg is not null);
            var shapes = AnkiEnhancedOcclusion.Shapes(
                cards.ToDictionary(m => m.Ordinal, m => ReadMaskSvg(m.Note, layout.QuestionMask, opened)), originalSvg, cards[0].HideOne);
            if (AnkiOcclusionNote.FromEnhanced(lead.Id, layout, shapes) is not { } occlusion)
                continue;

            noteByLead[lead.Id] = occlusion;
            foreach (var card in cards)
                memberOf[card.Note.Id] = (lead.Id, card.Ordinal);
            // A copy would land as a plain card showing raw mask files, so it is counted instead.
            repeats.UnionWith(ordered.Except(cards).Select(m => m.Note.Id));
        }

        return new EnhancedOcclusionPlan(memberOf, noteByLead, repeats);
    }

    private static string? ReadMaskSvg(NoteRow note, int field, OpenedApkg opened)
    {
        if (field >= note.Fields.Length || ImageTagRegex.Match(note.Fields[field]) is not { Success: true } tag
            || ResolveMediaPath(tag.Groups["src"].Value.Trim(), opened.TempDirectory, opened.Media) is not { } path)
            return null;

        try
        {
            return new FileInfo(path).Length > MaxMaskSvgBytes ? null : File.ReadAllText(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private async Task<SideContent> BuildTextOnlyAsync(
        string html,
        string side,
        OpenedApkg opened,
        ICollection<TransferWarning> warnings,
        ImportTally tally,
        CancellationToken cancellationToken)
    {
        tally.OcclusionPicturesSkipped += ImageTagRegex.Matches(html).Count;
        return await BuildSideAsync(
            ImageTagRegex.Replace(html, string.Empty), side, opened.TempDirectory, opened.Media, warnings, cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>Which card each Anki row became, paired by the key of the mask or group it stands for.</summary>
    private static IEnumerable<(long PackageCardId, string CardId)> PairOcclusion(
        FlashcardFactSaved saved, AnkiMaterialNote note)
    {
        foreach (var card in saved.Cards)
        {
            if (card.LayoutKey is { } key
                && note.Occlusion!.Mapped.OrdinalByKey.TryGetValue(key, out var ordinal)
                && note.Rows.TryGetValue(ordinal, out var row))
                yield return (row.Id, card.Id);
        }
    }

    private static void AddOcclusionWarnings(ICollection<TransferWarning> warnings, ImportTally tally)
    {
        if (tally.OcclusionRepeatsSkipped > 0)
        {
            warnings.Add(TransferWarning.Counted(
                "AnkiOcclusionRepeatsSkippedOne", "AnkiOcclusionRepeatsSkippedMany", tally.OcclusionRepeatsSkipped));
        }

        if (tally.OcclusionCards > 0)
        {
            warnings.Add(TransferWarning.Counted(
                "AnkiOcclusionImportedOne", "AnkiOcclusionImportedMany", tally.OcclusionCards).AsInfo());
        }

        if (tally.OcclusionSkippedNoImage > 0)
        {
            warnings.Add(TransferWarning.Counted(
                "AnkiOcclusionImageMissingOne", "AnkiOcclusionImageMissingMany", tally.OcclusionSkippedNoImage));
        }

        if (tally.OcclusionCardsWithoutShape > 0)
        {
            warnings.Add(TransferWarning.Counted(
                "AnkiOcclusionCardsWithoutShapeOne", "AnkiOcclusionCardsWithoutShapeMany", tally.OcclusionCardsWithoutShape));
        }

        if (tally.OcclusionRotatedShapes > 0)
        {
            warnings.Add(TransferWarning.Counted(
                "AnkiOcclusionRotatedOne", "AnkiOcclusionRotatedMany", tally.OcclusionRotatedShapes));
        }

        if (tally.OcclusionTextLabels > 0)
        {
            warnings.Add(TransferWarning.Counted(
                "AnkiOcclusionTextToBackOne", "AnkiOcclusionTextToBackMany", tally.OcclusionTextLabels).AsInfo());
        }

        if (tally.OcclusionPicturesSkipped > 0)
        {
            warnings.Add(TransferWarning.Counted(
                "AnkiOcclusionPicturesSkippedOne", "AnkiOcclusionPicturesSkippedMany", tally.OcclusionPicturesSkipped));
        }

        if (tally.OcclusionCommentsLeftBehind > 0)
        {
            warnings.Add(TransferWarning.Counted(
                "AnkiOcclusionCommentsLeftBehindOne", "AnkiOcclusionCommentsLeftBehindMany", tally.OcclusionCommentsLeftBehind).AsInfo());
        }
    }
}
