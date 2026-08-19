using System;
using System.Globalization;
using Microsoft.Data.Sqlite;

namespace Mnemo.Infrastructure.Common;

/// <summary>
/// One spelling of a timestamp in SQLite text columns. Round-trip format in UTC, which is also
/// lexically sortable, so a column can be ordered and range-scanned without parsing.
/// </summary>
public static class SqlTime
{
    /// <summary>Writes a timestamp as sortable round-trip UTC text.</summary>
    public static string Write(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    /// <summary>Reads a timestamp written by <see cref="Write"/>.</summary>
    public static DateTimeOffset Read(SqliteDataReader reader, int ordinal) =>
        DateTimeOffset.Parse(reader.GetString(ordinal), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

    /// <summary>Reads a timestamp that may be null.</summary>
    public static DateTimeOffset? ReadNullable(SqliteDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : Read(reader, ordinal);
}
