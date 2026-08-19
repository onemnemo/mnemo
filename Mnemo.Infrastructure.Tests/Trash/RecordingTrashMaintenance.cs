using Mnemo.Infrastructure.Services.Trash;

namespace Mnemo.Infrastructure.Tests.Trash;

/// <summary>
/// Counts the background passes the coordinator asks for. An uncertain outcome is only safe
/// because something comes along afterwards to resolve it, so the ask is part of the contract.
/// </summary>
internal sealed class RecordingTrashMaintenance : ITrashMaintenance
{
    /// <summary>How many times an operation could not resolve an entry itself.</summary>
    public int ReconciliationRequests { get; private set; }

    /// <summary>How many times a destruction left files to remove.</summary>
    public int AssetCleanupRequests { get; private set; }

    /// <inheritdoc />
    public void RequestReconciliation() => ReconciliationRequests++;

    /// <inheritdoc />
    public void RequestAssetCleanup() => AssetCleanupRequests++;
}
