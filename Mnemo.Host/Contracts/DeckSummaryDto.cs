using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Host.Contracts;

/// <summary>
/// Deck listing entry served by <c>GET /api/decks</c>. Flattens the domain
/// header/summary split into one API shape. Hand-mirrored in
/// <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// </summary>
public sealed record DeckSummaryDto(
    string Id,
    string? FolderId,
    string Name,
    string? Description,
    IReadOnlyList<string> Tags,
    int SortOrder,
    int TotalCards,
    int ActiveCards,
    int SuspendedCards,
    DueCountsDto DueCounts,
    int RetentionPercent,
    DateTimeOffset? LastStudied,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt)
{
    public static DeckSummaryDto FromModel(FlashcardDeckSummary model)
        => new(
            model.Header.Id,
            model.Header.FolderId,
            model.Header.Name,
            model.Header.Description,
            model.Header.Tags,
            model.Header.SortOrder,
            model.TotalCards,
            model.ActiveCards,
            model.SuspendedCards,
            DueCountsDto.FromModel(model.DueCounts),
            model.RetentionPercent,
            model.Header.LastStudied,
            model.Header.CreatedAt,
            model.Header.UpdatedAt);
}
