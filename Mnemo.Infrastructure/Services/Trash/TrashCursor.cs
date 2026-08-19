using System;
using System.Text;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// A position in the held ledger, ordered newest first by <c>(DeletedAt, Id)</c>.
/// </summary>
/// <remarks>
/// Offset paging would skip entries whenever someone restores or purges while the page is open,
/// which for a recovery surface means silently hiding something recoverable. The pair is enough
/// to resume exactly, because the ledger's unique index makes <c>Id</c> a total tiebreak.
/// </remarks>
internal static class TrashCursor
{
    private const char Separator = '|';

    /// <summary>Encodes the position just after <paramref name="entry"/>.</summary>
    public static string Encode(TrashEntry entry)
    {
        var raw = $"{SqlTime.Write(entry.DeletedAt)}{Separator}{entry.Id}";
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(raw));
    }

    /// <summary>
    /// Decodes a cursor. Returns false for anything this build did not mint, so a stale or
    /// hand-edited value restarts the listing rather than failing the request.
    /// </summary>
    public static bool TryDecode(string? cursor, out DateTimeOffset deletedAt, out string id)
    {
        deletedAt = default;
        id = string.Empty;
        if (string.IsNullOrWhiteSpace(cursor))
            return false;

        string raw;
        try
        {
            raw = Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
        }
        catch (FormatException)
        {
            return false;
        }

        var split = raw.IndexOf(Separator);
        if (split <= 0 || split == raw.Length - 1)
            return false;

        if (!DateTimeOffset.TryParse(
                raw.AsSpan(0, split),
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.RoundtripKind,
                out deletedAt))
            return false;

        id = raw[(split + 1)..];
        return true;
    }
}
