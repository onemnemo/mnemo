using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Mnemo.Core.Services.Proofing;

/// <summary>
/// Words a single note accepts that the dictionary does not, for the case where a term belongs to
/// one piece of writing rather than to the user's vocabulary.
/// </summary>
public interface INoteIgnoreService
{
    /// <summary>How many words one note may ignore before further additions are refused.</summary>
    int MaxWordsPerNote { get; }

    /// <summary>The words this note ignores, in insertion order. Empty for an unknown note.</summary>
    Task<IReadOnlyList<string>> ListAsync(string noteId, CancellationToken ct);

    /// <summary>
    /// Adds a word for one note. Returns false when the note is already at
    /// <see cref="MaxWordsPerNote"/> and the word is not already there, so the caller can say why
    /// nothing happened. Matching ignores case.
    /// </summary>
    Task<bool> AddAsync(string noteId, string word, CancellationToken ct);

    /// <summary>Removes a word from one note. Removing something absent changes nothing.</summary>
    Task RemoveAsync(string noteId, string word, CancellationToken ct);

    /// <summary>Every stored list, by note id. What a backup has to carry.</summary>
    Task<IReadOnlyDictionary<string, IReadOnlyList<string>>> GetAllAsync(CancellationToken ct);
}
