namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// The background passes the trash coordinator can ask for. Both requests are advisory: the
/// coordinator has already committed a consistent state and only wants the pass to happen sooner
/// than its next scheduled run.
/// </summary>
public interface ITrashMaintenance
{
    /// <summary>
    /// Asks for a reconciliation pass, after an operation could not learn whether a source holds
    /// an entry. The ledger row is left in the state that pass knows how to resolve.
    /// </summary>
    void RequestReconciliation();

    /// <summary>
    /// Asks for a cleanup pass, after a purge committed database deletion and queued the files it
    /// owned. Waiting for the next scheduled pass would only delay reclaiming disk.
    /// </summary>
    void RequestAssetCleanup();
}
