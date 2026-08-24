using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services;

/// <summary>
/// Copies image files chosen by the user into the app-local images directory
/// so that block assets survive deletion of the original file.
/// </summary>
public sealed class ImageAssetService : IImageAssetService
{
    private readonly string? _imagesDirectory;

    /// <summary>
    /// Creates a service that copies images into <paramref name="imagesDirectory"/>. Passing null
    /// resolves the per-user images directory instead, which is what the app does. A caller that
    /// owns a directory, such as a test, passes it here rather than repointing the data root for
    /// the whole process.
    /// </summary>
    public ImageAssetService(string? imagesDirectory = null)
    {
        _imagesDirectory = imagesDirectory;
    }

    /// <inheritdoc/>
    public async Task<Result<string>> ImportAndCopyAsync(
        string sourcePath,
        string blockId,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(sourcePath))
            return Result<string>.Failure("Source path is empty.");

        if (!File.Exists(sourcePath))
            return Result<string>.Failure($"Source file not found: {sourcePath}");

        try
        {
            var length = new FileInfo(sourcePath).Length;
            if (length > ImageContentType.MaxImageBytes)
                return Result<string>.Failure($"Image exceeds the {ImageContentType.MaxImageBytes / (1024 * 1024)} MB limit.");

            var ext = await DetectExtensionAsync(sourcePath, cancellationToken).ConfigureAwait(false);
            if (ext is null)
                return Result<string>.Failure("File is not a supported image (PNG, JPEG, GIF, WebP or BMP).");

            var imagesDir = _imagesDirectory ?? MnemoAppPaths.GetImagesDirectory();
            Directory.CreateDirectory(imagesDir);

            var dest = Path.Combine(imagesDir, blockId + ext);

            await Task.Run(() => File.Copy(sourcePath, dest, overwrite: true), cancellationToken)
                .ConfigureAwait(false);

            return Result<string>.Success(dest);
        }
        catch (OperationCanceledException)
        {
            return Result<string>.Failure("Image import was cancelled.");
        }
        catch (Exception ex)
        {
            return Result<string>.Failure($"Failed to copy image: {ex.Message}", ex);
        }
    }

    private static async Task<string?> DetectExtensionAsync(string sourcePath, CancellationToken cancellationToken)
    {
        var header = new byte[ImageContentType.HeaderBytes];
        int read;
        await using (var file = File.OpenRead(sourcePath))
            read = await file.ReadAtLeastAsync(header, header.Length, throwOnEndOfStream: false, cancellationToken)
                .ConfigureAwait(false);
        return ImageContentType.DetectExtension(header.AsSpan(0, read));
    }

    /// <inheritdoc/>
    public async Task<Result> DeleteStoredFileAsync(
        string absolutePath,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(absolutePath))
            return Result.Success();

        try
        {
            if (File.Exists(absolutePath))
                await Task.Run(() => File.Delete(absolutePath), cancellationToken)
                    .ConfigureAwait(false);

            return Result.Success();
        }
        catch (OperationCanceledException)
        {
            return Result.Failure("Delete was cancelled.");
        }
        catch (Exception ex)
        {
            return Result.Failure($"Failed to delete stored image: {ex.Message}", ex);
        }
    }
}
