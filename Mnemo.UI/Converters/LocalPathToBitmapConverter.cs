using System;
using System.Collections.Concurrent;
using System.Globalization;
using System.IO;
using Avalonia.Data.Converters;
using Avalonia.Media.Imaging;

namespace Mnemo.UI.Converters;

/// <summary>
/// Converts a local file path to a Bitmap for preview. Returns null if the path is invalid or not an image.
/// Caches decoded bitmaps by path+last-write-time; without this, every binding evaluation re-decoded the file
/// on the UI thread (chat attachments, image lists, profile previews).
/// </summary>
public class LocalPathToBitmapConverter : IValueConverter
{
    public static readonly LocalPathToBitmapConverter Instance = new();

    // Bounded by usage; a paranoid evictor keeps it under a soft limit.
    private const int MaxEntries = 128;
    private static readonly ConcurrentDictionary<CacheKey, Bitmap> Cache = new();

    private readonly record struct CacheKey(string Path, long WriteTimeTicks, long Length);

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not string path || string.IsNullOrEmpty(path))
            return null;

        FileInfo fi;
        try
        {
            fi = new FileInfo(path);
            if (!fi.Exists) return null;
        }
        catch
        {
            return null;
        }

        var key = new CacheKey(path, fi.LastWriteTimeUtc.Ticks, fi.Length);
        if (Cache.TryGetValue(key, out var cached))
            return cached;

        try
        {
            var bitmap = new Bitmap(path);
            if (Cache.Count >= MaxEntries)
                EvictOne();
            Cache.TryAdd(key, bitmap);
            return bitmap;
        }
        catch
        {
            return null;
        }
    }

    private static void EvictOne()
    {
        // Drop a single arbitrary entry. Cheap and good enough; bitmaps for stale paths/timestamps
        // can't be re-fetched on demand cost-free, but image previews are not on the absolute hot path.
        foreach (var kv in Cache)
        {
            if (Cache.TryRemove(kv.Key, out var bmp))
            {
                bmp.Dispose();
                return;
            }
        }
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
