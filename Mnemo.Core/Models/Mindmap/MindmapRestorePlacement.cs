namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// Where a row a <see cref="MindmapRestoreDelta"/> puts back belongs: directly after the row
/// <see cref="AfterId"/>, or first in its array when that is null.
/// <para>
/// Element order is root order and hierarchy edge order is sibling order, and neither is a field on the
/// row itself, so a delta that only listed the rows to restore would send every one of them to the end.
/// One anchor per restored row is what it costs to put a deleted first child back first, and it keeps
/// the delta proportional to the change rather than to the document.
/// </para>
/// </summary>
public sealed record MindmapRestorePlacement(string Id, string? AfterId);
