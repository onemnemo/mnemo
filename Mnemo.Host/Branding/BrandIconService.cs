using System.Runtime.Versioning;
using System.Text.Json;
using Mnemo.Core.Services;
using Mnemo.Host.Chrome;
using Mnemo.Infrastructure.Common;
using Photino.NET;

namespace Mnemo.Host.Branding;

/// <summary>
/// Keeps the icon the user chose for the app, and puts it on the window, the macOS Dock and
/// the Windows shortcuts. Files live under the data root's <c>brand</c> folder, named after
/// their key, with <c>current.json</c> recording which one is in force.
/// </summary>
/// <remarks>
/// Works with no window attached: the files are stored and reported, and there is simply
/// nothing to show them on.
/// </remarks>
public sealed class BrandIconService
{
    /// <summary>The largest request body the upload route reads, base64 included.</summary>
    public const int MaxBodyBytes = 2 * 1024 * 1024;

    /// <summary>The largest decoded icon file stored.</summary>
    public const int MaxFileBytes = MaxBodyBytes / 4 * 3;

    private const string LogCategory = "BrandIcon";
    private const string StateFileName = "current.json";
    private const string IconPrefix = "icon-";

    private readonly string _directory;
    private readonly string _defaultIconDirectory;
    private readonly ILoggerService _logger;
    private readonly IShortcutIconSync? _shortcuts;
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly SemaphoreSlim _shortcutLock = new(1, 1);
    private volatile PhotinoWindow? _window;
    private volatile string? _format;
    private Task _lastShortcutSync = Task.CompletedTask;

    public BrandIconService(ILoggerService logger)
        : this(
            Path.Combine(MnemoAppPaths.GetLocalUserDataRoot(), "brand"),
            Path.Combine(AppContext.BaseDirectory, "Branding", "Default"),
            logger,
            OperatingSystem.IsWindows() ? WindowsShortcutIcon.ForInstalledApp(logger) : null)
    {
    }

    internal BrandIconService(
        string directory,
        string defaultIconDirectory,
        ILoggerService logger,
        IShortcutIconSync? shortcuts)
    {
        _directory = directory;
        _defaultIconDirectory = defaultIconDirectory;
        _logger = logger;
        _shortcuts = shortcuts;
    }

    /// <summary>
    /// The file format the attached window takes, one of <see cref="BrandIconFile"/>'s names.
    /// Null until a window is attached, and always null in a headless host.
    /// </summary>
    public string? Format => _format;

    /// <summary>The key of the stored icon in force, or null when the shipped default is.</summary>
    public string? CurrentKey => ReadCurrent()?.Key;

    /// <summary>
    /// Puts the stored icon on <paramref name="window"/> before it runs, and brings the
    /// Windows shortcuts back in line, since every update rewrites them.
    /// </summary>
    public void Attach(PhotinoWindow window)
    {
        _format = BrandIconFile.ForCurrentPlatform();
        _window = window;

        var current = ReadCurrent();
        if (current is not null)
        {
            var path = current.Path;
            if (OperatingSystem.IsMacOS())
            {
                // The Dock icon belongs to NSApplication, which only answers on the main
                // thread once PhotinoX has started it.
                ShowOnDockWhenCreated(window, path);
            }
            else
            {
                // Before Run this only records the path for PhotinoX to load at creation.
                window.SetIconFile(path);
            }
        }

        QueueSettle();
    }

    [SupportedOSPlatform("macos")]
    private void ShowOnDockWhenCreated(PhotinoWindow window, string path) =>
        window.RegisterCreatedHandler((_, _) => MacWindow.SetAppIcon(path, _logger));

    /// <summary>Stands in for an attached window where there is none, so the store can be exercised.</summary>
    internal void UseFormat(string format) => _format = format;

    /// <summary>Completes once the most recently queued shortcut update and cleanup have finished.</summary>
    internal Task ShortcutSyncSettled => Volatile.Read(ref _lastShortcutSync);

    /// <summary>
    /// Validates and stores the icon file for <paramref name="key"/>, then shows it. Returns null
    /// on success, otherwise an error code: <c>unsupported</c> with no window format,
    /// <c>invalid_key</c>, <c>invalid_data</c> for missing or non-base64 data,
    /// <c>too_large</c>, <c>write_failed</c>, or one of <see cref="BrandIconFile.Validate"/>'s.
    /// </summary>
    public async Task<string?> StoreAsync(string? key, string? data, CancellationToken cancellationToken)
    {
        var format = _format;
        if (format is null)
            return "unsupported";
        if (!BrandIconFile.IsValidKey(key))
            return "invalid_key";
        if (string.IsNullOrEmpty(data))
            return "invalid_data";

        var buffer = new byte[data.Length / 4 * 3 + 3];
        if (!Convert.TryFromBase64String(data, buffer, out var length))
            return "invalid_data";
        if (length > MaxFileBytes)
            return "too_large";

        var bytes = buffer.AsMemory(0, length);
        var invalid = BrandIconFile.Validate(format, bytes.Span);
        if (invalid is not null)
            return invalid;

        var fileName = BrandIconFile.FileNameFor(key!, format);
        var path = Path.Combine(_directory, fileName);

        await _writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            Directory.CreateDirectory(_directory);
            await WriteAtomicallyAsync(path, bytes, cancellationToken).ConfigureAwait(false);
            var state = JsonSerializer.SerializeToUtf8Bytes(new StoredIcon(key!, fileName));
            await WriteAtomicallyAsync(Path.Combine(_directory, StateFileName), state, cancellationToken).ConfigureAwait(false);

            ShowOnWindow(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.Error(LogCategory, $"Could not store the app icon for key {key} in {_directory}.", ex);
            return "write_failed";
        }
        finally
        {
            _writeLock.Release();
        }

        QueueSettle();
        return null;
    }

    /// <summary>
    /// Goes back to the shipped icon and removes every stored one. Returns false when the record
    /// of the stored icon could not be removed, so it stays in force. An icon file the system
    /// still holds open is left for the next switch or launch to remove.
    /// </summary>
    public async Task<bool> ClearAsync(CancellationToken cancellationToken)
    {
        await _writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var statePath = Path.Combine(_directory, StateFileName);
            if (File.Exists(statePath))
                File.Delete(statePath);
            ShowOnWindow(null);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.Error(LogCategory, $"Could not reset the app icon in {_directory}.", ex);
            return false;
        }
        finally
        {
            _writeLock.Release();
        }

        QueueSettle();
        return true;
    }

    private sealed record StoredIcon(string Key, string File);

    private sealed record CurrentIcon(string Key, string FileName, string Path);

    private CurrentIcon? ReadCurrent()
    {
        var statePath = Path.Combine(_directory, StateFileName);
        if (!File.Exists(statePath))
            return null;

        StoredIcon? stored;
        try
        {
            // Shared for delete so a concurrent read never makes a switch or a reset fail.
            using var stream = new FileStream(statePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            stored = JsonSerializer.Deserialize<StoredIcon>(stream);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            _logger.Warning(LogCategory, $"Could not read the stored app icon record at {statePath}: {ex.Message}");
            return null;
        }

        // The record names a file in this folder and nothing else, whatever was written into it.
        if (stored is null
            || !BrandIconFile.IsValidKey(stored.Key)
            || string.IsNullOrEmpty(stored.File)
            || !stored.File.StartsWith(IconPrefix, StringComparison.Ordinal)
            || stored.File != Path.GetFileName(stored.File))
        {
            return null;
        }

        var path = Path.Combine(_directory, stored.File);
        return File.Exists(path) ? new CurrentIcon(stored.Key, stored.File, path) : null;
    }

    private static async Task WriteAtomicallyAsync(string path, ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken)
    {
        var temp = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            await File.WriteAllBytesAsync(temp, bytes, cancellationToken).ConfigureAwait(false);
            File.Move(temp, path, overwrite: true);
        }
        catch
        {
            if (File.Exists(temp))
                File.Delete(temp);
            throw;
        }
    }

    /// <summary>Shows <paramref name="path"/> on the window, or the shipped icon when it is null.</summary>
    private void ShowOnWindow(string? path)
    {
        var window = _window;
        if (window is null)
            return;

        if (OperatingSystem.IsMacOS())
        {
            // Never SetIconFile here: the Dock icon is the app's, not the window's.
            ShowOnDock(window, path);
            return;
        }

        var file = path ?? DefaultIconPath();
        if (file is null)
        {
            _logger.Warning(LogCategory, $"No shipped app icon found in {_defaultIconDirectory}; the window keeps its current icon.");
            return;
        }

        InvokeOnWindow(window, () => window.SetIconFile(file));
    }

    [SupportedOSPlatform("macos")]
    private void ShowOnDock(PhotinoWindow window, string? path) =>
        InvokeOnWindow(window, () => MacWindow.SetAppIcon(path, _logger));

    private string? DefaultIconPath()
    {
        var name = OperatingSystem.IsWindows() ? "mnemo.ico" : "mnemo-256.png";
        var path = Path.Combine(_defaultIconDirectory, name);
        return File.Exists(path) ? path : null;
    }

    private void InvokeOnWindow(PhotinoWindow window, Action apply)
    {
        try
        {
            window.Invoke(apply);
        }
        catch (InvalidOperationException ex)
        {
            // The window has closed; the stored file still applies at the next launch.
            _logger.Info(LogCategory, $"The app icon was stored but not shown, the window is gone: {ex.Message}");
        }
        catch (ArgumentException ex)
        {
            _logger.Warning(LogCategory, $"The window refused the app icon file: {ex.Message}");
        }
    }

    private void RemoveOtherIcons(string? keep)
    {
        if (!Directory.Exists(_directory))
            return;

        string[] files;
        try
        {
            files = Directory.GetFiles(_directory);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.Warning(LogCategory, $"Could not list {_directory} to remove old app icons: {ex.Message}");
            return;
        }

        foreach (var file in files)
        {
            var name = Path.GetFileName(file);
            var stale = name.StartsWith(IconPrefix, StringComparison.Ordinal) && name != keep
                || name.EndsWith(".tmp", StringComparison.Ordinal);
            if (stale)
                TryDelete(file);
        }
    }

    private void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Usually the shell still reading it for a shortcut; the next switch or launch retries.
            _logger.Info(LogCategory, $"Could not remove {path} yet: {ex.Message}");
        }
    }

    /// <summary>
    /// Repoints the shortcuts, then removes the icon files nothing uses any more. Old files go
    /// only after the shortcuts have moved off them, so a shortcut never points at a deleted file.
    /// </summary>
    private void QueueSettle()
    {
        var shortcuts = _shortcuts;
        var task = Task.Run(async () =>
        {
            await _shortcutLock.WaitAsync().ConfigureAwait(false);
            string? icon = null;
            try
            {
                // Read at run time rather than when queued, so the last switch always wins.
                icon = ReadCurrent()?.Path;
                if (shortcuts is not null)
                {
                    var written = await shortcuts.ApplyAsync(icon).ConfigureAwait(false);
                    if (written > 0)
                        _logger.Info(LogCategory, $"Pointed {written} shortcut(s) at {icon ?? "the app executable"}.");
                }

                await _writeLock.WaitAsync().ConfigureAwait(false);
                try
                {
                    RemoveOtherIcons(ReadCurrent()?.FileName);
                }
                finally
                {
                    _writeLock.Release();
                }
            }
            catch (Exception ex)
            {
                _logger.Error(LogCategory, $"Could not point the app shortcuts at {icon ?? "the app executable"}.", ex);
            }
            finally
            {
                _shortcutLock.Release();
            }
        });
        Volatile.Write(ref _lastShortcutSync, task);
    }
}
