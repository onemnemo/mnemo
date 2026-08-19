using System;

namespace Mnemo.Infrastructure.Services;

/// <summary>
/// Recognizes the image types Mnemo stores and serves, from the leading bytes of a file.
/// </summary>
/// <remarks>
/// A filename is not evidence. An Anki package names its media files "0", "1", "2" with the real
/// names in a side table, and a crafted package can claim any name it likes, so an import decides
/// the stored type from the bytes and refuses whatever it cannot identify.
/// </remarks>
public static class ImageContentType
{
    /// <summary>Upper bound on a stored image file (20 MB).</summary>
    public const long MaxImageBytes = 20L * 1024 * 1024;

    /// <summary>Leading bytes needed to identify every recognized type.</summary>
    public const int HeaderBytes = 12;

    /// <summary>
    /// The canonical lowercase extension for the type <paramref name="header"/> actually carries,
    /// or null when it matches no supported image type. JPEG always resolves to <c>.jpg</c>.
    /// </summary>
    public static string? DetectExtension(ReadOnlySpan<byte> header)
    {
        if (StartsWith(header, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
            return ".png";
        if (StartsWith(header, [0xFF, 0xD8, 0xFF]))
            return ".jpg";
        if (StartsWith(header, "GIF87a"u8) || StartsWith(header, "GIF89a"u8))
            return ".gif";
        if (header.Length >= 12 && StartsWith(header, "RIFF"u8) && header.Slice(8, 4).SequenceEqual("WEBP"u8))
            return ".webp";
        if (StartsWith(header, "BM"u8))
            return ".bmp";
        return null;
    }

    /// <summary>
    /// True when the leading bytes carry the magic number of the claimed image type. A renamed
    /// executable or HTML file must not become a servable "image". Returns false for an unknown
    /// extension and for a header too short to identify.
    /// </summary>
    public static bool Matches(ReadOnlySpan<byte> header, string? extension)
    {
        if (string.IsNullOrEmpty(extension))
            return false;
        var detected = DetectExtension(header);
        return detected is not null
            && string.Equals(detected, Canonical(extension), StringComparison.OrdinalIgnoreCase);
    }

    private static string Canonical(string extension) =>
        string.Equals(extension, ".jpeg", StringComparison.OrdinalIgnoreCase) ? ".jpg" : extension;

    private static bool StartsWith(ReadOnlySpan<byte> header, ReadOnlySpan<byte> signature) =>
        header.Length >= signature.Length && header[..signature.Length].SequenceEqual(signature);
}
