namespace Mnemo.Core.Models.Trash;

/// <summary>
/// A source's answer to one restore request.
/// </summary>
/// <param name="Outcome">What the source did.</param>
/// <param name="DestinationId">Id of the container the item now sits in, or null for a root.</param>
/// <param name="DestinationName">Display name of that container, so the caller can say where it went.</param>
public sealed record TrashRestore(
    TrashRestoreOutcome Outcome,
    string? DestinationId = null,
    string? DestinationName = null);
