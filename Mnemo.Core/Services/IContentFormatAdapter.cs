using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

/// <summary>
/// Provides import/export support for one content type and external format.
/// </summary>
public interface IContentFormatAdapter
{
    string ContentType { get; }

    string FormatId { get; }

    string DisplayName { get; }

    IReadOnlyList<string> Extensions { get; }

    bool SupportsImport { get; }

    bool SupportsExport { get; }

    /// <summary>
    /// Whether an import of this format reads <see cref="ImportExportOptionKeys.ConflictPolicy"/>.
    /// A format whose files carry no ids to collide on cannot, and every import of one is new
    /// content no matter what the caller asked for. Surfaces so a client can stop offering a choice
    /// that would not be applied. Honouring it is the norm, so the default says so.
    /// </summary>
    bool SupportsConflictPolicy => true;

    Task<ImportExportPreview> PreviewImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default);

    Task<ImportExportResult> ImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default);

    Task<ImportExportResult> ExportAsync(ImportExportRequest request, CancellationToken cancellationToken = default);
}
