using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Notes.Persistence;

/// <summary>
/// Transactional writes for note folders, on the same writer the note rows use.
/// </summary>
/// <remarks>
/// Folder rows used to be written straight through the key and value provider, which meant the row
/// and the folder index landed as two independent statements and a folder could exist without being
/// listed. It also left no way to refuse a write to a folder the trash is holding, since the check and
/// the write would sit on different connections. Both are the same problem, so both are solved here.
/// </remarks>
public interface INoteFolderStore
{
    /// <summary>Writes a folder and its index entry together, unless the trash holds it.</summary>
    Task<bool> SaveFolderAsync(NoteFolder folder, CancellationToken cancellationToken = default);

    /// <summary>Removes a live folder and its index entry together.</summary>
    Task<bool> DeleteFolderAsync(string folderId, CancellationToken cancellationToken = default);
}
