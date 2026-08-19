using System.Collections.Generic;

namespace Mnemo.Core.Models.Trash;

/// <summary>
/// The result of one delete action.
/// </summary>
/// <param name="BatchId">Minted for the entries captured by this action.</param>
/// <param name="Entries">
/// The entries that now hold the requested items. An overlapping selection, or an item that
/// stopped being live between the request and capture, produces fewer entries than the
/// request contained, and an entry that already existed keeps its original batch id.
/// </param>
/// <param name="SkippedCount">Requested items that produced no entry.</param>
public sealed record TrashAction(string BatchId, IReadOnlyList<TrashEntry> Entries, int SkippedCount);
