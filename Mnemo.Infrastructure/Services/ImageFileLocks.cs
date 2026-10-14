using System;
using System.Collections.Concurrent;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Mnemo.Infrastructure.Services;

/// <summary>One lock per image directory. A delete re-checks the write time under it.</summary>
public sealed class ImageFileLocks
{
    public static readonly TimeSpan DefaultGrace = TimeSpan.FromHours(1);

    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new(StringComparer.OrdinalIgnoreCase);

    public async Task<T> LockedAsync<T>(string directory, Func<T> work, CancellationToken cancellationToken = default)
    {
        var gate = _locks.GetOrAdd(Path.GetFullPath(directory), _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return work();
        }
        finally
        {
            gate.Release();
        }
    }

    public Task<bool> DeleteIfStaleAsync(string path, TimeSpan grace, CancellationToken cancellationToken = default) =>
        LockedAsync(Path.GetDirectoryName(Path.GetFullPath(path))!, () =>
        {
            if (!File.Exists(path) || IsYoung(path, grace))
                return false;
            File.Delete(path);
            return true;
        }, cancellationToken);

    /// <summary>Uses the later of creation and write time, because a copy can carry an old write time.</summary>
    public static bool IsYoung(string path, TimeSpan grace)
    {
        var created = File.GetCreationTimeUtc(path);
        var written = File.GetLastWriteTimeUtc(path);
        return (created > written ? created : written) > DateTime.UtcNow - grace;
    }
}
