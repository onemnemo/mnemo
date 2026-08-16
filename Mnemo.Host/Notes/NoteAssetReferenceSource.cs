using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Assets;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Notes.Persistence;

namespace Mnemo.Host.Notes;

/// <summary>
/// The notes module's reference source for the asset sweep: every image reference held by a
/// saved note, in any of the shapes real data carries.
/// </summary>
/// <remarks>
/// <para>
/// A note names files from two places: its blocks, and its metadata. Both are read by
/// <see cref="CollectFromNote"/>, which is the one list of fields the sweep knows about. A new
/// metadata field that stores a file belongs in that list; a file this misses is unreferenced,
/// and the sweeper deletes it once it is past the grace window.
/// </para>
/// <para>
/// An image block's <c>path</c> is one of three things. New uploads store a managed asset id
/// (<c>{guid}.png</c>). Old desktop-era data stores an absolute path, which lives outside the
/// note-assets directory and is therefore not the sweeper's to collect. The oldest data
/// stores <c>attachment:{guid}:{name}</c> references, which resolve by bare guid, so the guid
/// is what gets reported. The <see cref="Block"/> reader already rebuilds legacy meta-shaped
/// payloads into <see cref="ImagePayload"/>, so walking payloads covers every era.
/// </para>
/// <para>
/// The corpus is read directly off storage rather than through <c>INoteService</c>, which
/// silently skips rows that fail to load. That is fine for a listing and fatal for a sweep:
/// a note absent because it could not be read is a note whose images look unreferenced. So
/// this fails closed, any unreadable row throws, the sweep aborts, and nothing is deleted on
/// the strength of a corpus that was only partly read.
/// </para>
/// </remarks>
public sealed class NoteAssetReferenceSource : IAssetReferenceSource
{
    private const string AttachmentPrefix = "attachment:";

    /// <summary>Marks a cover that names an uploaded image rather than a preset banner.</summary>
    private const string CoverAssetPrefix = "asset:";

    private readonly IStorageProvider _storage;
    private readonly INoteSidMigrator _migrator;

    public NoteAssetReferenceSource(IStorageProvider storage, INoteSidMigrator migrator)
    {
        _storage = storage;
        _migrator = migrator;
    }

    public bool IsReady => _migrator.IsComplete;

    public async Task<IReadOnlyCollection<string>> CollectReferencedIdsAsync(CancellationToken cancellationToken = default)
    {
        var index = await _storage.LoadAsync<List<string>>(NoteCommitStore.IndexKey).ConfigureAwait(false);
        if (!index.IsSuccess)
            throw new InvalidOperationException("The note index could not be read; refusing to sweep against an unknown corpus.");

        var referenced = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var noteId in index.Value ?? [])
        {
            cancellationToken.ThrowIfCancellationRequested();
            var note = await _storage.LoadAsync<Note>(NoteCommitStore.NoteKey(noteId)).ConfigureAwait(false);
            if (!note.IsSuccess)
                throw new InvalidOperationException($"Note '{noteId}' could not be read; refusing to sweep against a partly read corpus.");
            // Indexed but absent: a delete committed between the two reads, or a torn index.
            // Either way the next sweep sees a consistent state; this one stands down.
            if (note.Value is null)
                throw new InvalidOperationException($"Note '{noteId}' is indexed but missing; refusing to sweep until the corpus reads consistently.");

            CollectFromNote(note.Value, referenced);
        }
        return referenced;
    }

    /// <summary>Every field of a note that can name a stored file.</summary>
    private static void CollectFromNote(Note note, HashSet<string> into)
    {
        CollectFromBlocks(note.Blocks, into);
        if (ParseReference(CoverAssetId(note.Cover)) is { } cover)
            into.Add(cover);
    }

    /// <summary>
    /// The asset id an uploaded cover names, or null for a preset, which stores no file. The
    /// prefix comes off here because <see cref="ParseReference"/> rejects anything with a colon.
    /// </summary>
    private static string? CoverAssetId(string? cover) =>
        cover is not null && cover.StartsWith(CoverAssetPrefix, StringComparison.OrdinalIgnoreCase)
            ? cover[CoverAssetPrefix.Length..]
            : null;

    private static void CollectFromBlocks(IReadOnlyList<Block>? blocks, HashSet<string> into)
    {
        if (blocks is null)
            return;

        foreach (var block in blocks)
        {
            if (block.Payload is ImagePayload image && ParseReference(image.Path) is { } id)
                into.Add(id);
            CollectFromBlocks(block.Children, into);
        }
    }

    /// <summary>The asset id or bare guid a stored path refers to, or null when it points elsewhere.</summary>
    private static string? ParseReference(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return null;

        if (path.StartsWith(AttachmentPrefix, StringComparison.OrdinalIgnoreCase))
        {
            var rest = path[AttachmentPrefix.Length..];
            var end = rest.IndexOf(':');
            var guid = end >= 0 ? rest[..end] : rest;
            return string.IsNullOrWhiteSpace(guid) ? null : guid;
        }

        if (Path.IsPathRooted(path))
        {
            // Absolute paths are desktop-era references into the shared images directory and
            // are never swept. One pointing into note-assets should not exist, but if it does,
            // treating it as a reference errs toward keeping the file.
            return MnemoAppPaths.IsPathUnderNoteAssetsDirectory(path) ? Path.GetFileName(path) : null;
        }

        // Anything else that is a single safe segment is a managed asset id. URLs and other
        // schemes fall out here as unreferenced-by-the-store, which is what they are.
        return path.Contains('/') || path.Contains('\\') || path.Contains(':') ? null : path;
    }
}
