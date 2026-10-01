using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Mnemo.Core.Models;

/// <summary>
/// One warning surfaced by a transfer operation (an import, an export, or a preview of either),
/// carried as a translation key plus the values a locale needs to render it. Never holds English
/// prose: a count, a name or inner error text travels in <see cref="Params"/> so every caller
/// renders the same warning in the reader's own language.
/// </summary>
/// <remarks>
/// Keys resolve against the shared <c>TransferWarnings</c> translation namespace in
/// <c>Mnemo.Infrastructure/Languages</c>. The namespace is not specific to today's adapters: a
/// warning a later feature adds, such as a backup restore evidence dialog or an Anki
/// review-history import, is just another key in the same place.
/// </remarks>
public sealed record TransferWarning
{
    private static readonly IReadOnlyDictionary<string, string> EmptyParams =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public required string Key { get; init; }

    public IReadOnlyDictionary<string, string> Params { get; init; } = EmptyParams;

    /// <summary>
    /// The singular key of a counted warning, read when <see cref="Count"/> takes the "one" form
    /// in the reader's language; <see cref="Key"/> is then the plural key. Null for a warning that
    /// carries no count to agree with.
    /// </summary>
    public string? OneKey { get; init; }

    /// <summary>The count <see cref="OneKey"/> and <see cref="Key"/> agree with, also sent as the <c>count</c> param.</summary>
    public int? Count { get; init; }

    /// <summary>
    /// How the line is presented: a problem, or news such as how many cards came across. Defaults
    /// to a warning, so only a caller that opts in renders without the warning treatment.
    /// </summary>
    public TransferWarningSeverity Severity { get; init; } = TransferWarningSeverity.Warning;

    public static TransferWarning Of(string key) => new() { Key = key };

    public static TransferWarning Of(string key, params (string Name, string Value)[] parameters) =>
        new()
        {
            Key = key,
            Params = parameters.ToDictionary(p => p.Name, p => p.Value, StringComparer.Ordinal)
        };

    /// <summary>
    /// A warning whose wording agrees with <paramref name="count"/>: the client picks
    /// <paramref name="oneKey"/> or <paramref name="manyKey"/> by the reader's plural rules, since
    /// only it knows the language. Both keys are literals so a search finds this call.
    /// </summary>
    public static TransferWarning Counted(
        string oneKey,
        string manyKey,
        int count,
        params (string Name, string Value)[] parameters)
    {
        var merged = parameters.ToDictionary(p => p.Name, p => p.Value, StringComparer.Ordinal);
        merged["count"] = count.ToString(CultureInfo.InvariantCulture);
        return new TransferWarning { Key = manyKey, OneKey = oneKey, Count = count, Params = merged };
    }

    /// <summary>The same line reported as information, such as how many cards came across.</summary>
    public TransferWarning AsInfo() => this with { Severity = TransferWarningSeverity.Info };
}

/// <summary>How a transfer line is presented: a problem to look at, or plain information.</summary>
public enum TransferWarningSeverity
{
    Warning,
    Info
}
