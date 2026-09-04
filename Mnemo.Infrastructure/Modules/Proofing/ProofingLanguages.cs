using System;
using System.Collections.Generic;

namespace Mnemo.Infrastructure.Modules.Proofing;

/// <summary>
/// The one place a list of language tags is put into the form the rest of the system compares.
/// <para>
/// The catalog matches a tag without regard to case, so <c>en-us</c> and <c>en-US</c> both name the
/// same dictionary, while every comparison above this layer is exact: the client matches an id
/// against a catalog row with <c>===</c>, and the editor drops an answer whose language list is not
/// the one it asked for. A tag that reached storage in the caller's spelling would fail both. So
/// every list that crosses a boundary, stored, posted, hinted or echoed, comes through here first.
/// </para>
/// </summary>
public static class ProofingLanguages
{
    /// <summary>
    /// The catalog's own spelling of each tag it recognises, in first-occurrence order, without
    /// duplicates. Tags the catalog does not carry are dropped.
    /// </summary>
    public static IReadOnlyList<string> Canonical(ProofingDictionaryCatalog catalog, IEnumerable<string?>? ids)
    {
        if (ids is null)
            return [];

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var canonical = new List<string>();
        foreach (var id in ids)
        {
            if (catalog.Find(id) is not { } entry)
                continue;

            if (seen.Add(entry.Id))
                canonical.Add(entry.Id);
        }

        return canonical;
    }
}
