using System;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// One file whose last owning rows are gone and which is waiting to be removed from disk.
/// </summary>
/// <param name="Id">Job identity.</param>
/// <param name="Owner">Which asset store the path belongs to, so the right one is asked to delete it.</param>
/// <param name="Path">The stored path, in whatever form that owner's asset store understands.</param>
/// <param name="EnqueuedAt">When the owning rows were removed.</param>
/// <param name="Attempts">How many times deletion has been tried and failed.</param>
/// <param name="LastError">Why the most recent attempt failed, or null when none has.</param>
public sealed record AssetCleanupJob(
    string Id,
    string Owner,
    string Path,
    DateTimeOffset EnqueuedAt,
    int Attempts,
    string? LastError);
