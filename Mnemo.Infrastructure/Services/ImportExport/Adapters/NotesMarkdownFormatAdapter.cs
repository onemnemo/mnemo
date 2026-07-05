using System.Text;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Notes.Markdown;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters;

public sealed class NotesMarkdownFormatAdapter : IContentFormatAdapter
{
    private readonly INoteService _noteService;

    public NotesMarkdownFormatAdapter(INoteService noteService)
    {
        _noteService = noteService;
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
        var conflicting = existingNotes.FirstOrDefault(n => string.Equals(n.Title, title, StringComparison.OrdinalIgnoreCase));

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

        Note note;
        if (conflicting != null && policy == ImportConflictPolicy.Replace)
        {
            note = conflicting;
            note.Content = markdown;
            note.Blocks = NoteBlockMarkdownConverter.Deserialize(markdown);
        }
        else
        {
            if (conflicting != null)
            {
                var usedTitles = new HashSet<string>(existingNotes.Select(n => n.Title), StringComparer.OrdinalIgnoreCase);
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
}
