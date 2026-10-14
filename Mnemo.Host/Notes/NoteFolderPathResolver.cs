using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Host.Notes;

/// <summary>
/// Finds or creates the folders along a picked folder's path. Names match ignoring case.
/// </summary>
internal sealed class NoteFolderPathResolver(INoteFolderService folders, string? baseFolderId)
{
    private List<NoteFolder>? _known;

    /// <summary>Empty segments are skipped, so an empty path is the destination.</summary>
    public async Task<(string? FolderId, string? Error)> ResolveAsync(string? path)
    {
        _known ??= (await folders.GetAllFoldersAsync().ConfigureAwait(false)).ToList();
        var parentId = baseFolderId;
        foreach (var name in (path ?? string.Empty).Split('/').Select(s => s.Trim()).Where(s => s.Length > 0))
        {
            var siblings = _known.Where(f => (f.ParentId ?? string.Empty) == (parentId ?? string.Empty)).ToList();
            var folder = siblings.FirstOrDefault(f => string.Equals(f.Name, name, StringComparison.OrdinalIgnoreCase));
            if (folder is null)
            {
                folder = new NoteFolder
                {
                    Name = name,
                    ParentId = parentId,
                    Order = siblings.Count == 0 ? 0 : siblings.Max(f => f.Order) + 1,
                };
                var saved = await folders.SaveFolderAsync(folder).ConfigureAwait(false);
                if (!saved.IsSuccess)
                    return (null, saved.ErrorMessage ?? $"The folder \"{name}\" could not be created.");
                _known.Add(folder);
            }

            parentId = folder.FolderId;
        }

        return (parentId, null);
    }
}
