using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// Row ↔ value conversions shared by the flashcard repositories: JSON-encoded collections,
/// round-trippable timestamps and enum ↔ storage mappings. Pure by default: a caller that wants
/// to know when a stored JSON column was too malformed to read can pass a logger and a short
/// description of the row, and a warning is written instead of the failure passing silently.
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

    public static IReadOnlyList<string> ReadTags(string? json, ILoggerService? logger = null, string? context = null)
    {
        if (string.IsNullOrWhiteSpace(json))
            return Array.Empty<string>();
        try
        {
            return JsonSerializer.Deserialize<string[]>(json, Json) ?? Array.Empty<string>();
        }
        catch (Exception ex)
        {
            LogFallback(logger, context, "TagsJson", ex);
            return Array.Empty<string>();
        }
    }

    // --- int-list JSON (learning/relearn steps) ---

    public static string IntList(IReadOnlyList<int> values) => JsonSerializer.Serialize(values, Json);

    public static IReadOnlyList<int> ReadIntList(string? json, IReadOnlyList<int> fallback, ILoggerService? logger = null, string? context = null)
    {
        if (string.IsNullOrWhiteSpace(json))
            return fallback;
        try
        {
            return JsonSerializer.Deserialize<int[]>(json, Json) ?? fallback;
        }
        catch (Exception ex)
        {
            LogFallback(logger, context, "a step list", ex);
            return fallback;
        }
    }

    // --- double-list JSON (FSRS weights, nullable) ---

    public static string? DoubleListN(IReadOnlyList<double>? values) =>
        values is null ? null : JsonSerializer.Serialize(values, Json);

    public static IReadOnlyList<double>? ReadDoubleListN(string? json, ILoggerService? logger = null, string? context = null)
    {
        if (string.IsNullOrWhiteSpace(json))
            return null;
        try
        {
            return JsonSerializer.Deserialize<double[]>(json, Json);
        }
        catch (Exception ex)
        {
            LogFallback(logger, context, "WeightsJson", ex);
            return null;
        }
    }

    // --- attachments JSON ---

    public static string Attachments(IReadOnlyList<FlashcardAttachment> attachments) =>
        JsonSerializer.Serialize(attachments, Json);

    public static IReadOnlyList<FlashcardAttachment> ReadAttachments(string? json, ILoggerService? logger = null, string? context = null)
    {
        if (string.IsNullOrWhiteSpace(json))
            return Array.Empty<FlashcardAttachment>();
        try
        {
            return JsonSerializer.Deserialize<FlashcardAttachment[]>(json, Json) ?? Array.Empty<FlashcardAttachment>();
        }
        catch (Exception ex)
        {
            LogFallback(logger, context, "AttachmentsJson", ex);
            return Array.Empty<FlashcardAttachment>();
        }
    }

    /// <summary>
    /// Reports a JSON column that could not be read. The caller already fell back to an empty or
    /// default value; the risk this warns about is that the fallback gets written straight back on
    /// the next save, permanently replacing whatever the malformed JSON held.
    /// </summary>
    internal static void LogFallback(ILoggerService? logger, string? context, string column, Exception ex) =>
        logger?.Warning("Flashcards",
            $"{column} on {context ?? "an unrecognized row"} could not be read and fell back to empty; " +
            $"saving that row again will overwrite the stored value. {ex.Message}");

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

    // --- LeechAction enum ↔ stored ordinal ---

    /// <summary>
    /// Falls back to Tag rather than None, so a value this build does not recognise still leaves a
    /// mark on the card instead of silently doing nothing about it.
    /// </summary>
    public static FlashcardLeechAction ReadLeechAction(int value) => value switch
    {
        0 => FlashcardLeechAction.None,
        2 => FlashcardLeechAction.Suspend,
        _ => FlashcardLeechAction.Tag
    };
}
