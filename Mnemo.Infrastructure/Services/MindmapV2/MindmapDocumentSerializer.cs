using System.Text.Json;
using System.Text.Json.Serialization;
using Mnemo.Core.Models.MindmapV2;

namespace Mnemo.Infrastructure.Services.MindmapV2;

/// <summary>
/// Canonical (de)serialization for <see cref="MindmapDocument"/>. Storage JSON uses full descriptive
/// (camelCase) property names and omits defaults for compactness; the wire format compaction is a
/// separate concern. Enums are written as strings and unknown element content round-trips via
/// <see cref="ElementContentJsonConverter"/>.
/// </summary>
public static class MindmapDocumentSerializer
{
    /// <summary>Shared, thread-safe options. Reused everywhere so read and write always agree.</summary>
    public static JsonSerializerOptions Options { get; } = CreateOptions();

    public static string Serialize(MindmapDocument document) =>
        JsonSerializer.Serialize(document, Options);

    public static MindmapDocument? Deserialize(string json) =>
        JsonSerializer.Deserialize<MindmapDocument>(json, Options);

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingDefault,
            WriteIndented = false,
        };
        options.Converters.Add(new ElementContentJsonConverter());
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }
}
