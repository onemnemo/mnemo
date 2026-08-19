using System;
using System.Collections.Generic;
using System.Text.Json;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// The JSON columns on card types and facts, read and written in one place so the migration and
/// the repositories cannot drift apart.
/// </summary>
/// <remarks>
/// Every read returns an empty value rather than throwing on malformed JSON. A row written by a
/// build that no longer exists still has to open the collection. A caller that wants to know when
/// that happened can pass a logger and a short description of the row.
/// </remarks>
internal static class FlashcardFactSqlMap
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.General);

    public static string Fields(IReadOnlyList<FlashcardField> fields) =>
        JsonSerializer.Serialize(fields, Json);

    public static IReadOnlyList<FlashcardField> ReadFields(string? json, ILoggerService? logger = null, string? context = null) =>
        Read<FlashcardField[]>(json, logger, context, "FieldsJson") ?? [];

    public static string Layouts(IReadOnlyList<FlashcardLayout> layouts) =>
        JsonSerializer.Serialize(layouts, Json);

    public static IReadOnlyList<FlashcardLayout> ReadLayouts(string? json, ILoggerService? logger = null, string? context = null) =>
        Read<FlashcardLayout[]>(json, logger, context, "LayoutsJson") ?? [];

    public static string Values(IReadOnlyDictionary<string, string> values) =>
        JsonSerializer.Serialize(values, Json);

    public static IReadOnlyDictionary<string, string> ReadValues(string? json, ILoggerService? logger = null, string? context = null) =>
        Read<Dictionary<string, string>>(json, logger, context, "ValuesJson") ?? [];

    public static string Media(IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>> media) =>
        JsonSerializer.Serialize(media, Json);

    public static IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>> ReadMedia(string? json, ILoggerService? logger = null, string? context = null) =>
        Read<Dictionary<string, IReadOnlyList<FlashcardAttachment>>>(json, logger, context, "MediaJson") ?? [];

    private static T? Read<T>(string? json, ILoggerService? logger, string? context, string column)
    {
        if (string.IsNullOrWhiteSpace(json))
            return default;
        try
        {
            return JsonSerializer.Deserialize<T>(json, Json);
        }
        catch (JsonException ex)
        {
            FlashcardSqlMap.LogFallback(logger, context, column, ex);
            return default;
        }
    }
}
