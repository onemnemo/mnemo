using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// The batch operations that move cards in time behind the deck page's reschedule dialog, and the
/// queue size the dialog quotes when it places new cards.
/// </summary>
/// <remarks>
/// Like the other batch card routes, an absent or empty id list is a quiet 204, and ids that name
/// nothing live are skipped rather than failing the batch.
/// </remarks>
public static class RescheduleEndpoints
{
    /// <summary>
    /// A hundred years, the furthest the scheduler itself will ever put a card. Anything past it
    /// is a typo, not a plan.
    /// </summary>
    private const int MaxDays = 36500;

    public static void MapFlashcardReschedule(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/cards/reschedule/due", async (
            SetCardsDueDto body,
            IFlashcardRescheduleService reschedule,
            CancellationToken cancellationToken) =>
        {
            if (body.Days < 0 || body.Days > MaxDays)
                return Results.BadRequest(new ErrorDto("invalid_days", $"A due date is between 0 and {MaxDays} days from today."));

            await reschedule.SetDueAsync(Ids(body.CardIds), body.Days, body.MatchInterval, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });

        endpoints.MapPost("/api/cards/reschedule/reset", async (
            ResetCardsDto body,
            IFlashcardRescheduleService reschedule,
            CancellationToken cancellationToken) =>
        {
            await reschedule.ResetAsync(Ids(body.CardIds), body.KeepCounts, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });

        endpoints.MapPost("/api/cards/reschedule/position", async (
            RepositionCardsDto body,
            IFlashcardRescheduleService reschedule,
            CancellationToken cancellationToken) =>
        {
            if (!FlashcardWire.TryParseQueuePlacement(body.Place, out var placement))
                return Results.BadRequest(new ErrorDto("invalid_place", "A placement is start, end or at."));

            var position = Math.Max(1, body.Position ?? 1);
            await reschedule.RepositionAsync(Ids(body.CardIds), placement, position, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });

        endpoints.MapGet("/api/decks/{deckId}/new-queue", async (
            string deckId,
            IFlashcardRescheduleService reschedule,
            CancellationToken cancellationToken) =>
            new NewQueueDto(await reschedule.CountNewQueueAsync(deckId, cancellationToken).ConfigureAwait(false)));
    }

    private static IReadOnlyList<string> Ids(IReadOnlyList<string>? cardIds) =>
        cardIds ?? Array.Empty<string>();
}
