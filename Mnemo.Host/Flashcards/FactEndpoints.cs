using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Services.Flashcards.Trash;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// Card types and the material that fills them. Cards are made from material rather than authored,
/// so nothing here writes a card directly: a save hands back the cards the material now has.
/// </summary>
public static class FactEndpoints
{
    public static void MapFlashcardFacts(this IEndpointRouteBuilder endpoints)
    {
        MapCardTypes(endpoints);
        MapFacts(endpoints);
    }

    private static void MapCardTypes(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/card-types", async (IFlashcardFactService facts, CancellationToken cancellationToken) =>
        {
            var types = await facts.ListCardTypesAsync(cancellationToken).ConfigureAwait(false);
            var summaries = new List<CardTypeSummaryDto>(types.Count);
            foreach (var type in types)
            {
                var count = await facts.CountFactsUsingTypeAsync(type.Id, cancellationToken).ConfigureAwait(false);
                summaries.Add(new CardTypeSummaryDto(CardTypeDto.FromModel(type), count));
            }

            return summaries;
        });

        endpoints.MapGet("/api/card-types/{id}", async (string id, IFlashcardFactService facts, CancellationToken cancellationToken) =>
        {
            var type = await facts.GetCardTypeAsync(id, cancellationToken).ConfigureAwait(false);
            return type is null
                ? Results.NotFound(new ErrorDto("unknown_card_type", $"No card type '{id}'."))
                : Results.Ok(CardTypeDto.FromModel(type));
        });

        endpoints.MapPost("/api/card-types", (SaveCardTypeDto body, IFlashcardFactService facts, CancellationToken cancellationToken) =>
            SaveCardTypeAsync(body, body.Id, facts, cancellationToken));

        endpoints.MapPut("/api/card-types/{id}", (string id, SaveCardTypeDto body, IFlashcardFactService facts, CancellationToken cancellationToken) =>
            SaveCardTypeAsync(body, id, facts, cancellationToken));

        endpoints.MapDelete("/api/card-types/{id}", async (string id, IFlashcardFactService facts, CancellationToken cancellationToken) =>
        {
            try
            {
                var deleted = await facts.DeleteCardTypeAsync(id, cancellationToken).ConfigureAwait(false);
                return deleted
                    ? Results.NoContent()
                    : Results.NotFound(new ErrorDto("unknown_card_type", $"No card type '{id}', or it ships with the app."));
            }
            catch (InvalidOperationException ex)
            {
                return Results.Conflict(new ErrorDto("card_type_in_use", ex.Message));
            }
        });
    }

    private static async Task<IResult> SaveCardTypeAsync(
        SaveCardTypeDto body,
        string? id,
        IFlashcardFactService facts,
        CancellationToken cancellationToken)
    {
        var name = body.Name?.Trim();
        if (string.IsNullOrEmpty(name))
            return Results.BadRequest(new ErrorDto("invalid_name", "A card type needs a name."));
        if (FlashcardTextValidation.TooLong(name, FlashcardTextLimits.MaxNameLength, "invalid_name", "A card type name", out var nameError))
            return nameError;

        var typeId = string.IsNullOrWhiteSpace(id) ? Guid.NewGuid().ToString("N") : id.Trim();
        var existing = await facts.GetCardTypeAsync(typeId, cancellationToken).ConfigureAwait(false);

        var fields = (body.Fields ?? Array.Empty<CardTypeFieldDto>()).Select(f => f.ToModel()).ToList();
        var sortFieldId = string.IsNullOrWhiteSpace(body.SortFieldId)
            ? fields.FirstOrDefault()?.Id ?? string.Empty
            : body.SortFieldId.Trim();

        var type = new FlashcardCardType(
            Id: typeId,
            Name: name,
            // The service refuses to un-built-in a built in type; a client cannot claim to be one.
            IsBuiltIn: existing?.IsBuiltIn ?? false,
            Fields: fields,
            SortFieldId: sortFieldId,
            Layouts: (body.Layouts ?? Array.Empty<CardTypeLayoutDto>()).Select(l => l.ToModel()).ToList(),
            // Changing a generator would change how many cards every fact using this type makes, so
            // it is whatever the stored type says and is never taken from the request.
            Generator: existing?.Generator,
            GenerateFrom: existing?.GenerateFrom);

        try
        {
            var saved = await facts.SaveCardTypeAsync(type, cancellationToken).ConfigureAwait(false);
            return Results.Ok(CardTypeDto.FromModel(saved));
        }
        catch (ArgumentException ex)
        {
            return Results.BadRequest(new ErrorDto("invalid_card_type", ex.Message));
        }
    }

    private static void MapFacts(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/facts/{id}", async (string id, IFlashcardFactService facts, CancellationToken cancellationToken) =>
        {
            var fact = await facts.GetFactAsync(id, cancellationToken).ConfigureAwait(false);
            return fact is null
                ? Results.NotFound(new ErrorDto("unknown_fact", $"No material '{id}'."))
                : Results.Ok(FactDto.FromModel(fact));
        });

        // Opening the editor from a card someone clicked in the deck table.
        endpoints.MapGet("/api/cards/{id}/fact", async (string id, IFlashcardFactService facts, CancellationToken cancellationToken) =>
        {
            var fact = await facts.GetFactForCardAsync(id, cancellationToken).ConfigureAwait(false);
            return fact is null
                ? Results.NotFound(new ErrorDto("unknown_fact", $"Card '{id}' has no material behind it."))
                : Results.Ok(FactDto.FromModel(fact));
        });

        endpoints.MapPost("/api/facts", (
            SaveFactDto body,
            IFlashcardFactService facts,
            IFlashcardLibraryService library,
            CancellationToken cancellationToken) => SaveFactAsync(body, body.Id, facts, library, cancellationToken));

        endpoints.MapPut("/api/facts/{id}", (
            string id,
            SaveFactDto body,
            IFlashcardFactService facts,
            IFlashcardLibraryService library,
            CancellationToken cancellationToken) => SaveFactAsync(body, id, facts, library, cancellationToken));

        // Deleting material takes every card it makes, wherever those cards were filed, because a
        // card without its material has nothing left to generate or edit it. All of it comes back
        // together, so this is one entry rather than one per card.
        endpoints.MapPost("/api/facts/delete", async (
            FactIdsDto body,
            ITrashService trash,
            CancellationToken cancellationToken) =>
        {
            var requests = (body.FactIds ?? Array.Empty<string>())
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Select(id => new TrashDeleteRequest(FlashcardFactTrashSource.TrashKind, id))
                .ToArray();
            if (requests.Length == 0)
                return Results.BadRequest(new ErrorDto("no_facts", "Deleting needs at least one piece of material."));

            var action = await trash.DeleteAsync(requests, cancellationToken).ConfigureAwait(false);
            return Results.Ok(TrashActionDto.FromModel(action));
        }).RequireTrash();
    }

    private static async Task<IResult> SaveFactAsync(
        SaveFactDto body,
        string? id,
        IFlashcardFactService facts,
        IFlashcardLibraryService library,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(body.DeckId))
            return Results.BadRequest(new ErrorDto("invalid_deck", "Material belongs to a deck."));

        if (body.Values is not null)
        {
            foreach (var value in body.Values.Values)
            {
                if ((value?.Length ?? 0) > FlashcardTextLimits.MaxFieldValueLength)
                {
                    return Results.BadRequest(new ErrorDto(
                        "invalid_value",
                        $"A field value must be {FlashcardTextLimits.MaxFieldValueLength} characters or fewer."));
                }
            }
        }

        var existing = string.IsNullOrWhiteSpace(id)
            ? null
            : await facts.GetFactAsync(id, cancellationToken).ConfigureAwait(false);
        if (!string.IsNullOrWhiteSpace(id) && existing is null)
            return Results.NotFound(new ErrorDto("unknown_fact", $"No material '{id}'."));

        var deckId = await ResolveDeckAsync(body.DeckId, existing, library, cancellationToken).ConfigureAwait(false);
        if (deckId is null)
            return Results.NotFound(new ErrorDto("unknown_deck", $"No deck '{body.DeckId}'."));

        var draft = new FlashcardFactDraft(
            Id: existing?.Id,
            DeckId: deckId,
            TypeId: body.TypeId?.Trim() ?? string.Empty,
            Values: NormalizeValues(body.Values),
            Media: ResolveMedia(body.Media, existing),
            Tags: FlashcardTextValidation.NormalizeTags(body.Tags));

        try
        {
            var saved = await facts.SaveFactAsync(draft, cancellationToken).ConfigureAwait(false);
            return Results.Ok(FactSavedDto.FromModel(saved));
        }
        catch (ArgumentException ex)
        {
            return Results.BadRequest(new ErrorDto("invalid_fact", ex.Message));
        }
    }

    /// <summary>
    /// The deck a save should file its material under, or null when there is no such deck to be had.
    /// </summary>
    /// <remarks>
    /// Checking at all is what keeps a missing deck from surfacing as a raw foreign-key violation
    /// from the driver, which the global handler would render as an opaque 500.
    /// <para>
    /// The deck named in the request is an editor's copy of what the material said when it was
    /// opened, and material goes on naming the deck it was written in after a card it made has been
    /// moved elsewhere, so that name can outlive the deck itself. An edit arriving with a name that
    /// no longer resolves is therefore a stale copy rather than a request to file the material
    /// somewhere impossible, and the stored material knows better than the copy does.
    /// </para>
    /// </remarks>
    private static async Task<string?> ResolveDeckAsync(
        string requestedDeckId,
        FlashcardFact? existing,
        IFlashcardLibraryService library,
        CancellationToken cancellationToken)
    {
        if (await library.GetDeckAsync(requestedDeckId, cancellationToken).ConfigureAwait(false) is not null)
            return requestedDeckId;

        if (existing is null || string.Equals(existing.DeckId, requestedDeckId, StringComparison.Ordinal))
            return null;

        return await library.GetDeckAsync(existing.DeckId, cancellationToken).ConfigureAwait(false) is null
            ? null
            : existing.DeckId;
    }

    private static IReadOnlyDictionary<string, string> NormalizeValues(IReadOnlyDictionary<string, string>? values)
    {
        if (values is null || values.Count == 0)
            return new Dictionary<string, string>(StringComparer.Ordinal);

        var map = new Dictionary<string, string>(values.Count, StringComparer.Ordinal);
        foreach (var (fieldId, value) in values)
        {
            if (!string.IsNullOrWhiteSpace(fieldId))
                map[fieldId.Trim()] = value ?? string.Empty;
        }

        return map;
    }

    /// <summary>
    /// Maps the editor's per-field attachment lists onto stored attachments. Entries naming an
    /// attachment the material already has are reused untouched, which is how an attachment the
    /// host cannot serve survives a round trip through the browser; entries naming an uploaded
    /// asset become new attachments sized from the file on disk, so a client cannot claim a size
    /// it did not upload. Anything resolving to neither is dropped rather than failing the save.
    /// </summary>
    private static IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>> ResolveMedia(
        IReadOnlyList<FactMediaInputDto>? media,
        FlashcardFact? existing)
    {
        var resolved = new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(StringComparer.Ordinal);
        if (media is null || media.Count == 0)
            return resolved;

        var carried = (existing?.Media.Values.SelectMany(list => list) ?? Enumerable.Empty<FlashcardAttachment>())
            .GroupBy(a => a.Id, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var field in media)
        {
            if (string.IsNullOrWhiteSpace(field.FieldId) || field.Attachments is not { Count: > 0 })
                continue;

            var list = new List<FlashcardAttachment>(field.Attachments.Count);
            foreach (var input in field.Attachments)
            {
                var attachment = Resolve(input, carried);
                // A duplicate id would let one attachment be counted twice against the cap and
                // would break the reuse lookup on the next save.
                if (attachment is null || !seen.Add(attachment.Id))
                    continue;
                if (list.Count >= IFlashcardCardService.MaxAttachmentsPerSide)
                    break;
                list.Add(attachment);
            }

            if (list.Count > 0)
                resolved[field.FieldId.Trim()] = list;
        }

        return resolved;
    }

    private static FlashcardAttachment? Resolve(
        CardAttachmentInputDto input,
        IReadOnlyDictionary<string, FlashcardAttachment> carried)
    {
        if (!string.IsNullOrEmpty(input.Id) && carried.TryGetValue(input.Id, out var existing))
            return existing with { Caption = input.Caption };

        if (FlashcardAssetStore.ResolvePath(input.AssetId) is not { } path || !File.Exists(path))
            return null;

        var assetId = input.AssetId!;
        return new FlashcardAttachment(
            Id: FlashcardAssetStore.AttachmentIdForAssetId(assetId),
            // A layout decides which side its fields land on, so the stored side is a placeholder
            // the materializer rewrites per card.
            Side: FlashcardAttachment.FrontSide,
            FilePath: path,
            DisplayName: string.IsNullOrWhiteSpace(input.DisplayName) ? assetId : input.DisplayName,
            SizeBytes: new FileInfo(path).Length,
            Caption: input.Caption);
    }

}
