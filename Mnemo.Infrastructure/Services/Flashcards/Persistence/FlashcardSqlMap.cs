using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// Row ↔ value conversions shared by the flashcard repositories: JSON-encoded collections,
/// round-trippable timestamps and enum ↔ storage mappings. Pure functions, no I/O.
/// </summary>
internal static class FlashcardSqlMap
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.General);

    // --- timestamps (stored as ISO-8601 round-trip UTC) ---

    public static string Ts(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    public static string? TsN(DateTimeOffset? value) => value.HasValue ? Ts(value.Value) : null;

    public static DateTimeOffset ReadTs(SqliteDataReader reader, int ordinal) =>
        DateTimeOffset.Parse(reader.GetString(ordinal), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

    public static DateTimeOffset? ReadTsN(SqliteDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : ReadTs(reader, ordinal);

    public static double? ReadDoubleN(SqliteDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetDouble(ordinal);

    public static string? ReadStringN(SqliteDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    // --- string-list JSON (tags) ---

    public static string Tags(IReadOnlyList<string> tags) => JsonSerializer.Serialize(tags, Json);

    public static IReadOnlyList<string> ReadTags(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return Array.Empty<string>();
        try
        {
            return JsonSerializer.Deserialize<string[]>(json, Json) ?? Array.Empty<string>();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    // --- int-list JSON (learning/relearn steps) ---

    public static string IntList(IReadOnlyList<int> values) => JsonSerializer.Serialize(values, Json);

    public static IReadOnlyList<int> ReadIntList(string? json, IReadOnlyList<int> fallback)
    {
        if (string.IsNullOrWhiteSpace(json))
            return fallback;
        try
        {
            return JsonSerializer.Deserialize<int[]>(json, Json) ?? fallback;
        }
        catch
        {
            return fallback;
        }
    }

    // --- double-list JSON (FSRS weights, nullable) ---

    public static string? DoubleListN(IReadOnlyList<double>? values) =>
        values is null ? null : JsonSerializer.Serialize(values, Json);

    public static IReadOnlyList<double>? ReadDoubleListN(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return null;
        try
        {
            return JsonSerializer.Deserialize<double[]>(json, Json);
        }
        catch
        {
            return null;
        }
    }

    // --- attachments JSON ---

    public static string Attachments(IReadOnlyList<FlashcardAttachment> attachments) =>
        JsonSerializer.Serialize(attachments, Json);

    public static IReadOnlyList<FlashcardAttachment> ReadAttachments(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return Array.Empty<FlashcardAttachment>();
        try
        {
            return JsonSerializer.Deserialize<FlashcardAttachment[]>(json, Json) ?? Array.Empty<FlashcardAttachment>();
        }
        catch
        {
            return Array.Empty<FlashcardAttachment>();
        }
    }

    // --- AutoReveal enum ↔ token ('off' | '5s' | '10s') ---

    public static string AutoReveal(FlashcardAutoReveal value) => value switch
    {
        FlashcardAutoReveal.FiveSeconds => "5s",
        FlashcardAutoReveal.TenSeconds => "10s",
        _ => "off"
    };

    public static FlashcardAutoReveal ReadAutoReveal(string? token) => token switch
    {
        "5s" => FlashcardAutoReveal.FiveSeconds,
        "10s" => FlashcardAutoReveal.TenSeconds,
        _ => FlashcardAutoReveal.Off
    };
}
