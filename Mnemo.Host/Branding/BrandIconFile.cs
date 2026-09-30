using System.Buffers.Binary;

namespace Mnemo.Host.Branding;

/// <summary>
/// The one icon file each platform takes, and the checks an uploaded file has to pass before it
/// is stored. The renderer builds the file; the host only proves it is the shape it claims.
/// </summary>
public static class BrandIconFile
{
    /// <summary>An ICO whose entries are PNG payloads, one of them 256 pixels. Windows.</summary>
    public const string Ico = "ico";

    /// <summary>A 256 pixel square PNG. Linux.</summary>
    public const string Png256 = "png256";

    /// <summary>A 1024 pixel square PNG. macOS.</summary>
    public const string Png1024 = "png1024";

    public const int MaxKeyLength = 64;

    /// <summary>More than every size the renderer draws, few enough to bound the parse.</summary>
    public const int MaxIcoEntries = 8;

    private const int IcoHeaderBytes = 6;
    private const int IcoEntryBytes = 16;
    private const int PngHeaderBytes = 33;

    private static ReadOnlySpan<byte> PngSignature => [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary>The format this operating system's window icon takes, or null where there is none.</summary>
    public static string? ForCurrentPlatform()
    {
        if (OperatingSystem.IsWindows())
            return Ico;
        if (OperatingSystem.IsMacOS())
            return Png1024;
        return OperatingSystem.IsLinux() ? Png256 : null;
    }

    /// <summary>The file extension a stored icon of <paramref name="format"/> gets, dot included.</summary>
    public static string ExtensionFor(string format) => format == Ico ? ".ico" : ".png";

    /// <summary>
    /// True for a key of 1 to <see cref="MaxKeyLength"/> characters drawn from lowercase ASCII
    /// letters, digits, colon, dot and hyphen. Null and empty are not keys.
    /// </summary>
    public static bool IsValidKey(string? key)
    {
        if (string.IsNullOrEmpty(key) || key.Length > MaxKeyLength)
            return false;

        foreach (var c in key)
        {
            if (!(c is >= 'a' and <= 'z' or >= '0' and <= '9' or ':' or '.' or '-'))
                return false;
        }

        return true;
    }

    /// <summary>
    /// The file name a valid key is stored under. The colon is the only key character a
    /// Windows file name refuses, and underscore is not a key character, so the mapping stays
    /// one to one.
    /// </summary>
    public static string FileNameFor(string key, string format) =>
        "icon-" + key.Replace(':', '_') + ExtensionFor(format);

    /// <summary>
    /// Checks <paramref name="file"/> against <paramref name="format"/>. Returns null when it
    /// passes, otherwise an error code: <c>invalid_png</c>, <c>wrong_size</c>,
    /// <c>invalid_ico</c>, <c>missing_256</c>, or <c>unsupported_format</c> for a format this
    /// host does not know.
    /// </summary>
    public static string? Validate(string format, ReadOnlySpan<byte> file) => format switch
    {
        Png256 => ValidateSquarePng(file, 256),
        Png1024 => ValidateSquarePng(file, 1024),
        Ico => ValidateIco(file),
        _ => "unsupported_format",
    };

    private static string? ValidateSquarePng(ReadOnlySpan<byte> file, int size)
    {
        if (!TryReadPngSize(file, out var width, out var height))
            return "invalid_png";
        return width == size && height == size ? null : "wrong_size";
    }

    private static string? ValidateIco(ReadOnlySpan<byte> file)
    {
        if (file.Length < IcoHeaderBytes)
            return "invalid_ico";

        var reserved = BinaryPrimitives.ReadUInt16LittleEndian(file);
        var type = BinaryPrimitives.ReadUInt16LittleEndian(file[2..]);
        var count = BinaryPrimitives.ReadUInt16LittleEndian(file[4..]);
        if (reserved != 0 || type != 1 || count is < 1 or > MaxIcoEntries)
            return "invalid_ico";

        var directoryEnd = IcoHeaderBytes + count * IcoEntryBytes;
        if (file.Length < directoryEnd)
            return "invalid_ico";

        var has256 = false;
        for (var i = 0; i < count; i++)
        {
            var entry = file.Slice(IcoHeaderBytes + i * IcoEntryBytes, IcoEntryBytes);
            // A zero byte is how the format spells 256.
            var width = entry[0] == 0 ? 256 : entry[0];
            var height = entry[1] == 0 ? 256 : entry[1];
            var length = BinaryPrimitives.ReadUInt32LittleEndian(entry[8..]);
            var offset = BinaryPrimitives.ReadUInt32LittleEndian(entry[12..]);

            if (offset < directoryEnd || length > (uint)file.Length || offset > (uint)file.Length - length)
                return "invalid_ico";

            var payload = file.Slice((int)offset, (int)length);
            if (!TryReadPngSize(payload, out var pngWidth, out var pngHeight))
                return "invalid_ico";
            if (pngWidth != width || pngHeight != height)
                return "wrong_size";

            has256 |= width == 256 && height == 256;
        }

        return has256 ? null : "missing_256";
    }

    /// <summary>
    /// Reads the dimensions from a PNG's header chunk. False when the signature or the IHDR
    /// chunk that must follow it is missing or malformed.
    /// </summary>
    internal static bool TryReadPngSize(ReadOnlySpan<byte> data, out int width, out int height)
    {
        width = height = 0;
        if (data.Length < PngHeaderBytes || !data[..8].SequenceEqual(PngSignature))
            return false;

        if (BinaryPrimitives.ReadUInt32BigEndian(data[8..]) != 13 || !data.Slice(12, 4).SequenceEqual("IHDR"u8))
            return false;

        var w = BinaryPrimitives.ReadUInt32BigEndian(data[16..]);
        var h = BinaryPrimitives.ReadUInt32BigEndian(data[20..]);
        if (w is 0 or > int.MaxValue || h is 0 or > int.MaxValue)
            return false;

        width = (int)w;
        height = (int)h;
        return true;
    }
}
