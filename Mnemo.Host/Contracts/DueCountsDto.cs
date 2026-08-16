using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Host.Contracts;

/// <summary>
/// Due-count buckets for a deck. Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>;
/// the C# side is authoritative.
/// </summary>
public sealed record DueCountsDto(int New, int Learning, int Due, int Total)
{
    public static DueCountsDto FromModel(FlashcardDueCounts model)
        => new(model.New, model.Learning, model.Due, model.Total);
}
