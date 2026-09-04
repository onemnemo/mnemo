using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;

namespace Mnemo.Core.Services.Proofing;

/// <summary>
/// The words the user has added, across every note.
/// <para>
/// Words are matched without regard to case, so adding <c>Ordbanken</c> also accepts
/// <c>ordbanken</c>. The casing the user typed is kept for display, because a list of names that has
/// been lowercased reads as a defect.
/// </para>
/// </summary>
public interface IPersonalDictionaryService
{
    /// <summary>Every stored word, newest first. Empty when nothing has been added.</summary>
    Task<IReadOnlyList<PersonalWord>> ListAsync(CancellationToken ct);

    /// <summary>
    /// Adds a word, scoped to one language or to all of them when <paramref name="language"/> is null.
    /// Adding a word that is already stored under the same scope changes nothing. A blank word is
    /// ignored.
    /// </summary>
    Task AddAsync(string word, string? language, CancellationToken ct);

    /// <summary>
    /// Removes one entry. A word stored for every language and the same word scoped to one language
    /// are separate entries, so the scope has to match. Removing something absent changes nothing.
    /// </summary>
    Task RemoveAsync(string word, string? language, CancellationToken ct);

    /// <summary>
    /// Whether this word should be accepted while checking <paramref name="language"/>. True for a
    /// match with no language scope and for a match scoped to this language.
    /// </summary>
    Task<bool> ContainsAsync(string word, string language, CancellationToken ct);
}
