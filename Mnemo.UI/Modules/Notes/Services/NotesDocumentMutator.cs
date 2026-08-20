using Mnemo.Core.Models;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Statistics;

namespace Mnemo.UI.Modules.Notes.Services;

/// <summary>Document persistence: save blocks/title and create child page notes.</summary>
public sealed class NotesDocumentMutator
{
    private readonly NotesLibrarySession _library;
    private readonly INoteService _noteService;
    private readonly IStatisticsManager _statistics;
    private readonly IStudyDayService _studyDay;
    private readonly ILoggerService _logger;

    public NotesDocumentMutator(
        NotesLibrarySession library,
        INoteService noteService,
        IStatisticsManager statistics,
        IStudyDayService studyDay,
        ILoggerService logger)
    {
        _library = library;
        _noteService = noteService;
        _statistics = statistics;
        _studyDay = studyDay;
        _logger = logger;
    }

    public async Task SaveNoteWithContentAsync(Note note, Block[]? blocks, string? title = null)
    {
        if (title != null)
        {
            note.Title = title;
            _library.NotifyTreeItemsForNoteTitleChanged(note);
        }

        if (blocks != null)
        {
            note.Blocks = blocks.Length > 0 ? blocks.ToList() : new List<Block>();
            note.Content = "";
        }

        await _noteService.SaveNoteAsync(note);
        if (blocks != null || title != null)
        {
            _ = StatisticsRecorder.IncrementDailyCounterAsync(_statistics, _logger, _studyDay,
                StatisticsNamespaces.Notes, NoteStatKinds.DailySummary, "notes_edited");
            _ = StatisticsRecorder.IncrementLifetimeAsync(_statistics, _logger,
                StatisticsNamespaces.Notes, NoteStatKinds.LifetimeTotals, "total_notes_edited");
        }
    }

    public async Task<string?> CreateChildPageNoteUnderParentAsync(string parentNoteId)
    {
        var parent = _library.Notes.FirstOrDefault(n => n.NoteId == parentNoteId);
        if (parent == null) return null;

        var maxOrder = _library.Notes.Where(n => n.FolderId == parent.FolderId).Select(n => n.Order).DefaultIfEmpty(0).Max();
        var child = new Note
        {
            Title = "Untitled",
            FolderId = parent.FolderId,
            FolderPath = parent.FolderPath,
            ParentNoteId = parentNoteId,
            Order = maxOrder + 1
        };

        _library.Notes.Add(child);
        await _noteService.SaveNoteAsync(child);

        _ = StatisticsRecorder.IncrementDailyCounterAsync(_statistics, _logger, _studyDay,
            StatisticsNamespaces.Notes, NoteStatKinds.DailySummary, "notes_created");
        _ = StatisticsRecorder.IncrementLifetimeAsync(_statistics, _logger,
            StatisticsNamespaces.Notes, NoteStatKinds.LifetimeTotals, "total_notes_created");

        return child.NoteId;
    }
}
