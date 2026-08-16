using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Assets;

/// <summary>
/// One managed, flat directory of uploaded asset files, shared machinery for every module
/// that stores user uploads (notes, flashcards, chat). An asset id is a bare
/// <c>{guid}{ext}</c> filename, so an id can never name a path outside the directory, and
/// the id is the only thing a module ever puts on the wire or in a document.
/// </summary>
/// <remarks>
/// Instances differ only in which directory they front and which extensions they accept:
/// a <c>null</c> extension policy accepts any sanitized extension (chat attachments), a set
/// restricts ids and uploads to those types (image stores). Everything else, id validation,
/// MIME mapping, atomic writes, signature checks, is identical across modules on purpose,
/// so a fix lands everywhere at once.
/// </remarks>
public sealed class ManagedAssetStore
{
    /// <summary>Upper bound on an uploaded file (20 MB). Rejected above this.</summary>
    public const long MaxFileBytes = 20L * 1024 * 1024;

    /// <summary>
    /// Suffix of a half-written upload. <see cref="SaveAsync"/> writes to this name and
    /// renames on success, so a crash mid-upload leaves a recognizable temp file for the
    /// sweeper rather than a plausible-looking asset with truncated bytes.
    /// </summary>
    public const string PendingUploadSuffix = ".uploading";

    /// <summary>The image types the desktop pickers offer and browsers can render.</summary>
    public static readonly IReadOnlySet<string> ImageExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
    };

    private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".gif"] = "image/gif",
        [".webp"] = "image/webp",
        [".bmp"] = "image/bmp",
    };

    private readonly Func<string> _directory;
    private readonly IReadOnlySet<string>? _requiredExtensions;

    /// <param name="directory">
    /// Resolved per call rather than captured, matching how <see cref="MnemoAppPaths"/> is
    /// consumed everywhere else.
    /// </param>
    /// <param name="requiredExtensions">
    /// Extensions a valid id must carry, or null to accept any sanitized extension.
    /// </param>
    public ManagedAssetStore(Func<string> directory, IReadOnlySet<string>? requiredExtensions = null)
    {
        _directory = directory;
        _requiredExtensions = requiredExtensions;
    }

    public string Directory => _directory();

    public bool IsAllowedExtension(string? extension) =>
        _requiredExtensions is null || (!string.IsNullOrEmpty(extension) && _requiredExtensions.Contains(extension));

    public static string ContentTypeForExtension(string? extension) =>
        extension is not null && ContentTypes.TryGetValue(extension, out var type) ? type : "application/octet-stream";

    /// <summary>
    /// A well-formed asset id is a single <c>name.ext</c> path segment with no directory
    /// separators or traversal, carrying an allowed extension, the only shape
    /// <see cref="GenerateAssetId"/> mints, and the guard that keeps a serve route inside
    /// the directory.
    /// </summary>
    public bool IsValidAssetId(string? assetId)
    {
        if (string.IsNullOrWhiteSpace(assetId))
            return false;
        if (assetId.Contains('/') || assetId.Contains('\\') || assetId.Contains(".."))
            return false;
        if (!string.Equals(assetId, Path.GetFileName(assetId), StringComparison.Ordinal))
            return false;
        if (assetId.EndsWith(PendingUploadSuffix, StringComparison.OrdinalIgnoreCase))
            return false;
        return IsAllowedExtension(Path.GetExtension(assetId));
    }

    /// <summary>Keeps only a short, safe extension from an uploaded file's name; drops anything else.</summary>
    public static string SanitizeExtension(string? fileName)
    {
        var ext = Path.GetExtension(fileName) ?? string.Empty;
        if (ext.Length > 8 || ext.Any(c => !char.IsLetterOrDigit(c) && c != '.'))
            ext = string.Empty;
        return ext.ToLowerInvariant();
    }

    /// <summary>
    /// Mints an asset id carrying the given extension. The extension must already satisfy
    /// this store's policy; an endpoint rejects a bad upload before minting, so arriving
    /// here with one is a programming error, not a user error.
    /// </summary>
    public string GenerateAssetId(string? extension)
    {
        var normalized = (extension ?? string.Empty).ToLowerInvariant();
        if (!IsAllowedExtension(normalized) && _requiredExtensions is not null)
            throw new ArgumentException($"Extension '{extension}' is not accepted by this store.", nameof(extension));
        return Guid.NewGuid().ToString("N") + normalized;
    }

    /// <summary>Absolute path for a valid asset id, or null when the id is malformed.</summary>
    public string? ResolvePath(string? assetId) =>
        IsValidAssetId(assetId) ? Path.Combine(Directory, assetId!) : null;

    /// <summary>
    /// The servable asset id for a stored absolute path, or null when the path is not a
    /// managed copy under this store's directory.
    /// </summary>
    public string? AssetIdForPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !MnemoAppPaths.IsPathUnder(path, Directory))
            return null;
        var name = Path.GetFileName(path);
        return IsValidAssetId(name) ? name : null;
    }

    /// <summary>
    /// Finds the stored file for an id that arrives without its extension, the shape old
    /// <c>attachment:{guid}:{name}</c> references carry. Null when nothing matches.
    /// </summary>
    public string? FindByBareId(string? bareId) => FindByBareId(Directory, bareId, this);

    /// <summary>Same lookup against an arbitrary directory, for legacy stores this instance does not front.</summary>
    public static string? FindByBareId(string directory, string? bareId, ManagedAssetStore idPolicy)
    {
        if (string.IsNullOrWhiteSpace(bareId))
            return null;
        // The id feeds a filesystem glob, so it is held to the shape ids are actually minted
        // in (hex guids, hyphens in the oldest data) rather than merely blocked from known-bad
        // characters: `*` or `?` here would match files the caller never named.
        foreach (var c in bareId)
        {
            if (!char.IsAsciiLetterOrDigit(c) && c != '-')
                return null;
        }
        if (!System.IO.Directory.Exists(directory))
            return null;

        foreach (var candidate in System.IO.Directory.EnumerateFiles(directory, bareId + ".*"))
        {
            if (idPolicy.IsValidAssetId(Path.GetFileName(candidate)))
                return candidate;
        }
        return null;
    }

    /// <summary>
    /// Writes an upload to its final name atomically: the bytes land under a
    /// <see cref="PendingUploadSuffix"/> temp name, image content is verified against the
    /// extension it claims, and only then does the file take its servable name. Any failure
    /// removes the temp file, so a bad upload leaves nothing behind.
    /// </summary>
    /// <returns>The absolute path of the stored file.</returns>
    /// <exception cref="InvalidDataException">The bytes do not match the claimed image type.</exception>
    public async Task<string> SaveAsync(Stream content, string assetId, CancellationToken cancellationToken = default)
    {
        var finalPath = ResolvePath(assetId)
            ?? throw new ArgumentException($"Malformed asset id '{assetId}'.", nameof(assetId));

        System.IO.Directory.CreateDirectory(Directory);
        var tempPath = finalPath + PendingUploadSuffix;
        try
        {
            await using (var file = File.Create(tempPath))
                await content.CopyToAsync(file, cancellationToken).ConfigureAwait(false);

            var extension = Path.GetExtension(assetId);
            if (ImageExtensions.Contains(extension) && !await IsImageSignatureValidAsync(tempPath, extension, cancellationToken).ConfigureAwait(false))
                throw new InvalidDataException($"The upload does not contain {extension} image data.");

            File.Move(tempPath, finalPath, overwrite: true);
            return finalPath;
        }
        catch
        {
            TryDelete(tempPath);
            throw;
        }
    }

    private static async Task<bool> IsImageSignatureValidAsync(string path, string extension, CancellationToken cancellationToken)
    {
        var header = new byte[12];
        int read;
        await using (var file = File.OpenRead(path))
            read = await file.ReadAtLeastAsync(header, header.Length, throwOnEndOfStream: false, cancellationToken).ConfigureAwait(false);
        return MatchesImageSignature(header.AsSpan(0, read), extension);
    }

    /// <summary>
    /// True when the leading bytes carry the magic number of the claimed image type. A
    /// renamed executable or HTML file must not become a servable "image".
    /// </summary>
    public static bool MatchesImageSignature(ReadOnlySpan<byte> header, string? extension)
    {
        switch (extension?.ToLowerInvariant())
        {
            case ".png":
                return StartsWith(header, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
            case ".jpg":
            case ".jpeg":
                return StartsWith(header, [0xFF, 0xD8, 0xFF]);
            case ".gif":
                return StartsWith(header, "GIF87a"u8) || StartsWith(header, "GIF89a"u8);
            case ".webp":
                return header.Length >= 12
                    && StartsWith(header, "RIFF"u8)
                    && header.Slice(8, 4).SequenceEqual("WEBP"u8);
            case ".bmp":
                return StartsWith(header, "BM"u8);
            default:
                return false;
        }
    }

    private static bool StartsWith(ReadOnlySpan<byte> header, ReadOnlySpan<byte> signature) =>
        header.Length >= signature.Length && header[..signature.Length].SequenceEqual(signature);

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (IOException)
        {
            // A locked temp file stays behind; the sweeper collects pending uploads later.
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
