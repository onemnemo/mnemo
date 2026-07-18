using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

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
                Math.Clamp(limit ?? DefaultPageSize, 1, MaxPageSize));

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
        });
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

            // Without this the missing deck surfaces as a raw foreign-key violation from the
            // driver, which the global handler would render as an opaque 500.
            var deck = await library.GetDeckAsync(deckId, cancellationToken).ConfigureAwait(false);
            if (deck is null)
                return Results.NotFound(new ErrorDto("unknown_deck", $"No deck '{deckId}'."));

            var draft = new FlashcardCardDraft(
                deckId,
                FlashcardWire.ParseType(body.Type),
                front,
                body.Back?.Trim() ?? string.Empty,
                NormalizeTags(body.Tags),
                Array.Empty<FlashcardAttachment>());

            var card = await cards.CreateCardAsync(draft, cancellationToken).ConfigureAwait(false);
            return Results.Ok(CardDto.FromModel(card));
        });

        endpoints.MapPut("/api/cards/{id}", async (
            string id,
            UpdateCardDto body,
            IFlashcardCardService cards,
            CancellationToken cancellationToken) =>
        {
            var front = body.Front?.Trim();
            if (string.IsNullOrEmpty(front))
                return Results.BadRequest(new ErrorDto("invalid_front", "A card front is required."));

            var existing = await cards.GetCardAsync(id, cancellationToken).ConfigureAwait(false);
            if (existing is null)
                return Results.NotFound(new ErrorDto("unknown_card", $"No card '{id}'."));

            var updated = existing with
            {
                Type = FlashcardWire.ParseType(body.Type),
                Front = front,
                Back = body.Back?.Trim() ?? string.Empty,
                Tags = NormalizeTags(body.Tags),
            };

            await cards.UpdateCardAsync(updated, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });
    }

    private static void MapBatchOperations(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/cards/delete", async (CardIdsDto body, IFlashcardCardService cards, CancellationToken cancellationToken) =>
        {
            await cards.DeleteCardsAsync(Ids(body.CardIds), cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });

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
            await cards.AddTagAsync(Ids(body.CardIds), body.Tag ?? string.Empty, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });
    }

    /// <summary>
    /// An absent or empty id list is a no-op rather than an error, so a client that fires a
    /// batch action against a selection cleared underneath it gets a quiet 204.
    /// </summary>
    private static IReadOnlyList<string> Ids(IReadOnlyList<string>? cardIds) =>
        cardIds ?? Array.Empty<string>();

    private static IReadOnlyList<string> NormalizeTags(IReadOnlyList<string>? tags) =>
        tags is null
            ? Array.Empty<string>()
            : tags.Select(t => t?.Trim() ?? string.Empty).Where(t => t.Length > 0).ToArray();
}
