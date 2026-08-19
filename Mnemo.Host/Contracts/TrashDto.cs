using Mnemo.Core.Models.Trash;

namespace Mnemo.Host.Contracts;

/// <summary>
/// One recoverable item. Hand-mirrored in <c>mnemo-web/src/trash/types.ts</c>; the C# side is
/// authoritative.
/// </summary>
/// <param name="SourceAvailable">
/// False when this build ships no module for the kind. The row is still shown, so a person can see
/// their content is preserved, but it cannot be restored or destroyed here.
/// </param>
public sealed record TrashEntryDto(
    string Id,
    string Kind,
    string ItemId,
    string Title,
    string? Origin,
    int ContainedCount,
    string BatchId,
    DateTime DeletedAt,
    DateTime ExpiresAt,
    bool SourceAvailable)
{
    /// <summary>Maps a ledger entry whose source this build ships.</summary>
    public static TrashEntryDto FromModel(TrashEntry model) => FromModel(model, sourceAvailable: true);

    /// <summary>Maps a ledger entry, saying whether a source claims its kind.</summary>
    public static TrashEntryDto FromModel(TrashEntry model, bool sourceAvailable) => new(
        model.Id,
        model.Kind,
        model.ItemId,
        model.Title,
        model.Origin,
        model.ContainedCount,
        model.BatchId,
        model.DeletedAt.UtcDateTime,
        model.ExpiresAt.UtcDateTime,
        sourceAvailable);
}

/// <summary>
/// What a delete action produced. Every module delete endpoint answers with this shape, so one
/// presenter can raise the Undo toast for all of them.
/// </summary>
public sealed record TrashActionDto(string BatchId, IReadOnlyList<TrashEntryDto> Entries, int SkippedCount)
{
    /// <summary>Maps one delete action.</summary>
    public static TrashActionDto FromModel(TrashAction model) => new(
        model.BatchId,
        model.Entries.Select(TrashEntryDto.FromModel).ToList(),
        model.SkippedCount);
}

/// <summary>One page of the trash, newest first.</summary>
/// <param name="NextCursor">Pass back as <c>cursor</c> for the following page, or null at the end.</param>
public sealed record TrashPageDto(IReadOnlyList<TrashEntryDto> Entries, string? NextCursor)
{
    /// <summary>Maps one page.</summary>
    public static TrashPageDto FromModel(TrashPage model) => new(
        model.Entries.Select(e => TrashEntryDto.FromModel(e.Entry, e.SourceAvailable)).ToList(),
        model.NextCursor);
}

/// <summary>The number the sidebar badge shows.</summary>
public sealed record TrashCountDto(int Count);

/// <summary>A request to put entries back.</summary>
/// <param name="EntryIds">Exactly the ids a delete action returned.</param>
/// <param name="DestinationId">
/// A live container for a kind that cannot sit at a root, supplied after a first attempt reported
/// that one is required.
/// </param>
public sealed record TrashRestoreRequestDto(IReadOnlyList<string>? EntryIds, string? DestinationId);

/// <summary>What happened to one entry a restore touched.</summary>
/// <param name="Outcome">
/// One of <c>restored</c>, <c>missing</c>, <c>rooted</c>, <c>destination_required</c>, or
/// <c>container_held</c>.
/// </param>
public sealed record TrashRestoreResultDto(
    string EntryId,
    string Kind,
    string ItemId,
    string Title,
    string Outcome,
    string? DestinationId,
    string? DestinationName)
{
    /// <summary>Maps one restore result.</summary>
    public static TrashRestoreResultDto FromModel(TrashRestoreResult model) => new(
        model.EntryId,
        model.Kind,
        model.ItemId,
        model.Title,
        OutcomeCode(model.Outcome),
        model.DestinationId,
        model.DestinationName);

    private static string OutcomeCode(TrashRestoreOutcome outcome) => outcome switch
    {
        TrashRestoreOutcome.Restored => "restored",
        TrashRestoreOutcome.Missing => "missing",
        TrashRestoreOutcome.Rooted => "rooted",
        TrashRestoreOutcome.DestinationRequired => "destination_required",
        TrashRestoreOutcome.BlockedByContainer => "container_held",
        _ => "missing",
    };
}

/// <summary>
/// The result of one restore request.
/// </summary>
/// <param name="RestoredCount">Entries that came back, at their original place or at a root.</param>
/// <param name="PendingCount">
/// Entries still held because they need a destination or their container is held. Copy reports
/// partial completion from this rather than claiming the whole batch returned.
/// </param>
public sealed record TrashRestoreResponseDto(
    IReadOnlyList<TrashRestoreResultDto> Results,
    int RestoredCount,
    int PendingCount)
{
    /// <summary>Maps one restore request's results.</summary>
    public static TrashRestoreResponseDto FromModel(IReadOnlyList<TrashRestoreResult> results)
    {
        var restored = results.Count(r =>
            r.Outcome is TrashRestoreOutcome.Restored or TrashRestoreOutcome.Rooted);
        var pending = results.Count(r =>
            r.Outcome is TrashRestoreOutcome.DestinationRequired or TrashRestoreOutcome.BlockedByContainer);
        return new TrashRestoreResponseDto(
            results.Select(TrashRestoreResultDto.FromModel).ToList(),
            restored,
            pending);
    }
}

/// <summary>What happened to one entry a permanent deletion touched.</summary>
public sealed record TrashPurgeResultDto(
    string EntryId,
    string Title,
    bool Purged,
    IReadOnlyList<string> BlockingEntryIds)
{
    /// <summary>Maps one purge result.</summary>
    public static TrashPurgeResultDto FromModel(TrashPurgeResult model) => new(
        model.EntryId,
        model.Title,
        model.Purged,
        model.BlockingEntryIds);
}

/// <summary>What emptying the trash destroyed, and what it could not.</summary>
public sealed record TrashEmptyResultDto(int PurgedCount, IReadOnlyList<TrashPurgeResultDto> Blocked)
{
    /// <summary>Maps one empty result.</summary>
    public static TrashEmptyResultDto FromModel(TrashEmptyResult model) => new(
        model.PurgedCount,
        model.Blocked.Select(TrashPurgeResultDto.FromModel).ToList());
}
