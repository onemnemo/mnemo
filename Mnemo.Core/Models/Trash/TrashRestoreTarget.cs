namespace Mnemo.Core.Models.Trash;

/// <summary>
/// A live container chosen by the caller for an item that cannot be restored to a root.
/// </summary>
/// <param name="ContainerId">Id of the destination. The source validates that it is live before using it.</param>
public sealed record TrashRestoreTarget(string ContainerId);
