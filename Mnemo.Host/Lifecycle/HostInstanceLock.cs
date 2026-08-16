using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// Marks this process as a live app instance on its data profile, and answers whether any
/// other live instance shares it.
/// </summary>
/// <remarks>
/// Nothing stops a user launching the app twice against the same profile, and most of the
/// app tolerates that: SQLite serializes the writes and the note version check catches
/// logical races. The asset sweep does not tolerate it, because its editing-session registry
/// is per process: instance A cannot see the session whose undo history keeps a file alive in
/// instance B, so A's sweep would delete what B can still redo. Destructive maintenance
/// therefore stands down while another instance is running.
///
/// The marker is an exclusively held, delete-on-close lock file rather than a heartbeat: the
/// OS releases the handle on any process death, however rude, so a held file always means a
/// live instance and never a stale one. A file that survives without a holder (power loss)
/// opens cleanly on the next probe and is removed then.
/// </remarks>
public sealed class HostInstanceLock : IDisposable
{
    private const string LockPattern = "host-*.lock";

    private readonly string _directory;
    private readonly string _ownPath;
    private readonly FileStream _handle;

    private HostInstanceLock(string directory, string ownPath, FileStream handle)
    {
        _directory = directory;
        _ownPath = ownPath;
        _handle = handle;
    }

    /// <param name="directory">Override for tests; defaults to <c>locks</c> under the data root.</param>
    public static HostInstanceLock Acquire(string? directory = null)
    {
        var dir = directory ?? Path.Combine(MnemoAppPaths.GetLocalUserDataRoot(), "locks");
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, $"host-{Guid.NewGuid():N}.lock");
        var handle = new FileStream(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose);
        return new HostInstanceLock(dir, path, handle);
    }

    /// <summary>True when any other process currently holds an instance lock on this profile.</summary>
    public bool AnotherInstanceIsRunning()
    {
        if (!Directory.Exists(_directory))
            return false;

        foreach (var candidate in Directory.EnumerateFiles(_directory, LockPattern))
        {
            if (string.Equals(Path.GetFullPath(candidate), Path.GetFullPath(_ownPath), StringComparison.OrdinalIgnoreCase))
                continue;
            if (IsHeld(candidate))
                return true;
        }
        return false;
    }

    private static bool IsHeld(string path)
    {
        try
        {
            using (new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None))
            {
            }
        }
        catch (FileNotFoundException)
        {
            // Gone between enumeration and probe: its holder exited. Not a live instance.
            return false;
        }
        catch (IOException)
        {
            // Sharing violation: a live process holds it exclusively.
            return true;
        }
        catch (UnauthorizedAccessException)
        {
            return true;
        }

        // Openable means unheld: a leftover from an unclean shutdown. Clear it so it is
        // probed at most once more.
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
        return false;
    }

    public void Dispose()
    {
        // Delete-on-close removes the marker with the handle.
        _handle.Dispose();
    }
}
