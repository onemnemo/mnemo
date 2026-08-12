using System.Runtime.Versioning;
using Microsoft.Win32;

namespace Mnemo.Host.Startup;

/// <summary>
/// The per-user autostart list Windows reads at sign-in.
/// </summary>
/// <remarks>
/// HKCU rather than HKLM: Mnemo installs per user and this key needs no elevation.
/// </remarks>
[SupportedOSPlatform("windows")]
internal static class WindowsRunKey
{
    private const string KeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";

    public static string? Read(string name)
    {
        using var key = Registry.CurrentUser.OpenSubKey(KeyPath);
        return key?.GetValue(name) as string;
    }

    public static void Write(string name, string command)
    {
        using var key = Registry.CurrentUser.CreateSubKey(KeyPath, writable: true);
        key?.SetValue(name, command, RegistryValueKind.String);
    }

    public static void Remove(string name)
    {
        using var key = Registry.CurrentUser.OpenSubKey(KeyPath, writable: true);
        key?.DeleteValue(name, throwOnMissingValue: false);
    }
}
