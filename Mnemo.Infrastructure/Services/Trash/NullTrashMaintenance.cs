namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// Drops maintenance requests. Used where no background loop is running, such as a test that
/// drives reconciliation itself.
/// </summary>
public sealed class NullTrashMaintenance : ITrashMaintenance
{
    /// <summary>The single instance.</summary>
    public static readonly NullTrashMaintenance Instance = new();

    /// <inheritdoc />
    public void RequestReconciliation()
    {
    }

    /// <inheritdoc />
    public void RequestAssetCleanup()
    {
    }
}
