using Mnemo.Core.Models.Statistics;

namespace Mnemo.Host.Contracts;

/// <summary>
/// One statistics record, identified by its namespace/kind/key triple. Hand-mirrored in
/// <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// <para>
/// <c>CreatedAt</c>, <c>Version</c>, <c>SourceModule</c> and <c>MetadataJson</c> are left off:
/// nothing that reads statistics over HTTP has a use for provenance or optimistic concurrency,
/// and a record's fields are the only part a widget renders.
/// </para>
/// </summary>
public sealed record StatRecordDto(
    string Ns,
    string Kind,
    string Key,
    DateTimeOffset UpdatedAt,
    IReadOnlyDictionary<string, StatValueDto> Fields)
{
    public static StatRecordDto FromModel(StatisticsRecord model) => new(
        model.Namespace,
        model.Kind,
        model.Key,
        model.UpdatedAt,
        model.Fields.ToDictionary(field => field.Key, field => StatValueDto.FromModel(field.Value), StringComparer.Ordinal));
}

/// <summary>
/// A field value with its type tag kept intact. Hand-mirrored in
/// <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// <para>
/// The value travels as a string rather than as native JSON so that neither the tag nor the
/// precision is lost on the way out: a <c>long</c> past 2^53 survives, and a client can reproduce
/// the reader's rule of checking the type before reading rather than inferring a type from what
/// JSON happened to encode.
/// </para>
/// </summary>
public sealed record StatValueDto(string Type, string Value)
{
    public static StatValueDto FromModel(StatValue value) => new(TagFor(value.Type), value.ToString());

    /// <summary>
    /// The wire spelling of <see cref="StatValueType"/>. Deliberately the enum's own names in
    /// camelCase rather than friendlier ones, because a reader compares against this tag to decide
    /// whether a field is safe to read, and a renamed tag silently turns every such check false.
    /// </summary>
    private static string TagFor(StatValueType type) => type switch
    {
        StatValueType.Boolean => "boolean",
        StatValueType.Integer => "integer",
        StatValueType.Decimal => "decimal",
        StatValueType.String => "string",
        StatValueType.DateTime => "dateTime",
        // A tag this build has no name for, paired with the empty string StatValue.ToString gives
        // it. Serving that is better than throwing: one unrecognized field would otherwise fail the
        // whole record, and a reader guarding on the tag already treats an unknown one as absent.
        _ => "unknown"
    };
}
