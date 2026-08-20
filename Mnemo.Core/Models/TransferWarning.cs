using System.Collections.Generic;
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
public sealed class TransferWarning
{
    private static readonly IReadOnlyDictionary<string, string> EmptyParams =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public required string Key { get; init; }

    public IReadOnlyDictionary<string, string> Params { get; init; } = EmptyParams;

    public static TransferWarning Of(string key) => new() { Key = key };

    public static TransferWarning Of(string key, params (string Name, string Value)[] parameters) =>
        new()
        {
            Key = key,
            Params = parameters.ToDictionary(p => p.Name, p => p.Value, StringComparer.Ordinal)
        };
}
