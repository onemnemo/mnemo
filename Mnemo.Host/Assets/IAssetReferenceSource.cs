namespace Mnemo.Host.Assets;

/// <summary>
/// One module's answer to "which stored assets does your persisted data still reference?".
/// The sweep engine is module-agnostic; each module that keeps uploads contributes one of
/// these, and a directory shared by several modules sweeps against the union of all of them.
/// </summary>
public interface IAssetReferenceSource
{
    /// <summary>
    /// False while the module's persisted data cannot be trusted yet (a migration is still
    /// running or has failed). A sweep never deletes based on a corpus it distrusts.
    /// </summary>
    bool IsReady { get; }

    /// <summary>
    /// Every asset reference in the module's persisted data, as either a full asset id
    /// (<c>name.ext</c>) or a bare id without extension. The sweeper keeps a file when
    /// either its name or its name-without-extension appears here.
    /// </summary>
    Task<IReadOnlyCollection<string>> CollectReferencedIdsAsync(CancellationToken cancellationToken = default);
}
