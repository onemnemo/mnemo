using System;

namespace Mnemo.Core.Models.Trash;

/// <summary>
/// One row of the trash ledger: one top-level item a person asked to delete, not one row per
/// storage row in the cascade behind it.
/// </summary>
public sealed record TrashEntry
{
    /// <summary>Ledger identity. Sources stamp this id onto every row they capture.</summary>
    public required string Id { get; init; }

    /// <summary>The registered source kind that owns this entry.</summary>
    public required string Kind { get; init; }

    /// <summary>The captured item's own id within its module.</summary>
    public required string ItemId { get; init; }

    /// <summary>Title snapshot taken at capture.</summary>
    public required string Title { get; init; }

    /// <summary>Display copy naming where the item came from, or null when it sat at a root.</summary>
    public string? Origin { get; init; }

    /// <summary>Recoverable user-visible content captured alongside the item.</summary>
    public int ContainedCount { get; init; }

    /// <summary>Groups every entry minted by one delete action, so Undo can restore them together.</summary>
    public required string BatchId { get; init; }

    /// <summary>Where this row sits in the delete protocol.</summary>
    public required TrashEntryState State { get; init; }

    /// <summary>When the person deleted the item.</summary>
    public required DateTimeOffset DeletedAt { get; init; }

    /// <summary>When the expiry sweep becomes eligible to purge the entry.</summary>
    public required DateTimeOffset ExpiresAt { get; init; }
}
