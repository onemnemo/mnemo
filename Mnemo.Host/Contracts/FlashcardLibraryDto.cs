using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Host.Contracts;

/// <summary>
/// A library folder. Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>; the C# side
/// is authoritative.
/// </summary>
public sealed record FolderDto(string Id, string Name, string? ParentId, int Order)
{
    public static FolderDto FromModel(FlashcardFolder model)
        => new(model.Id, model.Name, model.ParentId, model.Order);
}

/// <summary>Folder create/update body. The id comes from the route on update.</summary>
public sealed record SaveFolderDto(string Name, string? ParentId, int Order);

/// <summary>Deck create body. A null preset falls back to the shared Standard preset.</summary>
public sealed record CreateDeckDto(string Name, string? FolderId, string? PresetId);

/// <summary>
/// Deck update body. Full replace of the editable header fields rather than a patch:
/// with JSON alone an absent field and an explicit null are indistinguishable, so a
/// patch shape could never clear the description.
/// </summary>
public sealed record UpdateDeckDto(string Name, string? Description, IReadOnlyList<string>? Tags, string? Icon);

/// <summary>Re-homes a deck into a folder (null = library root) at a given position.</summary>
public sealed record MoveDeckDto(string? FolderId, int SortOrder);

/// <summary>One entry of a bulk deck reorder.</summary>
public sealed record DeckOrderEntryDto(string DeckId, string? FolderId, int SortOrder)
{
    public FlashcardOrderEntry ToModel() => new(DeckId, FolderId, SortOrder);
}

/// <summary>
/// A day on the retention trend. <c>Day</c> is an ISO date (the domain models it as a
/// <c>DateOnly</c>, which carries no time or zone and must not gain one on the wire).
/// </summary>
public sealed record RetentionTrendPointDto(string Day, int RetentionPercent, int ReviewsCount)
{
    public static RetentionTrendPointDto FromModel(FlashcardRetentionTrendPoint model)
        => new(model.Day.ToString("yyyy-MM-dd"), model.RetentionPercent, model.ReviewsCount);
}
