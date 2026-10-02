using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

/// <summary>
/// The stock note type a note type was first created from, as Anki records it. Kept even after a
/// user renames the type or edits its templates, which is what makes a built-in image occlusion
/// type recognisable without trusting its translated name.
/// </summary>
internal enum AnkiStockKind
{
    Unknown = 0,
    Basic = 1,
    BasicAndReversed = 2,
    BasicOptionalReversed = 3,
    BasicTyping = 4,
    Cloze = 5,
    ImageOcclusion = 6,
}

/// <summary>
/// One of a note type's card templates: its raw question and answer formats, and which fields
/// each side shows as positions in the note's fields.
/// </summary>
/// <remarks>
/// Anki repeats the question on the answer through <c>FrontSide</c>, so a field the question
/// already showed is not counted again in <see cref="BackFields"/>.
/// </remarks>
/// <param name="ClozeField">The field the template runs the cloze filter over, when it does.</param>
internal sealed record AnkiTemplate(
    int Ord,
    string Name,
    string QuestionFormat,
    string AnswerFormat,
    IReadOnlyList<int> FrontFields,
    IReadOnlyList<int> BackFields,
    int? ClozeField);

/// <summary>A note type's field names, the templates it makes cards from, and what kind it is.</summary>
internal sealed record AnkiNoteType(
    long Id,
    string Name,
    bool IsCloze,
    AnkiStockKind StockKind,
    IReadOnlyList<string> FieldNames,
    IReadOnlyList<AnkiTemplate> Templates)
{
    public AnkiTemplate? TemplateFor(int ord) => Templates.FirstOrDefault(t => t.Ord == ord);

    /// <summary>The field the deletions live in, as the first template that names one says.</summary>
    public int? ClozeField => Templates.Select(t => t.ClozeField).FirstOrDefault(f => f is not null);

    /// <summary>Anki's built-in image occlusion type, which is a cloze type over mask shapes rather than text.</summary>
    public bool IsImageOcclusion => StockKind == AnkiStockKind.ImageOcclusion;
}

/// <summary>
/// Reads the note types a collection defines, from either place Anki has kept them: the JSON
/// <c>col.models</c> column of the legacy layouts, or the <c>notetypes</c>, <c>fields</c> and
/// <c>templates</c> tables of <c>collection.anki21b</c>, whose configs are protobuf blobs.
/// </summary>
internal static class AnkiNoteTypeReader
{
    private const int AnkiClozeModelType = 1;
    private const string AnkiClozeFilter = "cloze";

    private const int NotetypeConfigKindField = 1;
    private const int NotetypeConfigOriginalStockKindField = 9;
    private const int TemplateConfigQuestionField = 1;
    private const int TemplateConfigAnswerField = 2;

    /// <summary>A marker in an Anki card template, which is a field name, a filtered one, or one of Anki's own.</summary>
    private static readonly Regex TemplateMarkerRegex = new(@"\{\{([^{}]+)\}\}", RegexOptions.Compiled);

    /// <summary>
    /// Every note type the collection defines, keyed by id. Empty when neither place holds any,
    /// and a note type whose config cannot be read is skipped rather than failing the import.
    /// </summary>
    /// <param name="modelsJson">The <c>col.models</c> column, which the newer schema leaves empty.</param>
    public static async Task<IReadOnlyDictionary<long, AnkiNoteType>> ReadAsync(
        SqliteConnection connection,
        string? modelsJson,
        CancellationToken cancellationToken)
    {
        var legacy = ParseLegacyModels(modelsJson);
        if (legacy.Count > 0)
            return legacy;

        return await ReadRelationalAsync(connection, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Registers the collation Anki declares on its name columns. Plain SQLite does not know it,
    /// and any statement that sorts or compares those columns fails without it.
    /// </summary>
    public static void RegisterCollations(SqliteConnection connection) =>
        connection.CreateCollation("unicase", (a, b) => string.Compare(a, b, StringComparison.OrdinalIgnoreCase));

    internal static Dictionary<long, AnkiNoteType> ParseLegacyModels(string? json)
    {
        var map = new Dictionary<long, AnkiNoteType>();
        if (string.IsNullOrWhiteSpace(json))
            return map;

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(json);
        }
        catch (JsonException)
        {
            return map;
        }

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return map;

            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                if (!long.TryParse(prop.Name, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id))
                    continue;
                if (prop.Value.ValueKind != JsonValueKind.Object)
                    continue;

                var fieldNames = ReadOrderedNames(prop.Value, "flds");
                if (fieldNames.Count == 0)
                    continue;

                var isCloze = ReadInt(prop.Value, "type") == AnkiClozeModelType;
                var stockKind = ToStockKind(ReadInt(prop.Value, "originalStockKind"));
                var templates = new List<AnkiTemplate>();
                if (prop.Value.TryGetProperty("tmpls", out var list) && list.ValueKind == JsonValueKind.Array)
                {
                    var position = 0;
                    foreach (var entry in list.EnumerateArray())
                    {
                        if (entry.ValueKind == JsonValueKind.Object)
                        {
                            var ord = ReadInt(entry, "ord") ?? position;
                            templates.Add(BuildTemplate(
                                ord, ReadString(entry, "name"), ReadString(entry, "qfmt"), ReadString(entry, "afmt"), fieldNames));
                        }

                        position++;
                    }
                }

                map[id] = new AnkiNoteType(id, ReadString(prop.Value, "name"), isCloze, stockKind, fieldNames, templates);
            }
        }

        return map;
    }

    private static async Task<Dictionary<long, AnkiNoteType>> ReadRelationalAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        var map = new Dictionary<long, AnkiNoteType>();
        if (!await TableExistsAsync(connection, "notetypes", cancellationToken).ConfigureAwait(false)
            || !await TableExistsAsync(connection, "fields", cancellationToken).ConfigureAwait(false)
            || !await TableExistsAsync(connection, "templates", cancellationToken).ConfigureAwait(false))
            return map;

        var heads = new List<(long Id, string Name, bool IsCloze, AnkiStockKind StockKind)>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT id, name, config FROM notetypes";
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                if (reader.IsDBNull(0))
                    continue;
                var config = reader.IsDBNull(2) ? [] : (byte[])reader.GetValue(2);
                var (kind, stockKind) = ReadNotetypeConfig(config);
                heads.Add((reader.GetInt64(0), reader.IsDBNull(1) ? string.Empty : reader.GetString(1), kind == AnkiClozeModelType, stockKind));
            }
        }

        // An exported package keeps the field and template rows of note types it left out, so rows
        // are only ever read for a note type the package still defines.
        var fieldsByType = new Dictionary<long, SortedDictionary<int, string>>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT ntid, ord, name FROM fields";
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                if (reader.IsDBNull(0) || reader.IsDBNull(1))
                    continue;
                var ntid = reader.GetInt64(0);
                if (!fieldsByType.TryGetValue(ntid, out var fields))
                    fieldsByType[ntid] = fields = new SortedDictionary<int, string>();
                fields[reader.GetInt32(1)] = reader.IsDBNull(2) ? string.Empty : reader.GetString(2);
            }
        }

        var templatesByType = new Dictionary<long, SortedDictionary<int, (string Name, string Question, string Answer)>>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT ntid, ord, name, config FROM templates";
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                if (reader.IsDBNull(0) || reader.IsDBNull(1))
                    continue;
                var ntid = reader.GetInt64(0);
                if (!templatesByType.TryGetValue(ntid, out var templates))
                    templatesByType[ntid] = templates = new SortedDictionary<int, (string, string, string)>();
                var config = reader.IsDBNull(3) ? [] : (byte[])reader.GetValue(3);
                var (question, answer) = ReadTemplateConfig(config);
                templates[reader.GetInt32(1)] = (reader.IsDBNull(2) ? string.Empty : reader.GetString(2), question, answer);
            }
        }

        foreach (var head in heads)
        {
            if (!fieldsByType.TryGetValue(head.Id, out var fields) || fields.Count == 0)
                continue;

            var fieldNames = fields.Values.ToArray();
            var templates = templatesByType.TryGetValue(head.Id, out var raw)
                ? raw.Select(t => BuildTemplate(t.Key, t.Value.Name, t.Value.Question, t.Value.Answer, fieldNames)).ToArray()
                : [];
            map[head.Id] = new AnkiNoteType(head.Id, head.Name, head.IsCloze, head.StockKind, fieldNames, templates);
        }

        return map;
    }

    private static (int Kind, AnkiStockKind StockKind) ReadNotetypeConfig(ReadOnlySpan<byte> config)
    {
        var kind = 0;
        var stockKind = AnkiStockKind.Unknown;
        var reader = new AnkiProtobufReader(config);
        while (reader.TryReadFieldHeader(out var field, out var wireType))
        {
            if (wireType == AnkiProtobufReader.WireTypeVarint
                && field is NotetypeConfigKindField or NotetypeConfigOriginalStockKindField)
            {
                if (!reader.TryReadVarint(out var value))
                    break;
                if (field == NotetypeConfigKindField)
                    kind = value > int.MaxValue ? 0 : (int)value;
                else
                    stockKind = ToStockKind(value > int.MaxValue ? null : (int)value);
                continue;
            }

            if (!reader.TrySkip(wireType))
                break;
        }

        return (kind, stockKind);
    }

    private static (string Question, string Answer) ReadTemplateConfig(ReadOnlySpan<byte> config)
    {
        var question = string.Empty;
        var answer = string.Empty;
        var reader = new AnkiProtobufReader(config);
        while (reader.TryReadFieldHeader(out var field, out var wireType))
        {
            if (wireType == AnkiProtobufReader.WireTypeLengthDelimited
                && field is TemplateConfigQuestionField or TemplateConfigAnswerField)
            {
                if (!reader.TryReadLengthDelimited(out var raw))
                    break;
                if (field == TemplateConfigQuestionField)
                    question = Encoding.UTF8.GetString(raw);
                else
                    answer = Encoding.UTF8.GetString(raw);
                continue;
            }

            if (!reader.TrySkip(wireType))
                break;
        }

        return (question, answer);
    }

    private static AnkiStockKind ToStockKind(int? value) =>
        value is { } v && Enum.IsDefined(typeof(AnkiStockKind), v) ? (AnkiStockKind)v : AnkiStockKind.Unknown;

    private static AnkiTemplate BuildTemplate(int ord, string name, string question, string answer, IReadOnlyList<string> fieldNames)
    {
        var front = FieldPositions(question, fieldNames, hidden: false);
        // A typed answer or a hint on the question holds what is being asked for, so it belongs
        // on the back even when the answer side does not repeat it.
        var back = FieldPositions(answer, fieldNames, hidden: null)
            .Concat(FieldPositions(question, fieldNames, hidden: true))
            .Distinct()
            .Except(front)
            .ToArray();
        var clozeField = ClozeFieldPosition(question, fieldNames) ?? ClozeFieldPosition(answer, fieldNames);
        return new AnkiTemplate(ord, name, question, answer, front, back, clozeField);
    }

    /// <summary>
    /// Which of a note type's fields a template shows, in the order it shows them. A marker naming
    /// something that is not a field, whether one of Anki's own or a conditional section, is left
    /// out rather than guessed at.
    /// </summary>
    /// <param name="hidden">
    /// True for only the fields behind a <c>type:</c> or <c>hint:</c> filter, false for only the
    /// others, null for every field.
    /// </param>
    private static int[] FieldPositions(string template, IReadOnlyList<string> fieldNames, bool? hidden)
    {
        if (string.IsNullOrEmpty(template))
            return [];

        var positions = new List<int>();
        foreach (Match match in TemplateMarkerRegex.Matches(template))
        {
            var token = match.Groups[1].Value.Trim();
            if (token.Length == 0 || token[0] is '#' or '^' or '/')
                continue;

            // Filters stack ahead of the field name, as in "{{text:furigana:Reading}}".
            var colon = token.LastIndexOf(':');
            var isHidden = colon >= 0 && token[..colon].Split(':', StringSplitOptions.TrimEntries)
                .Any(f => f.Equals("type", StringComparison.OrdinalIgnoreCase) || f.Equals("hint", StringComparison.OrdinalIgnoreCase));
            if (hidden is { } wanted && wanted != isHidden)
                continue;
            if (colon >= 0)
                token = token[(colon + 1)..].Trim();

            for (var i = 0; i < fieldNames.Count; i++)
            {
                if (!string.Equals(fieldNames[i], token, StringComparison.OrdinalIgnoreCase))
                    continue;
                if (!positions.Contains(i))
                    positions.Add(i);
                break;
            }
        }

        return positions.ToArray();
    }

    /// <summary>The field a template runs the cloze filter over. Null when the template names none.</summary>
    private static int? ClozeFieldPosition(string template, IReadOnlyList<string> fieldNames)
    {
        if (string.IsNullOrEmpty(template))
            return null;

        foreach (Match match in TemplateMarkerRegex.Matches(template))
        {
            var token = match.Groups[1].Value.Trim();
            var colon = token.LastIndexOf(':');
            if (colon < 0)
                continue;

            var filters = token[..colon].Split(':', StringSplitOptions.TrimEntries);
            if (!filters.Any(f => string.Equals(f, AnkiClozeFilter, StringComparison.OrdinalIgnoreCase)))
                continue;

            var name = token[(colon + 1)..].Trim();
            for (var i = 0; i < fieldNames.Count; i++)
            {
                if (string.Equals(fieldNames[i], name, StringComparison.OrdinalIgnoreCase))
                    return i;
            }
        }

        return null;
    }

    private static List<string> ReadOrderedNames(JsonElement model, string property)
    {
        var names = new List<string>();
        if (!model.TryGetProperty(property, out var list) || list.ValueKind != JsonValueKind.Array)
            return names;

        foreach (var entry in list.EnumerateArray())
        {
            names.Add(entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("name", out var name)
                ? name.GetString() ?? string.Empty
                : string.Empty);
        }

        return names;
    }

    private static int? ReadInt(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)
            ? number
            : null;

    private static string ReadString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty
            : string.Empty;

    private static async Task<bool> TableExistsAsync(SqliteConnection connection, string tableName, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name LIMIT 1";
        command.Parameters.AddWithValue("$name", tableName);
        return await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is not null;
    }
}
