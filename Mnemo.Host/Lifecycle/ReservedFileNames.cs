using System;
using System.Collections.Generic;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// Windows device names a file's base name cannot be, with or without an extension, checked
/// case-insensitively against everything before the first dot: "con", "CON" and "con.txt" all
/// match. Shared by every export route that turns a note, deck, or board title into a download
/// name, so a title of "CON" cannot reach a save dialog pre-filled with a name Windows refuses to
/// create. The web side keeps its own copy of the same list.
/// </summary>
public static class ReservedFileNames
{
    private static readonly HashSet<string> Names = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };

    public static bool IsReserved(string name)
    {
        var dot = name.IndexOf('.');
        var stem = dot < 0 ? name : name[..dot];
        return Names.Contains(stem);
    }
}
