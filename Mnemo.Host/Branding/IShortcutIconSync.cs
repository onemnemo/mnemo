namespace Mnemo.Host.Branding;

/// <summary>Points the operating system's shortcuts to the app at the chosen icon.</summary>
public interface IShortcutIconSync
{
    /// <summary>
    /// Sets every shortcut this installation owns to <paramref name="iconFile"/>, or back to the
    /// executable's own icon when it is null. Returns how many shortcuts were rewritten; one that
    /// already shows the right icon is left alone and not counted.
    /// </summary>
    Task<int> ApplyAsync(string? iconFile);
}
