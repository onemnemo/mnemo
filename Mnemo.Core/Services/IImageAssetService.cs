using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

public interface IImageAssetService
{
    /// <remarks>
    /// The extension comes from the content, not from the source filename, because import
    /// sources such as an Anki package store media under numbered names carrying no extension
    /// at all. Fails when the file is larger than 20 MB or is not a supported image type, so a
    /// stored asset is always servable and always what it claims to be.
    /// </remarks>
    /// <param name="sourcePath">Full path to the source image file.</param>
    /// <param name="cancellationToken">Optional cancellation token.</param>
    /// <returns>A <see cref="Result{T}"/> containing the absolute stored path on success.</returns>
    Task<Result<string>> ImportAndCopyAsync(string sourcePath, CancellationToken cancellationToken = default);
}
