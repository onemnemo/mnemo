using System.Collections.Generic;
using Mnemo.Core.Enums;

namespace Mnemo.Core.Models;

/// <summary>
/// Well-known keys and parsing for <see cref="ImportExportRequest.Options"/>.
/// </summary>
public static class ImportExportOptionKeys
{
    public const string ConflictPolicy = "ConflictPolicy";

    public const string TargetFolderId = "TargetFolderId";

    public static ImportConflictPolicy GetConflictPolicy(IReadOnlyDictionary<string, object?> options)
    {
        if (options.TryGetValue(ConflictPolicy, out var value))
        {
            if (value is ImportConflictPolicy policy)
                return policy;
            if (value is string text && System.Enum.TryParse<ImportConflictPolicy>(text, ignoreCase: true, out var parsed))
                return parsed;
        }

        return ImportConflictPolicy.KeepBoth;
    }

    public static string? GetStringOption(IReadOnlyDictionary<string, object?> options, string key) =>
        options.TryGetValue(key, out var value) && value is string text && !string.IsNullOrWhiteSpace(text) ? text : null;
}

public sealed class ImportExportCapability
{
    public string ContentType { get; set; } = string.Empty;

    public string FormatId { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public List<string> Extensions { get; set; } = new();

    public bool SupportsImport { get; set; }

    public bool SupportsExport { get; set; }

    /// <summary>
    /// Whether importing this format reads <see cref="ImportExportOptionKeys.ConflictPolicy"/>.
    /// False means every import of it is new content whatever the caller asked for.
    /// </summary>
    public bool SupportsConflictPolicy { get; set; } = true;
}

public sealed class ImportExportRequest
{
    public string? ContentType { get; set; }

    public string? FormatId { get; set; }

    public required string FilePath { get; set; }

    public object? Payload { get; set; }

    public Dictionary<string, object?> Options { get; set; } = new(System.StringComparer.OrdinalIgnoreCase);
}

public sealed class ImportExportPreview
{
    public bool CanImport { get; set; }

    public string ContentType { get; set; } = string.Empty;

    public string FormatId { get; set; } = string.Empty;

    public Dictionary<string, int> DiscoveredCounts { get; set; } = new(System.StringComparer.OrdinalIgnoreCase);

    public List<TransferWarning> Warnings { get; set; } = new();
}

public sealed class ImportExportResult
{
    public bool Success { get; set; } = true;

    public string ContentType { get; set; } = string.Empty;

    public string FormatId { get; set; } = string.Empty;

    public Dictionary<string, int> ProcessedCounts { get; set; } = new(System.StringComparer.OrdinalIgnoreCase);

    public List<TransferWarning> Warnings { get; set; } = new();

    public string? ErrorMessage { get; set; }
}
