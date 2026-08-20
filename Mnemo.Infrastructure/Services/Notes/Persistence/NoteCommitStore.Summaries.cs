using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Notes.Persistence;

/// <summary>
/// The bodyless half of the note reader: the fields a list of notes shows, projected out of the
/// stored rows without parsing the blocks sitting beside them.
/// </summary>
/// <remarks>
/// <para>
/// Listing the library used to load every note whole, one connection and one round trip each, and
/// then throw every body away. On a real corpus that is the whole database parsed to answer a
/// question about thirteen scalars. This reads the same rows in one statement and never builds a
/// block.
/// </para>
/// <para>
/// It is a read, so it stays off the writer connection. A listing that queued behind whatever is
/// being written would give back what the per-note loop already gave away.
/// </para>
/// </remarks>
public sealed partial class NoteCommitStore : INoteSummaryStore
{
    /// <summary>
    /// One row per wanted key, body left in the database.
    /// <para>
    /// The keys arrive as a JSON array rather than as bound parameters so a single statement covers a
    /// library of any size; a parameter per note runs into the per-statement variable ceiling once a
    /// corpus grows.
    /// </para>
    /// <para>
    /// The COALESCE defaults are the model's own defaults for a key an older build never wrote: a note
    /// from before the version counter reads as version zero, and one from before short ids reads as
    /// holding none. Those rows are real and still in the corpus.
    /// </para>
    /// </summary>
    private const string SummarySql =
        """
        SELECT
            Key AS RowKey,
            COALESCE(json_extract(Value, '$.NoteId'), '') AS NoteId,
            COALESCE(json_extract(Value, '$.Sid'), '') AS Sid,
            COALESCE(json_extract(Value, '$.Ver'), 0) AS Ver,
            COALESCE(json_extract(Value, '$.Title'), '') AS Title,
            json_extract(Value, '$.FolderId') AS FolderId,
            json_extract(Value, '$.ParentNoteId') AS ParentNoteId,
            COALESCE(json_extract(Value, '$.Order'), 0) AS NoteOrder,
            COALESCE(json_extract(Value, '$.IsFavorite'), 0) AS IsFavorite,
            json_extract(Value, '$.CreatedAt') AS CreatedAt,
            json_extract(Value, '$.ModifiedAt') AS ModifiedAt,
            json_extract(Value, '$.Emoji') AS Emoji,
            json_extract(Value, '$.Cover') AS Cover,
            json_extract(Value, '$.Tags') AS Tags
        FROM Storage
        WHERE Key IN (SELECT value FROM json_each($keys))
        """;

    // The columns of SummarySql, in the order it selects them. Named rather than counted at each use,
    // because the one way this projection can go wrong quietly is reading a field out of the slot
    // next to it.
    private const int RowKeyColumn = 0;
    private const int NoteIdColumn = 1;
    private const int SidColumn = 2;
    private const int VerColumn = 3;
    private const int TitleColumn = 4;
    private const int FolderIdColumn = 5;
    private const int ParentNoteIdColumn = 6;
    private const int OrderColumn = 7;
    private const int IsFavoriteColumn = 8;
    private const int CreatedAtColumn = 9;
    private const int ModifiedAtColumn = 10;
    private const int EmojiColumn = 11;
    private const int CoverColumn = 12;
    private const int TagsColumn = 13;

    public async Task<IReadOnlyList<NoteSummary>> ReadSummariesAsync(
        IReadOnlyList<string> noteIds,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(noteIds);
        if (noteIds.Count == 0)
            return [];

        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        var keys = new string[noteIds.Count];
        for (var i = 0; i < noteIds.Count; i++)
            keys[i] = NoteKey(noteIds[i]);

        var byKey = new Dictionary<string, NoteSummary>(noteIds.Count, StringComparer.Ordinal);

        await using (var connection = new SqliteConnection(_connectionString))
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);

            await using (var pragma = connection.CreateCommand())
            {
                // The per-note reads this replaces were opened with the same wait, so a listing that
                // arrives while another connection holds the lock still waits instead of failing.
                pragma.CommandText = "PRAGMA busy_timeout=5000;";
                await pragma.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await using var cmd = connection.CreateCommand();
            cmd.CommandText = SummarySql;
            cmd.Parameters.AddWithValue("$keys", JsonSerializer.Serialize(keys));

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                // Keyed by the row's own key rather than by the id it carries, because the two are
                // free to disagree and the caller asked by key. A note stored under one id and
                // naming another still comes back for the id it was asked for, naming the other,
                // which is what loading the row whole does.
                if (ReadSummary(reader) is { } summary)
                    byKey[reader.GetString(RowKeyColumn)] = summary;
            }
        }

        // Rebuilt in the order asked for. A set of keys comes back in whatever order the scan found
        // them, and the caller's sort is stable over what it is given, so handing back scan order
        // would quietly reorder notes that share a modification instant.
        var summaries = new List<NoteSummary>(noteIds.Count);
        foreach (var key in keys)
        {
            if (byKey.TryGetValue(key, out var summary))
                summaries.Add(summary);
        }

        return summaries;
    }

    /// <summary>
    /// One projected row, or nothing when its timestamps do not read back. Loading such a row whole
    /// fails to deserialize and leaves the note out of the library rather than failing the listing,
    /// so passing over it here keeps the two reads answering the same thing.
    /// </summary>
    private static NoteSummary? ReadSummary(SqliteDataReader reader)
    {
        if (!TryReadTimestamp(reader, CreatedAtColumn, out var createdAt) ||
            !TryReadTimestamp(reader, ModifiedAtColumn, out var modifiedAt))
        {
            return null;
        }

        return new NoteSummary(
            reader.GetString(NoteIdColumn),
            reader.GetString(SidColumn),
            reader.GetInt64(VerColumn),
            reader.GetString(TitleColumn),
            ReadOptional(reader, FolderIdColumn),
            ReadOptional(reader, ParentNoteIdColumn),
            reader.GetInt32(OrderColumn),
            reader.GetBoolean(IsFavoriteColumn),
            createdAt,
            modifiedAt,
            ReadOptional(reader, EmojiColumn),
            ReadOptional(reader, CoverColumn),
            ReadTags(reader, TagsColumn));
    }

    /// <summary>A field a note leaves out when it is unset, which reads back as no value at all.</summary>
    private static string? ReadOptional(SqliteDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    /// <summary>
    /// A stored timestamp, carrying the kind it was written with. A row written as UTC comes back as
    /// UTC and one written without a kind comes back without one, and neither is moved: converting an
    /// unlabelled value to UTC here would read it as local time and shift it by the machine's offset,
    /// for a value whose only problem is a missing label.
    /// </summary>
    private static bool TryReadTimestamp(SqliteDataReader reader, int ordinal, out DateTime value)
    {
        if (reader.IsDBNull(ordinal))
        {
            // Absent means here what it means to the model: a note built without one is stamped with
            // the current instant. Nothing in this app writes a note row without them.
            value = DateTime.UtcNow;
            return true;
        }

        return DateTime.TryParse(
            reader.GetValue(ordinal) as string,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind,
            out value);
    }

    /// <summary>
    /// The stored tag array, or none. Absent is what a note written before page tags existed has, and
    /// the model reads that as an empty list rather than as a missing one.
    /// </summary>
    private static IReadOnlyList<string> ReadTags(SqliteDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal)
            ? []
            : JsonSerializer.Deserialize<List<string>>(reader.GetString(ordinal)) ?? [];
}
