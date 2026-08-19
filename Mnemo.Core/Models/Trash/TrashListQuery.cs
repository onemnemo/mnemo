namespace Mnemo.Core.Models.Trash;

/// <summary>
/// One page request against the held ledger, newest first.
/// </summary>
/// <param name="Cursor">Opaque position from a previous page, or null to start at the newest entry.</param>
/// <param name="Limit">How many entries to return. Callers clamp this before it arrives.</param>
/// <param name="Kind">Restrict to one source kind, or null for every kind.</param>
/// <param name="Query">Case-insensitive title match. Blank matches everything.</param>
public sealed record TrashListQuery(string? Cursor = null, int Limit = 50, string? Kind = null, string? Query = null);
