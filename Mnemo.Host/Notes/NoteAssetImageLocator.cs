using Mnemo.Core.Services;
using Mnemo.Host.Assets;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services;

namespace Mnemo.Host.Notes;

/// <summary>
/// Resolves a note image block's stored reference to a file on disk for the PDF exporter, using the
/// same rules the asset-serving endpoint does so an export embeds exactly what the editor shows.
/// </summary>
/// <remarks>Absolute paths are honored only under the legacy images or note-assets directories.</remarks>
public sealed class NoteAssetImageLocator : INotePdfImageLocator
{
    private const string AttachmentPrefix = "attachment:";

    private readonly SharedImageStore _shared;
    private readonly ManagedAssetStore _noteAssetsStore;
    private readonly string _noteAssetsDirectory;
    private readonly string _imagesDirectory;

    public NoteAssetImageLocator(NoteAssets assets, SharedImageStore images)
        : this(images, assets.Store, MnemoAppPaths.GetNoteAssetsDirectory(), MnemoAppPaths.GetImagesDirectory())
    {
    }

    /// <summary>Explicit-directory constructor for tests; production uses the <see cref="NoteAssets"/> overload.</summary>
    public NoteAssetImageLocator(SharedImageStore shared, ManagedAssetStore noteAssetsStore, string noteAssetsDirectory, string imagesDirectory)
    {
        _shared = shared;
        _noteAssetsStore = noteAssetsStore;
        _noteAssetsDirectory = noteAssetsDirectory;
        _imagesDirectory = imagesDirectory;
    }

    public string? LocateImageFilePath(string reference)
    {
        if (string.IsNullOrWhiteSpace(reference))
            return null;

        if (reference.StartsWith(AttachmentPrefix, StringComparison.OrdinalIgnoreCase))
        {
            var rest = reference[AttachmentPrefix.Length..];
            var end = rest.IndexOf(':');
            var guid = end >= 0 ? rest[..end] : rest;
            return ResolveByBareId(guid);
        }

        if (Path.IsPathRooted(reference))
        {
            // Desktop-era absolute path; serve it only from the directories notes legitimately
            // reference, and only if it is really there.
            var full = SafeFullPath(reference);
            if (full is null || !File.Exists(full))
                return null;
            return MnemoAppPaths.IsPathUnder(full, _imagesDirectory) || MnemoAppPaths.IsPathUnder(full, _noteAssetsDirectory)
                ? full
                : null;
        }

        // Managed asset id: exact match first, then the bare-guid lookup for ids that arrive
        // without their extension.
        if (_shared.Locate(reference) is { } shared)
            return shared;
        var exact = _noteAssetsStore.ResolvePath(reference);
        if (exact is not null && File.Exists(exact))
            return exact;

        return ResolveByBareId(reference);
    }

    private string? ResolveByBareId(string? bareId)
    {
        if (string.IsNullOrWhiteSpace(bareId))
            return null;

        var owned = _noteAssetsStore.FindByBareId(bareId);
        if (owned is not null && File.Exists(owned))
            return owned;

        var legacy = ManagedAssetStore.FindByBareId(_imagesDirectory, bareId, _noteAssetsStore);
        return legacy is not null && File.Exists(legacy) ? legacy : null;
    }

    private static string? SafeFullPath(string path)
    {
        try
        {
            return Path.GetFullPath(path);
        }
        catch
        {
            return null;
        }
    }
}
