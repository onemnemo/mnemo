using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;

namespace Mnemo.Core.Services.Proofing;

/// <summary>
/// The words the user has added, across every note.
/// <para>
/// Words are matched without regard to case and in composed form, so adding <c>Ordbanken</c> also
/// accepts <c>ordbanken</c>, and an accented word matches however the editor happened to encode it.
/// The casing the user typed is kept for display, because a list of names that has been lowercased
/// reads as a defect.
/// </para>
/// </summary>
public interface IPersonalDictionaryService
{
    /// <summary>How many words may be stored before further additions are refused.</summary>
    int MaxWords { get; }

    /// <summary>Every stored word, newest first. Empty when nothing has been added.</summary>
    Task<IReadOnlyList<PersonalWord>> ListAsync(CancellationToken ct);

    /// <summary>
    /// Adds a word, scoped to one language or to all of them when <paramref name="language"/> is null.
    /// The result says why nothing was stored when nothing was.
    /// </summary>
    Task<PersonalWordAddResult> AddAsync(string word, string? language, CancellationToken ct);

    /// <summary>
    /// Removes one entry. A word stored for every language and the same word scoped to one language
    /// are separate entries, so the scope has to match. Removing something absent changes nothing.
    /// </summary>
    Task RemoveAsync(string word, string? language, CancellationToken ct);

    /// <summary>
    /// The stored words in the form a check asks about them. Taken once per check rather than per
    /// word, which is the difference between one read of the list and one per flagged word.
    /// </summary>
    Task<PersonalWordLookup> LookupAsync(CancellationToken ct);
}
