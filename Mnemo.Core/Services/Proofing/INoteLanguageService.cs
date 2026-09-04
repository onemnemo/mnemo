using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;

namespace Mnemo.Core.Services.Proofing;

/// <summary>
/// The languages one note is checked in when it does not follow the ones chosen in settings, for
/// the case where a single document is written in something other than the rest of them.
/// </summary>
public interface INoteLanguageService
{
    /// <summary>How many notes may hold a choice before a further note is refused one.</summary>
    int MaxNotes { get; }

    /// <summary>This note's stored choice, or null when it follows the languages settings names.</summary>
    Task<NoteLanguageEntry?> GetAsync(string noteId, CancellationToken ct);

    /// <summary>
    /// Stores one note's choice, replacing whatever it had. Returns false when the map already holds
    /// <see cref="MaxNotes"/> notes and this one is not among them, so the caller can say why nothing
    /// happened. A note that already has an entry can always be rewritten.
    /// </summary>
    Task<bool> SetAsync(string noteId, NoteLanguageEntry entry, CancellationToken ct);

    /// <summary>Drops a note's choice, so it follows settings again. Clearing an unknown note changes nothing.</summary>
    Task ClearAsync(string noteId, CancellationToken ct);

    /// <summary>Every stored choice, by note id. What a backup has to carry.</summary>
    Task<IReadOnlyDictionary<string, NoteLanguageEntry>> GetAllAsync(CancellationToken ct);
}
