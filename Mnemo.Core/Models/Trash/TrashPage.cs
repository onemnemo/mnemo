using System.Collections.Generic;

namespace Mnemo.Core.Models.Trash;

/// <summary>
/// One page of held entries.
/// </summary>
/// <param name="Entries">Newest first.</param>
/// <param name="NextCursor">Position to ask for the following page, or null at the end of the ledger.</param>
public sealed record TrashPage(IReadOnlyList<TrashListing> Entries, string? NextCursor);
