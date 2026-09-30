using System.Buffers.Binary;

namespace Mnemo.Host.Tests.Branding;

/// <summary>
/// The smallest files that pass as PNG and ICO: a signature and header chunk, since the host
/// reads nothing past the dimensions.
/// </summary>
internal static class BrandIconFixtures
{
    public static byte[] Png(int width, int height)
    {
        var png = new byte[8 + 25 + 12];
        byte[] signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        signature.CopyTo(png, 0);
        BinaryPrimitives.WriteUInt32BigEndian(png.AsSpan(8), 13);
        "IHDR"u8.CopyTo(png.AsSpan(12));
        BinaryPrimitives.WriteUInt32BigEndian(png.AsSpan(16), (uint)width);
        BinaryPrimitives.WriteUInt32BigEndian(png.AsSpan(20), (uint)height);
        png[24] = 8;
        png[25] = 6;
        return png;
    }

    /// <summary>An ICO with one PNG entry per size, each entry declaring the size it holds.</summary>
    public static byte[] Ico(params int[] sizes) => Ico(sizes.Select(size => (size, Png(size, size))).ToArray());

    public static byte[] Ico(params (int Declared, byte[] Payload)[] entries)
    {
        var headerLength = 6 + entries.Length * 16;
        var ico = new byte[headerLength + entries.Sum(e => e.Payload.Length)];
        BinaryPrimitives.WriteUInt16LittleEndian(ico.AsSpan(2), 1);
        BinaryPrimitives.WriteUInt16LittleEndian(ico.AsSpan(4), (ushort)entries.Length);

        var offset = headerLength;
        for (var i = 0; i < entries.Length; i++)
        {
            var entry = ico.AsSpan(6 + i * 16);
            entry[0] = (byte)(entries[i].Declared % 256);
            entry[1] = (byte)(entries[i].Declared % 256);
            BinaryPrimitives.WriteUInt16LittleEndian(entry[4..], 1);
            BinaryPrimitives.WriteUInt16LittleEndian(entry[6..], 32);
            BinaryPrimitives.WriteUInt32LittleEndian(entry[8..], (uint)entries[i].Payload.Length);
            BinaryPrimitives.WriteUInt32LittleEndian(entry[12..], (uint)offset);
            entries[i].Payload.CopyTo(ico, offset);
            offset += entries[i].Payload.Length;
        }

        return ico;
    }
}
