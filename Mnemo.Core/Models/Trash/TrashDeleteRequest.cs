namespace Mnemo.Core.Models.Trash;

/// <summary>
/// One top-level item a delete action asks the trash to take.
/// </summary>
/// <param name="Kind">A registered source kind.</param>
/// <param name="ItemId">The item's id within that source's module.</param>
public sealed record TrashDeleteRequest(string Kind, string ItemId);
