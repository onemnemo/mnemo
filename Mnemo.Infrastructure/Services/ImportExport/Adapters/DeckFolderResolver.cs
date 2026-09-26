using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters;

/// <summary>
/// Maps a deck path, folders then deck joined by <c>::</c> the way Anki spells a hierarchy, onto the
/// library's folders. Missing folders are created and existing ones reused, so a second import of
/// the same file does not build a parallel tree.
/// </summary>
internal sealed class DeckFolderResolver
{
    public const string PathSeparator = "::";

    // Joins a chain into a lookup key. A folder name can hold any printable text, so a visible
    // separator could make two different chains share a key.
    private const char KeySeparator = '\u001F';

    private readonly IFlashcardLibraryService _library;
    private readonly Dictionary<string, string> _folderIdByChain = new(StringComparer.OrdinalIgnoreCase);
    private int _nextOrder;

    private DeckFolderResolver(IFlashcardLibraryService library) => _library = library;

    public static async Task<DeckFolderResolver> CreateAsync(IFlashcardLibraryService library, CancellationToken cancellationToken)
    {
        var resolver = new DeckFolderResolver(library);
        var folders = await library.ListFoldersAsync(cancellationToken).ConfigureAwait(false);
        var byId = folders.ToDictionary(f => f.Id, StringComparer.Ordinal);
        foreach (var folder in folders)
        {
            var chain = ChainOf(folder, byId);
            if (chain.Count > 0)
                resolver._folderIdByChain.TryAdd(string.Join(KeySeparator, chain), folder.Id);
            resolver._nextOrder = Math.Max(resolver._nextOrder, folder.Order + 1);
        }

        return resolver;
    }

    /// <summary>
    /// The folder a deck path puts its deck in, created where missing, and the deck's own name. A
    /// path with no segment left after trimming is taken as a plain name.
    /// </summary>
    public async Task<(string? FolderId, string DeckName)> ResolvePathAsync(string path, CancellationToken cancellationToken)
    {
        var segments = path
            .Split(PathSeparator, StringSplitOptions.None)
            .Select(segment => segment.Trim())
            .Where(segment => segment.Length > 0)
            .ToArray();

        if (segments.Length == 0)
            return (null, path);

        var folderId = await ResolveAsync(segments[..^1], cancellationToken).ConfigureAwait(false);
        return (folderId, segments[^1]);
    }

    /// <summary>A deck's path: its folder chain, outermost first, then its own name.</summary>
    public static string PathOf(IReadOnlyList<string> folderChain, string deckName) =>
        string.Join(PathSeparator, folderChain.Append(deckName));

    /// <summary>The folder a chain of names ends in, outermost first. Null for an empty chain.</summary>
    private async Task<string?> ResolveAsync(IReadOnlyList<string> chain, CancellationToken cancellationToken)
    {
        string? parentId = null;
        for (var i = 0; i < chain.Count; i++)
        {
            var key = string.Join(KeySeparator, chain.Take(i + 1));
            if (!_folderIdByChain.TryGetValue(key, out var folderId))
            {
                folderId = Guid.NewGuid().ToString();
                await _library.SaveFolderAsync(
                    new FlashcardFolder(folderId, chain[i], parentId, _nextOrder++),
                    cancellationToken).ConfigureAwait(false);
                _folderIdByChain[key] = folderId;
            }

            parentId = folderId;
        }

        return parentId;
    }

    /// <summary>Every folder's chain of names, outermost first and ending in its own, keyed by id.</summary>
    public static async Task<Dictionary<string, IReadOnlyList<string>>> ChainsByFolderIdAsync(
        IFlashcardLibraryService library, CancellationToken cancellationToken)
    {
        var folders = await library.ListFoldersAsync(cancellationToken).ConfigureAwait(false);
        var byId = folders.ToDictionary(f => f.Id, StringComparer.Ordinal);
        return folders.ToDictionary(f => f.Id, f => ChainOf(f, byId), StringComparer.Ordinal);
    }

    private static IReadOnlyList<string> ChainOf(FlashcardFolder folder, IReadOnlyDictionary<string, FlashcardFolder> byId)
    {
        var names = new List<string>();
        var current = folder;
        // Saved data can carry a parent cycle; the depth cap keeps a bad row from hanging a walk.
        for (var depth = 0; current is not null && depth < 64; depth++)
        {
            names.Add(current.Name);
            if (string.IsNullOrEmpty(current.ParentId) || !byId.TryGetValue(current.ParentId, out current))
                break;
        }

        names.Reverse();
        return names;
    }
}
