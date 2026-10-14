using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services;

public sealed class SharedImageStore
{
    public const string PendingSuffix = ".uploading";

    private const int HashLength = 64;

    private static readonly HashSet<string> DetectedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".gif", ".webp", ".bmp",
    };

    private readonly ImageFileLocks _locks;
    private readonly ILoggerService _logger;
    private readonly string? _directory;

    public SharedImageStore(ImageFileLocks locks, ILoggerService logger, string? directory = null)
    {
        _locks = locks;
        _logger = logger;
        _directory = directory;
    }

    public string Directory => _directory ?? MnemoAppPaths.GetImageAssetsDirectory();

    public static bool IsContentName(string? name)
    {
        if (name is null || name.Length <= HashLength || name[HashLength] != '.')
            return false;
        foreach (var c in name.AsSpan(0, HashLength))
        {
            if (!char.IsAsciiHexDigitLower(c))
                return false;
        }
        return DetectedExtensions.Contains(name[HashLength..]);
    }

    public string? Locate(string? assetId)
    {
        if (string.IsNullOrWhiteSpace(assetId)
            || assetId != Path.GetFileName(assetId)
            || assetId.Contains("..", StringComparison.Ordinal)
            || !DetectedExtensions.Contains(Path.GetExtension(assetId)))
            return null;
        var path = Path.Combine(Directory, assetId);
        return File.Exists(path) ? path : null;
    }

    public async Task<string> SaveAsync(Stream content, string? claimedExtension = null, CancellationToken cancellationToken = default)
    {
        var directory = Directory;
        System.IO.Directory.CreateDirectory(directory);
        var temp = Path.Combine(directory, Guid.NewGuid().ToString("N") + PendingSuffix);
        try
        {
            var (hash, header) = await WriteHashedAsync(content, temp, cancellationToken).ConfigureAwait(false);
            var extension = ImageContentType.DetectExtension(header)
                ?? throw new InvalidDataException("The bytes are not a supported image.");
            if (claimedExtension is not null && !ImageContentType.Matches(header, claimedExtension))
                throw new InvalidDataException($"The upload does not contain {claimedExtension} image data.");

            return await _locks.LockedAsync(directory, () => Publish(directory, temp, hash, extension), cancellationToken)
                .ConfigureAwait(false);
        }
        catch
        {
            TryDelete(temp);
            throw;
        }
    }

    public async Task<bool> RestoreAsync(string fileName, byte[] bytes, CancellationToken cancellationToken = default)
    {
        if (!IsContentName(fileName))
            return false;

        var header = bytes.AsSpan(0, Math.Min(bytes.Length, ImageContentType.HeaderBytes));
        if (Convert.ToHexStringLower(SHA256.HashData(bytes)) + ImageContentType.DetectExtension(header) != fileName)
        {
            _logger.Warning("Images", $"Packaged image '{fileName}' does not hold the bytes its name names, so it was restored beside the older images.");
            return false;
        }

        await SaveAsync(new MemoryStream(bytes), null, cancellationToken).ConfigureAwait(false);
        return true;
    }

    private string Publish(string directory, string temp, string hash, string extension)
    {
        var name = hash + extension;
        var path = Path.Combine(directory, name);
        try
        {
            File.Move(temp, path, overwrite: false);
            return name;
        }
        catch (IOException) when (File.Exists(path))
        {
        }

        if (HasSameBytes(path, temp, hash))
        {
            File.Delete(temp);
            File.SetLastWriteTimeUtc(path, DateTime.UtcNow);
            return name;
        }

        try
        {
            File.Move(temp, path, overwrite: true);
            _logger.Warning("Images", $"'{name}' no longer held the bytes its name names and was repaired.");
            return name;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Likely open while being served. The next save tries the repair again.
            var fallback = Guid.NewGuid().ToString("N") + extension;
            _logger.Warning("Images", $"'{name}' no longer holds the bytes its name names and could not be repaired, so the image was stored as '{fallback}': {ex.Message}");
            File.Move(temp, Path.Combine(directory, fallback));
            return fallback;
        }
    }

    private static bool HasSameBytes(string path, string temp, string hash)
    {
        if (new FileInfo(path).Length != new FileInfo(temp).Length)
            return false;
        using var file = File.OpenRead(path);
        return Convert.ToHexStringLower(SHA256.HashData(file)) == hash;
    }

    private static async Task<(string Hash, byte[] Header)> WriteHashedAsync(Stream content, string path, CancellationToken cancellationToken)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var header = new byte[ImageContentType.HeaderBytes];
        var headerLength = 0;
        var buffer = new byte[81920];
        await using (var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, buffer.Length, useAsync: true))
        {
            int read;
            while ((read = await content.ReadAsync(buffer, cancellationToken).ConfigureAwait(false)) > 0)
            {
                var take = Math.Min(read, header.Length - headerLength);
                buffer.AsSpan(0, take).CopyTo(header.AsSpan(headerLength));
                headerLength += take;
                hash.AppendData(buffer, 0, read);
                await file.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
            }
        }
        return (Convert.ToHexStringLower(hash.GetHashAndReset()), header[..headerLength]);
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
