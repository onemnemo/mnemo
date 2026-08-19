using System;
using System.Collections.Generic;
using System.Text.Json;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// The JSON columns on card types and facts, read and written in one place so the migration and
/// the repositories cannot drift apart.
/// </summary>
/// <remarks>
/// Every read returns an empty value rather than throwing on malformed JSON. A row written by a
/// build that no longer exists still has to open the collection.
/// </remarks>
internal static class FlashcardFactSqlMap
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.General);

    public static string Fields(IReadOnlyList<FlashcardField> fields) =>
        JsonSerializer.Serialize(fields, Json);

    public static IReadOnlyList<FlashcardField> ReadFields(string? json) =>
        Read<FlashcardField[]>(json) ?? [];

    public static string Layouts(IReadOnlyList<FlashcardLayout> layouts) =>
        JsonSerializer.Serialize(layouts, Json);

    public static IReadOnlyList<FlashcardLayout> ReadLayouts(string? json) =>
        Read<FlashcardLayout[]>(json) ?? [];

    public static string Values(IReadOnlyDictionary<string, string> values) =>
        JsonSerializer.Serialize(values, Json);

    public static IReadOnlyDictionary<string, string> ReadValues(string? json) =>
        Read<Dictionary<string, string>>(json) ?? [];

    public static string Media(IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>> media) =>
        JsonSerializer.Serialize(media, Json);

    public static IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>> ReadMedia(string? json) =>
        Read<Dictionary<string, IReadOnlyList<FlashcardAttachment>>>(json) ?? [];

    private static T? Read<T>(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return default;
        try
        {
            return JsonSerializer.Deserialize<T>(json, Json);
        }
        catch (JsonException)
        {
            return default;
        }
    }
}
