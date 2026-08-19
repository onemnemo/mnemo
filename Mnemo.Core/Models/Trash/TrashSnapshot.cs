namespace Mnemo.Core.Models.Trash;

/// <summary>
/// The display facts a source reports about an item it is holding or is about to hold.
/// </summary>
/// <param name="Title">The item's title at the moment it was taken. Never re-read from live data.</param>
/// <param name="Origin">Display copy naming where the item came from, or null when it sat at a root.
/// This is not the restore key; the source keeps structural ids in the rows it marks.</param>
/// <param name="ContainedCount">Recoverable user-visible content that travelled with the item.
/// Not database rows, schedules, indexes, or review records.</param>
public sealed record TrashSnapshot(string Title, string? Origin, int ContainedCount);
