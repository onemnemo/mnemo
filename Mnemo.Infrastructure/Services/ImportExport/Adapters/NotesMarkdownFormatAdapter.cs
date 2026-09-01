using System.Text;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Notes.Markdown;
using Mnemo.Infrastructure.Services.Notes.Trash;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters;

public sealed class NotesMarkdownFormatAdapter : IContentFormatAdapter
{
    private readonly INoteService _noteService;
    private readonly ITrashService _trash;

    public NotesMarkdownFormatAdapter(INoteService noteService, ITrashService trash)
    {
        _noteService = noteService;
        _trash = trash;
    }

    public string ContentType => "notes";

    public string FormatId => "notes.markdown";

    public string DisplayName => "Markdown (.md)";

    public IReadOnlyList<string> Extensions => [".md"];

    public bool SupportsImport => true;

    public bool SupportsExport => true;

    public Task<ImportExportPreview> PreviewImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        return Task.FromResult(new ImportExportPreview
        {
            CanImport = true,
            ContentType = ContentType,
            FormatId = FormatId,
            DiscoveredCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["notes"] = 1 }
        });
    }

    public async Task<ImportExportResult> ImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var markdown = await File.ReadAllTextAsync(request.FilePath, cancellationToken).ConfigureAwait(false);
        var fileTitle = Path.GetFileNameWithoutExtension(request.FilePath);
        var title = string.IsNullOrWhiteSpace(fileTitle) ? "Imported Note" : fileTitle;
        var policy = ImportExportOptionKeys.GetConflictPolicy(request.Options);
        var targetFolderId = ImportExportOptionKeys.GetStringOption(request.Options, ImportExportOptionKeys.TargetFolderId);

        var existingNotes = (await _noteService.GetAllNotesAsync().ConfigureAwait(false)).ToList();
        // Markdown has no note ids. Match titles only among sidebar notes in the destination
        // folder; null denotes the root.
        var candidates = existingNotes
            .Where(n => string.IsNullOrEmpty(n.ParentNoteId)
                && string.Equals(n.FolderId, targetFolderId, StringComparison.Ordinal))
            .ToList();
        var conflicting = candidates.FirstOrDefault(n => string.Equals(n.Title, title, StringComparison.OrdinalIgnoreCase));

        if (conflicting != null && policy == ImportConflictPolicy.Skip)
        {
            return new ImportExportResult
            {
                Success = true,
                ContentType = ContentType,
                FormatId = FormatId,
                ProcessedCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["notes"] = 0, ["skipped"] = 1 }
            };
        }

        Note? victim = null;
        if (conflicting != null && policy == ImportConflictPolicy.Replace)
        {
            // Reload the current stored content before copying it. The listed note may have
            // changed or been deleted.
            victim = await _noteService.GetNoteAsync(conflicting.NoteId).ConfigureAwait(false);
            if (victim is null)
                conflicting = null;
            else if (!await CaptureReplacedNoteAsync(victim, cancellationToken).ConfigureAwait(false))
                return CouldNotCapture();
        }

        Note note;
        if (victim != null)
        {
            victim.Content = markdown;
            victim.Blocks = NoteBlockMarkdownConverter.Deserialize(markdown);
            note = victim;
        }
        else
        {
            if (conflicting != null)
            {
                var usedTitles = new HashSet<string>(candidates.Select(n => n.Title), StringComparer.OrdinalIgnoreCase);
                title = ImportNaming.NextAvailableName(title, usedTitles);
            }

            note = new Note
            {
                NoteId = Guid.NewGuid().ToString(),
                Title = title,
                FolderId = targetFolderId,
                Content = markdown,
                Blocks = NoteBlockMarkdownConverter.Deserialize(markdown)
            };
        }

        var save = await _noteService.SaveNoteAsync(note).ConfigureAwait(false);
        return new ImportExportResult
        {
            Success = save.IsSuccess,
            ContentType = ContentType,
            FormatId = FormatId,
            ProcessedCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["notes"] = save.IsSuccess ? 1 : 0 },
            ErrorMessage = save.IsSuccess ? null : save.ErrorMessage
        };
    }

    public async Task<ImportExportResult> ExportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        if (request.Payload is not Note note)
        {
            return new ImportExportResult
            {
                Success = false,
                ContentType = ContentType,
                FormatId = FormatId,
                ErrorMessage = "Markdown export requires a Note payload."
            };
        }

        var markdown = note.Blocks is { Count: > 0 }
            ? NoteBlockMarkdownConverter.Serialize(note.Blocks)
            : note.Content ?? string.Empty;
        await File.WriteAllTextAsync(request.FilePath, markdown, Encoding.UTF8, cancellationToken).ConfigureAwait(false);

        return new ImportExportResult
        {
            Success = true,
            ContentType = ContentType,
            FormatId = FormatId,
            ProcessedCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["notes"] = 1 }
        };
    }

    /// <summary>
    /// Captures a copy before replacement. The original id must remain live for existing
    /// references, and held notes reject writes. Returns false when capture fails.
    /// </summary>
    private async Task<bool> CaptureReplacedNoteAsync(Note victim, CancellationToken cancellationToken)
    {
        var copy = new Note
        {
            NoteId = Guid.NewGuid().ToString(),
            // Leave Sid unset so the copy receives a unique id without changing existing
            // references.
            Title = victim.Title,
            FolderId = victim.FolderId,
            FolderPath = victim.FolderPath,
            ParentNoteId = victim.ParentNoteId,
            Order = victim.Order,
            Content = victim.Content,
            Blocks = victim.Blocks is null ? null : new List<Block>(victim.Blocks),
            IsFavorite = victim.IsFavorite,
            Emoji = victim.Emoji,
            Cover = victim.Cover,
            CoverCrop = victim.CoverCrop,
            Tags = [.. victim.Tags],
            CreatedAt = victim.CreatedAt
        };

        var saved = await _noteService.SaveNoteAsync(copy).ConfigureAwait(false);
        if (!saved.IsSuccess)
            return false;

        var entries = 0;
        try
        {
            var action = await _trash
                .DeleteAsync([new TrashDeleteRequest(NoteTrashSource.TrashKind, copy.NoteId)], cancellationToken)
                .ConfigureAwait(false);
            entries = action.Entries.Count;
        }
        finally
        {
            // Remove an uncaptured live copy after either refusal or failure. Deletion may still
            // fail or be refused if another operation holds the copy.
            if (entries == 0)
                await _noteService.DeleteNoteAsync(copy.NoteId).ConfigureAwait(false);
        }

        return entries > 0;
    }

    private ImportExportResult CouldNotCapture() => new()
    {
        Success = false,
        ContentType = ContentType,
        FormatId = FormatId,
        ProcessedCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["notes"] = 0 },
        ErrorMessage = "The note that is here could not be put in the trash, so it was left as it is."
    };
}
