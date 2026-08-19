using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Trash;

/// <summary>
/// A module that behaves exactly as a real trash source does, and can be told to fail at any point
/// of its contract.
/// </summary>
/// <remarks>
/// The distinction that matters here is between a failure before the module's transaction commits
/// and one after it. Both look identical to the coordinator, which is why the protocol resolves
/// them by asking the source what it holds, and why every test that injects a failure has to say
/// which of the two it is.
/// </remarks>
internal sealed class FakeTrashSource : ITrashSource
{
    private readonly Dictionary<string, FakeItem> _live = new(StringComparer.Ordinal);
    private readonly Dictionary<string, FakeItem> _held = new(StringComparer.Ordinal);

    public FakeTrashSource(string kind) => Kind = kind;

    /// <inheritdoc />
    public string Kind { get; }

    /// <summary>Items the source destroyed, in the order it destroyed them.</summary>
    public List<string> Purged { get; } = [];

    /// <summary>Entry ids reconciliation asked the source to let go of.</summary>
    public List<string> Released { get; } = [];

    /// <summary>Thrown by capture. Set <see cref="CaptureCommits"/> to say whether the marks landed first.</summary>
    public Exception? CaptureFailure { get; set; }

    /// <summary>Whether the capture transaction commits before <see cref="CaptureFailure"/> is thrown.</summary>
    public bool CaptureCommits { get; set; }

    /// <summary>Items that pass preparation and then turn out not to be live at capture.</summary>
    public HashSet<string> VanishBeforeCapture { get; } = new(StringComparer.Ordinal);

    /// <summary>Thrown by restore.</summary>
    public Exception? RestoreFailure { get; set; }

    /// <summary>Whether the restore transaction commits before <see cref="RestoreFailure"/> is thrown.</summary>
    public bool RestoreCommits { get; set; }

    /// <summary>What a successful restore reports.</summary>
    public TrashRestoreOutcome RestoreOutcome { get; set; } = TrashRestoreOutcome.Restored;

    /// <summary>The container a restore reports having used.</summary>
    public string? RestoreDestinationId { get; set; }

    /// <summary>The container name a restore reports having used.</summary>
    public string? RestoreDestinationName { get; set; }

    /// <summary>Thrown by purge.</summary>
    public Exception? PurgeFailure { get; set; }

    /// <summary>Whether the purge transaction commits before <see cref="PurgeFailure"/> is thrown.</summary>
    public bool PurgeCommits { get; set; }

    /// <summary>Entries a purge reports as owning rows in the same cascade.</summary>
    public IReadOnlyList<string>? PurgeBlockers { get; set; }

    /// <summary>Thrown by the ownership probe, which is what makes an outcome uncertain.</summary>
    public Exception? HoldsFailure { get; set; }

    /// <summary>Thrown when reconciliation asks what the source holds.</summary>
    public Exception? HeldEntryIdsFailure { get; set; }

    /// <summary>Adds a live item.</summary>
    public FakeTrashSource AddLive(string itemId, string title, string? origin = null, int containedCount = 0)
    {
        _live[itemId] = new FakeItem(itemId, title, origin, containedCount);
        return this;
    }

    /// <summary>Hides an item under an entry id without going through the coordinator.</summary>
    public FakeTrashSource MarkHeld(string itemId, string entryId)
    {
        if (_live.Remove(itemId, out var item))
            _held[entryId] = item;
        return this;
    }

    /// <summary>Whether the item is visible to ordinary reads.</summary>
    public bool IsLive(string itemId) => _live.ContainsKey(itemId);

    /// <summary>How many items the source is hiding.</summary>
    public int HeldCount => _held.Count;

    /// <inheritdoc />
    public Task<TrashSnapshot?> PrepareAsync(string itemId, CancellationToken cancellationToken = default) =>
        Task.FromResult(_live.TryGetValue(itemId, out var item) ? item.ToSnapshot() : null);

    /// <inheritdoc />
    public Task<TrashSnapshot?> CaptureAsync(string itemId, string entryId, CancellationToken cancellationToken = default)
    {
        // Capturing twice under one entry id reports the same snapshot rather than taking more.
        if (_held.TryGetValue(entryId, out var already))
            return Task.FromResult<TrashSnapshot?>(already.ToSnapshot());

        if (VanishBeforeCapture.Contains(itemId) || !_live.TryGetValue(itemId, out var item))
            return Task.FromResult<TrashSnapshot?>(null);

        if (CaptureFailure is not null)
        {
            if (CaptureCommits)
            {
                _live.Remove(itemId);
                _held[entryId] = item;
            }

            throw CaptureFailure;
        }

        _live.Remove(itemId);
        _held[entryId] = item;
        return Task.FromResult<TrashSnapshot?>(item.ToSnapshot());
    }

    /// <inheritdoc />
    public Task<TrashRestore> RestoreAsync(
        string entryId,
        TrashRestoreTarget? target = null,
        CancellationToken cancellationToken = default)
    {
        if (!_held.TryGetValue(entryId, out var item))
            return Task.FromResult(new TrashRestore(TrashRestoreOutcome.Missing));

        // A target settles what an unresolved destination could not, so it always puts the item back.
        var outcome = target is not null ? TrashRestoreOutcome.Restored : RestoreOutcome;
        if (outcome is TrashRestoreOutcome.DestinationRequired or TrashRestoreOutcome.BlockedByContainer)
            return Task.FromResult(new TrashRestore(outcome));

        if (RestoreFailure is not null)
        {
            if (RestoreCommits)
            {
                _held.Remove(entryId);
                _live[item.Id] = item;
            }

            throw RestoreFailure;
        }

        _held.Remove(entryId);
        _live[item.Id] = item;
        return Task.FromResult(new TrashRestore(
            outcome,
            target?.ContainerId ?? RestoreDestinationId,
            RestoreDestinationName));
    }

    /// <inheritdoc />
    public Task<TrashPurge> PurgeAsync(string entryId, CancellationToken cancellationToken = default)
    {
        if (!_held.TryGetValue(entryId, out var item))
            return Task.FromResult(TrashPurge.Done());

        if (PurgeBlockers is { Count: > 0 } blockers)
            return Task.FromResult(TrashPurge.Blocked(blockers));

        if (PurgeFailure is not null)
        {
            if (PurgeCommits)
            {
                _held.Remove(entryId);
                Purged.Add(item.Id);
            }

            throw PurgeFailure;
        }

        _held.Remove(entryId);
        Purged.Add(item.Id);
        return Task.FromResult(TrashPurge.Done());
    }

    /// <inheritdoc />
    public Task<bool> HoldsAsync(string entryId, CancellationToken cancellationToken = default)
    {
        if (HoldsFailure is not null)
            throw HoldsFailure;
        return Task.FromResult(_held.ContainsKey(entryId));
    }

    /// <inheritdoc />
    public Task<IReadOnlyCollection<string>> HeldEntryIdsAsync(CancellationToken cancellationToken = default)
    {
        if (HeldEntryIdsFailure is not null)
            throw HeldEntryIdsFailure;
        return Task.FromResult<IReadOnlyCollection<string>>(_held.Keys.ToList());
    }

    /// <inheritdoc />
    public Task ReleaseAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default)
    {
        foreach (var entryId in entryIds)
        {
            Released.Add(entryId);
            if (_held.Remove(entryId, out var item))
                _live[item.Id] = item;
        }

        return Task.CompletedTask;
    }

    private sealed record FakeItem(string Id, string Title, string? Origin, int ContainedCount)
    {
        public TrashSnapshot ToSnapshot() => new(Title, Origin, ContainedCount);
    }
}
