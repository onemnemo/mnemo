using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

/// <summary>
/// Handles export/import for a single payload type inside a <c>.mnemo</c> package.
/// </summary>
public interface IMnemoPayloadHandler
{
    /// <summary>
    /// Stable payload identifier (for example <c>notes</c> or <c>mindmaps</c>).
    /// </summary>
    string PayloadType { get; }

    /// <summary>
    /// Payload types whose id renames this payload follows, so an import stores them first. Empty
    /// for a payload that refers to nothing outside itself.
    /// </summary>
    IReadOnlyCollection<string> ImportsAfter => Array.Empty<string>();

    /// <summary>
    /// Exports payload data into package files.
    /// </summary>
    Task<MnemoPayloadExportData> ExportAsync(MnemoPayloadExportContext context, CancellationToken cancellationToken = default);

    /// <summary>
    /// Imports payload data from package files.
    /// </summary>
    Task<MnemoPayloadImportResult> ImportAsync(MnemoPayloadImportContext context, CancellationToken cancellationToken = default);
}
