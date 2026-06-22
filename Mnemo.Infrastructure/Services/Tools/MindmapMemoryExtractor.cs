using System;
using System.Collections.Generic;
using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Tools;

/// <summary>
/// Extracts conversation-memory facts from Mindmap tool results.
/// </summary>
public sealed class MindmapMemoryExtractor : IToolResultMemoryExtractor
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public IEnumerable<ConversationMemoryEntry> Extract(string toolName, string resultJson, int turnNumber)
    {
        if (string.IsNullOrWhiteSpace(resultJson))
            yield break;

        JsonElement root;
        try
        {
            root = JsonSerializer.Deserialize<JsonElement>(resultJson, JsonOpts);
        }
        catch
        {
            yield break;
        }

        if (!root.TryGetProperty("ok", out var okProp) || !okProp.GetBoolean())
            yield break;

        if (!root.TryGetProperty("data", out var data) || data.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            yield break;

        var now = DateTime.UtcNow;

        switch (toolName.ToLowerInvariant())
        {
            case "create_mindmap":
            case "outline_mindmap":
            case "read_mindmap":
            case "edit_mindmap":
            case "manage_mindmap":
            case "open_mindmap":
            {
                if (TryGetString(data, "mindmap_id", out var mmId))
                    yield return MakeFact("active_mindmap_id", mmId!, toolName, turnNumber, now);
                if (TryGetString(data, "title", out var title))
                    yield return MakeFact("active_mindmap_title", title!, toolName, turnNumber, now);
                break;
            }

            case "search_mindmaps":
            {
                if (data.TryGetProperty("mindmaps", out var maps) && maps.ValueKind == JsonValueKind.Array)
                {
                    var ids = new List<string>();
                    foreach (var m in maps.EnumerateArray())
                    {
                        if (TryGetString(m, "mindmap_id", out var id))
                            ids.Add(id!);
                    }
                    if (ids.Count > 0)
                        yield return MakeFact("listed_mindmap_ids",
                            JsonSerializer.Serialize(ids), toolName, turnNumber, now);
                }
                break;
            }
        }
    }

    private static bool TryGetString(JsonElement element, string property, out string? value)
    {
        if (element.TryGetProperty(property, out var prop) && prop.ValueKind == JsonValueKind.String)
        {
            value = prop.GetString();
            return !string.IsNullOrWhiteSpace(value);
        }
        value = null;
        return false;
    }

    private static ConversationMemoryEntry MakeFact(
        string key, string value, string source, int turnNumber, DateTime createdUtc) =>
        new()
        {
            Key = key,
            Value = value,
            Source = source,
            TurnNumber = turnNumber,
            CreatedUtc = createdUtc
        };
}
