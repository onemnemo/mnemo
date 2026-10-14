using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Mnemo.Core.Services;
using Mnemo.Host.Lifecycle;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services;

namespace Mnemo.Host.Assets;

public sealed class DuplicateImageFold
{
    private const string TempSuffix = ".folding";
    private const int MaxFailedRuns = 3;
    private const int WindowsTooManyLinks = 1142;
    private const int UnixTooManyLinks = 31;

    private readonly ImageFileLocks _locks;
    private readonly Func<string> _directory;
    private readonly Func<string?> _held;
    private readonly ILoggerService _logger;
    private readonly TimeSpan _grace;

    public DuplicateImageFold(ImageFileLocks locks, HostInstanceLock instanceLock, ILoggerService logger)
        : this(
            locks,
            MnemoAppPaths.GetImagesDirectory,
            () => instanceLock.AnotherInstanceIsRunning() ? "another app instance is running" : null,
            logger,
            ImageFileLocks.DefaultGrace)
    {
    }

    public DuplicateImageFold(ImageFileLocks locks, Func<string> directory, Func<string?> held, ILoggerService logger, TimeSpan grace)
    {
        _locks = locks;
        _directory = directory;
        _held = held;
        _logger = logger;
        _grace = grace;
    }

    private enum FoldOutcome
    {
        Done,
        TooManyLinks,
        Failed,
    }

    private enum RunResult
    {
        Finished,
        Waiting,
        Failed,
    }

    public void RunInBackground()
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await RunAsync().ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.Error("Mnemo.Host", "Folding duplicate images failed.", ex);
            }
        });
    }

    public async Task<bool> RunAsync(CancellationToken cancellationToken = default)
    {
        var directory = _directory();
        if (!Directory.Exists(directory))
            return true;
        if (_held() is not null)
            return false;

        foreach (var temp in Directory.GetFiles(directory, "*" + TempSuffix))
            TryDelete(temp);

        var marker = Path.Combine(directory, MnemoAppPaths.ImagesFoldedMarkerName);
        if (FailedRuns(marker) is not { } failedRuns)
            return true;

        var result = await FoldAsync(directory, cancellationToken).ConfigureAwait(false);
        if (result == RunResult.Waiting)
            return false;
        if (result == RunResult.Failed && failedRuns + 1 < MaxFailedRuns)
        {
            File.WriteAllText(marker, (failedRuns + 1).ToString(CultureInfo.InvariantCulture));
            return false;
        }
        if (result == RunResult.Failed)
            _logger.Warning("Mnemo.Host", $"Stopped folding duplicate images in '{directory}' after {MaxFailedRuns} failed runs. Some stay copies.");
        File.WriteAllText(marker, string.Empty);
        return true;
    }

    private static int? FailedRuns(string marker)
    {
        if (!File.Exists(marker))
            return 0;
        return int.TryParse(File.ReadAllText(marker), NumberStyles.None, CultureInfo.InvariantCulture, out var runs) ? runs : null;
    }

    private async Task<RunResult> FoldAsync(string directory, CancellationToken cancellationToken)
    {
        var files = new DirectoryInfo(directory).GetFiles()
            .Where(file => ManagedAssetStore.ImageExtensions.Contains(file.Extension) && file.LinkTarget is null)
            .ToList();
        var waiting = files.RemoveAll(file => ImageFileLocks.IsYoung(file.FullName, _grace)) > 0;

        foreach (var sameSize in files.GroupBy(file => file.Length).Where(group => group.Count() > 1))
        {
            cancellationToken.ThrowIfCancellationRequested();
            string[][] groups;
            try
            {
                groups = sameSize
                    .GroupBy(file => Hash(file.FullName))
                    .Where(group => group.Count() > 1)
                    .Select(group => group.Select(file => file.FullName).Order(StringComparer.Ordinal).ToArray())
                    .ToArray();
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                _logger.Warning("Mnemo.Host", $"Could not read an image to fold, retrying at the next start: {ex.Message}");
                return RunResult.Failed;
            }

            foreach (var group in groups)
            {
                var canonical = group[0];
                foreach (var duplicate in group.Skip(1))
                {
                    if (_held() is not null)
                        return RunResult.Waiting;
                    var outcome = await _locks
                        .LockedAsync(directory, () => TryFold(canonical, duplicate), cancellationToken)
                        .ConfigureAwait(false);
                    if (outcome == FoldOutcome.Failed)
                        return RunResult.Failed;
                    // At the link limit the duplicate becomes the next canonical file.
                    if (outcome == FoldOutcome.TooManyLinks)
                        canonical = duplicate;
                }
            }
        }
        return waiting ? RunResult.Waiting : RunResult.Finished;
    }

    private FoldOutcome TryFold(string canonical, string duplicate)
    {
        var temp = $"{duplicate}.{Guid.NewGuid():N}{TempSuffix}";
        try
        {
            if (!File.Exists(canonical) || !File.Exists(duplicate))
                return FoldOutcome.Done;
            if (!SameBytes(canonical, duplicate))
                return FoldOutcome.Failed;

            if (!TryCreateHardLink(temp, canonical, out var error))
            {
                if (error == (OperatingSystem.IsWindows() ? WindowsTooManyLinks : UnixTooManyLinks))
                    return FoldOutcome.TooManyLinks;
                _logger.Warning("Mnemo.Host", $"Could not link '{duplicate}' to '{canonical}' (error {error}), retrying at the next start.");
                return FoldOutcome.Failed;
            }
            File.Move(temp, duplicate, overwrite: true);
            // On Unix a rename onto another link to the same file leaves the source behind.
            if (File.Exists(temp))
                File.Delete(temp);
            return FoldOutcome.Done;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.Warning("Mnemo.Host", $"Could not fold '{duplicate}' into '{canonical}', retrying at the next start: {ex.Message}");
            if (File.Exists(temp))
                TryDelete(temp);
            return FoldOutcome.Failed;
        }
    }

    private void TryDelete(string temp)
    {
        try
        {
            File.Delete(temp);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.Warning("Mnemo.Host", $"Could not remove the leftover fold link '{temp}': {ex.Message}");
        }
    }

    private static string Hash(string path)
    {
        using var file = File.OpenRead(path);
        return Convert.ToHexStringLower(SHA256.HashData(file));
    }

    private static bool SameBytes(string first, string second)
    {
        using var a = File.OpenRead(first);
        using var b = File.OpenRead(second);
        var bufferA = new byte[81920];
        var bufferB = new byte[81920];
        int read;
        while ((read = a.ReadAtLeast(bufferA, bufferA.Length, throwOnEndOfStream: false)) > 0)
        {
            if (b.ReadAtLeast(bufferB, read, throwOnEndOfStream: false) != read || !bufferA.AsSpan(0, read).SequenceEqual(bufferB.AsSpan(0, read)))
                return false;
        }
        return b.ReadByte() == -1;
    }

    private static bool TryCreateHardLink(string link, string existing, out int error)
    {
        error = 0;
        try
        {
            var made = OperatingSystem.IsWindows() ? CreateHardLinkW(link, existing, IntPtr.Zero)
                : OperatingSystem.IsLinux() ? LinkLinux(existing, link) == 0
                : LinkUnix(existing, link) == 0;
            if (!made)
                error = Marshal.GetLastPInvokeError();
            return made;
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException)
        {
            error = -1;
            return false;
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateHardLinkW(string fileName, string existingFileName, IntPtr securityAttributes);

    [DllImport("libc.so.6", EntryPoint = "link", SetLastError = true)]
    private static extern int LinkLinux(string existing, string link);

    [DllImport("libc", EntryPoint = "link", SetLastError = true)]
    private static extern int LinkUnix(string existing, string link);
}
