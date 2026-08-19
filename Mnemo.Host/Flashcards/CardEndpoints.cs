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
/// Card querying, single-card CRUD and the batch operations behind the deck page.
/// </summary>
/// <remarks>
/// The card query applies no preset limits, so its Due/New results are raw. The deck header's
/// counts come from <c>GET /api/decks/{id}</c> and are clipped to the preset's daily budget, so
/// a deck past its cap legitimately shows fewer due cards in the header than the Due filter
/// lists rows. That matches the desktop app; the two numbers answer different questions.
/// </remarks>
public static class CardEndpoints
{
    private const int DefaultPageSize = 50;
    private const int MaxPageSize = 200;

    /// <summary>Page size used when sweeping a deck to collect its distinct tags.</summary>
    private const int TagScanPageSize = 500;

    public static void MapFlashcardCards(this IEndpointRouteBuilder endpoints)
    {
        MapQueries(endpoints);
        MapCardCrud(endpoints);
        MapBatchOperations(endpoints);
    }

    private static void MapQueries(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/decks/{deckId}/cards", async (
            string deckId,
            string? text,
            string? state,
            string? tag,
            string? sort,
            bool? desc,
            int? offset,
            int? limit,
            string? type,
            int? minLapses,
            int? maxLapses,
            IFlashcardCardService cards,
            CancellationToken cancellationToken) =>
        {
            // Clamped here rather than left to the repository, which clamps for the SQL but
            // echoes back whatever was asked for. The client renders its range label from
            // these, so they have to be the values actually used.
            var query = new FlashcardCardQuery(
                deckId,
                text,
                FlashcardWire.ParseStateFilter(state),
                tag,
                FlashcardWire.ParseSort(sort),
                desc ?? false,
                Math.Max(0, offset ?? 0),
                Math.Clamp(limit ?? DefaultPageSize, 1, MaxPageSize),
                FlashcardWire.ParseTypeOrNull(type),
                minLapses is { } min ? Math.Max(0, min) : null,
                maxLapses is { } max ? Math.Max(0, max) : null);

            var page = await cards.ListCardsAsync(query, cancellationToken).ConfigureAwait(false);
            return CardPageDto.FromModel(page);
        });

        // Collection-wide counterpart to the deck-scoped query above: the same filter set with
        // no deck pinned, for the browser that lists cards across every deck at once.
        endpoints.MapGet("/api/cards", async (
            string? deckId,
            string? text,
            string? state,
            string? tag,
            string? sort,
            bool? desc,
            int? offset,
            int? limit,
            string? type,
            int? minLapses,
            int? maxLapses,
            string? cardTypeId,
            IFlashcardCardService cards,
            CancellationToken cancellationToken) =>
        {
            var query = new FlashcardCardQuery(
                string.IsNullOrWhiteSpace(deckId) ? null : deckId,
                text,
                FlashcardWire.ParseStateFilter(state),
                tag,
                FlashcardWire.ParseSort(sort),
                desc ?? false,
                Math.Max(0, offset ?? 0),
                Math.Clamp(limit ?? DefaultPageSize, 1, MaxPageSize),
                FlashcardWire.ParseTypeOrNull(type),
                minLapses is { } min ? Math.Max(0, min) : null,
                maxLapses is { } max ? Math.Max(0, max) : null,
                string.IsNullOrWhiteSpace(cardTypeId) ? null : cardTypeId);

            var page = await cards.ListCardsAsync(query, cancellationToken).ConfigureAwait(false);
            return CardPageDto.FromModel(page);
        });

        // Backs the deck page's tag filter menu. The card service has no tag-projection
        // query, so the list is assembled by sweeping the deck - the same thing the desktop
        // does, moved to the server so opening the menu costs one request instead of one
        // per page of cards.
        endpoints.MapGet("/api/decks/{deckId}/card-tags", async (
            string deckId,
            IFlashcardCardService cards,
            CancellationToken cancellationToken) =>
            await SweepTagsAsync(cards, deckId, cancellationToken).ConfigureAwait(false));

        // Collection-wide counterpart: the browser's tag filter menu has no deck to sweep, so
        // it sweeps the whole library.
        endpoints.MapGet("/api/card-tags", async (
            IFlashcardCardService cards,
            CancellationToken cancellationToken) =>
            await SweepTagsAsync(cards, null, cancellationToken).ConfigureAwait(false));
    }

    private static async Task<List<string>> SweepTagsAsync(IFlashcardCardService cards, string? deckId, CancellationToken cancellationToken)
    {
        var tags = new SortedSet<string>(StringComparer.CurrentCultureIgnoreCase);
        for (var offset = 0; ; offset += TagScanPageSize)
        {
            var page = await cards
                .ListCardsAsync(new FlashcardCardQuery(deckId, Offset: offset, Limit: TagScanPageSize), cancellationToken)
                .ConfigureAwait(false);

            foreach (var view in page.Items)
            {
                foreach (var tag in view.Card.Tags)
                    tags.Add(tag);
            }

            if (offset + TagScanPageSize >= page.TotalCount)
                break;
        }

        return tags.ToList();
    }

    private static void MapCardCrud(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/cards/{id}", async (string id, IFlashcardCardService cards, CancellationToken cancellationToken) =>
        {
            var card = await cards.GetCardAsync(id, cancellationToken).ConfigureAwait(false);
            return card is null
                ? Results.NotFound(new ErrorDto("unknown_card", $"No card '{id}'."))
                : Results.Ok(CardDto.FromModel(card));
        });

        endpoints.MapPost("/api/decks/{deckId}/cards", async (
            string deckId,
            CreateCardDto body,
            IFlashcardCardService cards,
            IFlashcardLibraryService library,
            CancellationToken cancellationToken) =>
        {
            var front = body.Front?.Trim();
            if (string.IsNullOrEmpty(front))
                return Results.BadRequest(new ErrorDto("invalid_front", "A card front is required."));
            if (FlashcardTextValidation.TooLong(front, FlashcardTextLimits.MaxFieldValueLength, "invalid_front", "A card front", out var frontError))
                return frontError;

            var back = body.Back?.Trim() ?? string.Empty;
            if (FlashcardTextValidation.TooLong(back, FlashcardTextLimits.MaxFieldValueLength, "invalid_back", "A card back", out var backError))
                return backError;

            // Without this the missing deck surfaces as a raw foreign-key violation from the
            // driver, which the global handler would render as an opaque 500.
            var deck = await library.GetDeckAsync(deckId, cancellationToken).ConfigureAwait(false);
            if (deck is null)
                return Results.NotFound(new ErrorDto("unknown_deck", $"No deck '{deckId}'."));

            if (!TryResolveAttachments(body.Attachments, Array.Empty<FlashcardAttachment>(), out var attachments, out var attachmentError))
                return Results.BadRequest(attachmentError);

            var draft = new FlashcardCardDraft(
                deckId,
                FlashcardWire.ParseType(body.Type),
                front,
                back,
                FlashcardTextValidation.NormalizeTags(body.Tags),
                attachments);

            var card = await cards.CreateCardAsync(draft, cancellationToken).ConfigureAwait(false);
            return Results.Ok(CardDto.FromModel(card));
        });

        endpoints.MapPut("/api/cards/{id}", async (
            string id,
            UpdateCardDto body,
            IFlashcardCardService cards,
            IFlashcardLibraryService library,
            IImageAssetService images,
            CancellationToken cancellationToken) =>
        {
            var front = body.Front?.Trim();
            if (string.IsNullOrEmpty(front))
                return Results.BadRequest(new ErrorDto("invalid_front", "A card front is required."));
            if (FlashcardTextValidation.TooLong(front, FlashcardTextLimits.MaxFieldValueLength, "invalid_front", "A card front", out var frontError))
                return frontError;

            var back = body.Back?.Trim() ?? string.Empty;
            if (FlashcardTextValidation.TooLong(back, FlashcardTextLimits.MaxFieldValueLength, "invalid_back", "A card back", out var backError))
                return backError;

            var existing = await cards.GetCardAsync(id, cancellationToken).ConfigureAwait(false);
            if (existing is null)
                return Results.NotFound(new ErrorDto("unknown_card", $"No card '{id}'."));

            var deckId = existing.DeckId;
            if (!string.IsNullOrWhiteSpace(body.DeckId) && body.DeckId != deckId)
            {
                var target = await library.GetDeckAsync(body.DeckId, cancellationToken).ConfigureAwait(false);
                if (target is null)
                    return Results.NotFound(new ErrorDto("unknown_deck", $"No deck '{body.DeckId}'."));
                deckId = body.DeckId;
            }

            if (!TryResolveAttachments(body.Attachments, existing.Attachments, out var attachments, out var attachmentError))
                return Results.BadRequest(attachmentError);

            var updated = existing with
            {
                DeckId = deckId,
                Type = FlashcardWire.ParseType(body.Type),
                Front = front,
                Back = back,
                Tags = FlashcardTextValidation.NormalizeTags(body.Tags),
                Attachments = attachments,
                // The stored blocks are a render cache over the canonical text, so a content
                // edit has to drop them or the card would keep rendering its previous body.
                FrontBlocks = null,
                BackBlocks = null,
            };

            await cards.UpdateCardAsync(updated, cancellationToken).ConfigureAwait(false);
            await DeleteDroppedAttachmentsAsync(existing.Attachments, attachments, images, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });
    }

    /// <summary>
    /// Maps the editor's attachment list onto stored attachments, keeping the order it was sent
    /// in. Entries naming an attachment the card already has are reused untouched; entries
    /// naming an uploaded asset become new attachments sized from the file on disk, so a client
    /// cannot claim a size it did not upload.
    /// </summary>
    private static bool TryResolveAttachments(
        IReadOnlyList<CardAttachmentInputDto>? inputs,
        IReadOnlyList<FlashcardAttachment> existing,
        out IReadOnlyList<FlashcardAttachment> resolved,
        out ErrorDto? error)
    {
        error = null;
        resolved = Array.Empty<FlashcardAttachment>();
        if (inputs is null || inputs.Count == 0)
            return true;

        var byId = existing.ToDictionary(a => a.Id, StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var list = new List<FlashcardAttachment>(inputs.Count);

        foreach (var input in inputs)
        {
            var side = string.Equals(input.Side, FlashcardAttachment.BackSide, StringComparison.OrdinalIgnoreCase)
                ? FlashcardAttachment.BackSide
                : FlashcardAttachment.FrontSide;

            FlashcardAttachment? attachment = null;
            if (!string.IsNullOrEmpty(input.Id) && byId.TryGetValue(input.Id, out var carried))
            {
                attachment = carried with { Side = side, Caption = input.Caption };
            }
            else if (FlashcardAssetStore.ResolvePath(input.AssetId) is { } path && File.Exists(path))
            {
                var assetId = input.AssetId!;
                var displayName = string.IsNullOrWhiteSpace(input.DisplayName) ? assetId : input.DisplayName;
                attachment = new FlashcardAttachment(
                    FlashcardAssetStore.AttachmentIdForAssetId(assetId),
                    side,
                    path,
                    displayName,
                    new FileInfo(path).Length,
                    input.Caption);
            }

            // A duplicate id would let one attachment be counted twice against the per-side cap
            // and would break the reuse lookup on the next save.
            if (attachment is null || !seen.Add(attachment.Id))
                continue;

            list.Add(attachment);
        }

        foreach (var side in new[] { FlashcardAttachment.FrontSide, FlashcardAttachment.BackSide })
        {
            var count = list.Count(a => string.Equals(a.Side, side, StringComparison.OrdinalIgnoreCase));
            if (count > IFlashcardCardService.MaxAttachmentsPerSide)
            {
                error = new ErrorDto(
                    "too_many_attachments",
                    $"A card side takes at most {IFlashcardCardService.MaxAttachmentsPerSide} attachments.");
                return false;
            }
        }

        resolved = list;
        return true;
    }

    /// <summary>
    /// Removes the stored files of attachments the edit dropped, once the card that referenced
    /// them has been saved. The desktop deletes on the click instead, which loses the file even
    /// if the dialog is then cancelled; waiting until the save has landed costs nothing and
    /// keeps a cancelled edit non-destructive. A failed delete only leaves an orphan file, so it
    /// must not fail the request.
    /// </summary>
    private static async Task DeleteDroppedAttachmentsAsync(
        IReadOnlyList<FlashcardAttachment> before,
        IReadOnlyList<FlashcardAttachment> after,
        IImageAssetService images,
        CancellationToken cancellationToken)
    {
        var kept = after.Select(a => a.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var dropped in before.Where(a => !kept.Contains(a.Id)))
        {
            // Only managed copies are ours to delete - an imported card can point at a file the
            // user still has elsewhere on disk.
            if (FlashcardAssetStore.AssetIdForPath(dropped.FilePath) is null)
                continue;
            await images.DeleteStoredFileAsync(dropped.FilePath, cancellationToken).ConfigureAwait(false);
        }
    }

    private static void MapBatchOperations(IEndpointRouteBuilder endpoints)
    {
        // Deleted cards keep their schedules and their review history for thirty days. Cards deleted
        // together share one batch, so Undo brings back everything the one action took.
        endpoints.MapPost("/api/cards/delete", async (
            CardIdsDto body,
            ITrashService trash,
            CancellationToken cancellationToken) =>
        {
            var requests = Ids(body.CardIds)
                .Select(id => new TrashDeleteRequest(FlashcardCardTrashSource.TrashKind, id))
                .ToArray();
            if (requests.Length == 0)
                return Results.BadRequest(new ErrorDto("no_cards", "Deleting needs at least one card."));

            var action = await trash.DeleteAsync(requests, cancellationToken).ConfigureAwait(false);
            return Results.Ok(TrashActionDto.FromModel(action));
        }).RequireTrash();

        endpoints.MapPost("/api/cards/move", async (
            MoveCardsDto body,
            IFlashcardCardService cards,
            IFlashcardLibraryService library,
            CancellationToken cancellationToken) =>
        {
            var deck = await library.GetDeckAsync(body.TargetDeckId, cancellationToken).ConfigureAwait(false);
            if (deck is null)
                return Results.NotFound(new ErrorDto("unknown_deck", $"No deck '{body.TargetDeckId}'."));

            await cards.MoveCardsAsync(Ids(body.CardIds), body.TargetDeckId, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });

        endpoints.MapPost("/api/cards/suspend", async (CardToggleDto body, IFlashcardCardService cards, CancellationToken cancellationToken) =>
        {
            await cards.SetSuspendedAsync(Ids(body.CardIds), body.Value, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });

        endpoints.MapPost("/api/cards/flag", async (CardToggleDto body, IFlashcardCardService cards, CancellationToken cancellationToken) =>
        {
            await cards.SetFlaggedAsync(Ids(body.CardIds), body.Value, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });

        endpoints.MapPost("/api/cards/tag", async (AddCardTagDto body, IFlashcardCardService cards, CancellationToken cancellationToken) =>
        {
            var tag = (body.Tag ?? string.Empty).Trim();
            if (tag.Length > FlashcardTextLimits.MaxTagLength)
                tag = tag[..FlashcardTextLimits.MaxTagLength];

            await cards.AddTagAsync(Ids(body.CardIds), tag, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });
    }

    /// <summary>
    /// An absent or empty id list is a no-op rather than an error, so a client that fires a
    /// batch action against a selection cleared underneath it gets a quiet 204.
    /// </summary>
    private static IReadOnlyList<string> Ids(IReadOnlyList<string>? cardIds) =>
        cardIds ?? Array.Empty<string>();

}
