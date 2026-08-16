using System.IO;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Notes.Pdf;

/// <summary>
/// The default image locator: treats a reference as a direct filesystem path. Correct for desktop-era
/// notes, whose image blocks store absolute paths, and the fallback when no host-specific locator is
/// supplied.
/// </summary>
public sealed class DirectPathImageLocator : INotePdfImageLocator
{
    public static readonly DirectPathImageLocator Instance = new();

    public string? LocateImageFilePath(string reference) =>
        !string.IsNullOrWhiteSpace(reference) && File.Exists(reference) ? reference : null;
}
