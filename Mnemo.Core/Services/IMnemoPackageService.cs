using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

/// <summary>
/// Creates and imports unified <c>.mnemo</c> package files.
/// </summary>
public interface IMnemoPackageService
{
    /// <summary>
    /// Exports a package file to disk.
    /// </summary>
    Task<Result<MnemoPackageManifest>> ExportAsync(
        string outputFilePath,
        MnemoPackageExportOptions options,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Reads package metadata and import payloads from disk.
    /// </summary>
    Task<Result<MnemoPackageResult>> ImportAsync(
        string packageFilePath,
        MnemoPackageImportOptions options,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Reads package metadata and discovered payload counts without applying import changes.
    /// </summary>
    Task<Result<ImportExportPreview>> PreviewAsync(
        string packageFilePath,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Works out what importing the package would mean, comparing it against what this collection
    /// already holds. Writes nothing. Payloads whose handler cannot compare are left out.
    /// </summary>
    Task<Result<MnemoPackageEvidence>> InspectAsync(
        string packageFilePath,
        CancellationToken cancellationToken = default);
}
