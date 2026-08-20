using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Notes.Persistence;

/// <summary>
/// Reads notes without their bodies, for the callers that list the library and never open it.
/// </summary>
/// <remarks>
/// Separate from the writer contract because it is the one note read that is worth expressing as a
/// projection: the fields a list shows are a handful of scalars, and fetching them by loading whole
/// notes parses every block in the corpus to answer a question about none of them.
/// </remarks>
public interface INoteSummaryStore
{
    /// <summary>
    /// The summaries of the given notes, in the order they were asked for, leaving out any id with no
    /// stored row. Order is the caller's to decide; this only promises not to lose the one it was
    /// handed, because a caller that sorts on equal keys depends on it.
    /// </summary>
    Task<IReadOnlyList<NoteSummary>> ReadSummariesAsync(IReadOnlyList<string> noteIds, CancellationToken cancellationToken = default);
}
