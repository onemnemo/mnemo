using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

/// <summary>
/// Manages image asset files for image blocks, keeping copies under the app's
/// local data directory so notes remain intact even when the original file is deleted.
/// </summary>
public interface IImageAssetService
{
    /// <summary>
    /// Copies <paramref name="sourcePath"/> into the app images directory, naming the destination
    /// file after <paramref name="blockId"/> plus the extension of the image type the bytes
    /// actually carry. Creates the directory if it does not exist.
    /// </summary>
    /// <remarks>
    /// The extension comes from the content, not from the source filename, because import
    /// sources such as an Anki package store media under numbered names carrying no extension
    /// at all. Fails when the file is larger than 20 MB or is not a supported image type, so a
    /// stored asset is always servable and always what it claims to be.
    /// </remarks>
    /// <param name="sourcePath">Full path to the source image file.</param>
    /// <param name="blockId">Unique identifier of the image block; used as the stored filename.</param>
    /// <param name="cancellationToken">Optional cancellation token.</param>
    /// <returns>A <see cref="Result{T}"/> containing the absolute stored path on success.</returns>
    Task<Result<string>> ImportAndCopyAsync(string sourcePath, string blockId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes a previously stored image file from the app images directory.
    /// Returns success even when the file does not exist (idempotent).
    /// </summary>
    /// <param name="absolutePath">Absolute path to the stored image file.</param>
    /// <param name="cancellationToken">Optional cancellation token.</param>
    Task<Result> DeleteStoredFileAsync(string absolutePath, CancellationToken cancellationToken = default);
}
