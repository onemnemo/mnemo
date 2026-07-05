using System.Collections.ObjectModel;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Widgets;

/// <summary>
/// Minimal <see cref="IWidgetContext"/> for widget ViewModel tests: notes are seedable,
/// localization echoes keys, statistics are empty, and UI affordances are inert.
/// </summary>
internal sealed class FakeWidgetContext : IWidgetContext
{
    public FakeNoteService NoteService { get; } = new();

    public IStatisticsManager Statistics { get; } = new EmptyStatisticsManager();
    public IFlashcardDeckService Decks { get; } = new EmptyDeckService();
    public INoteService Notes => NoteService;
    public INavigationService Navigation { get; } = new NoOpNavigationService();
    public IOverlayService Overlays { get; } = new NoOpOverlayService();
    public ILocalizationService Localization { get; } = new EchoLocalizationService();
    public IDateDisplayService DateDisplay { get; } = new InvariantDateDisplayService();
    public ILoggerService Logger { get; } = new TestLogger();

    internal sealed class FakeNoteService : INoteService
    {
        public List<Note> NotesToReturn { get; } = new();

        public Task<IEnumerable<Note>> GetAllNotesAsync() => Task.FromResult<IEnumerable<Note>>(NotesToReturn);
        public Task<Note?> GetNoteAsync(string noteId) => Task.FromResult(NotesToReturn.FirstOrDefault(n => n.NoteId == noteId));
        public Task<Result> SaveNoteAsync(Note note) => Task.FromResult(Result.Success());
        public Task<Result> DeleteNoteAsync(string noteId) => Task.FromResult(Result.Success());
    }

    private sealed class EchoLocalizationService : ILocalizationService
    {
        public string CurrentLanguage => "en";
        public event EventHandler? LanguageChanged { add { } remove { } }
        public string GetString(string key, string? ns = null) => key;
        public string T(string key, string? ns = null) => key;
        public Task<bool> SetLanguageAsync(string languageCode, CancellationToken cancellationToken = default) => Task.FromResult(true);
        public Task<IEnumerable<LanguageManifest>> GetAvailableLanguagesAsync() => Task.FromResult(Enumerable.Empty<LanguageManifest>());
    }

    private sealed class InvariantDateDisplayService : IDateDisplayService
    {
        public string FormatSmart(DateTime timestamp) => timestamp.ToString("yyyy-MM-dd");
        public string FormatRelative(DateTime timestamp) => timestamp.ToString("yyyy-MM-dd");
        public string FormatAbsolute(DateTime timestamp) => timestamp.ToString("yyyy-MM-dd");
        public string FormatDayHeading(DateTime timestamp) => timestamp.ToString("MM-dd");
    }

    private sealed class NoOpNavigationService : INavigationService
    {
        public object? CurrentViewModel => null;
        public string? CurrentRoute => null;
        public bool CanGoBack => false;
        public event Action? CanGoBackChanged { add { } remove { } }
        public event EventHandler<NavigationChangedEventArgs>? Navigated { add { } remove { } }
        public ObservableCollection<BreadcrumbItem> Breadcrumbs { get; } = new();
        public void NavigateTo(string route) { }
        public void NavigateTo(string route, object? parameter) { }
        public void NavigateToBreadcrumb(BreadcrumbItem item) { }
        public void RegisterRoute(string route, Type viewModelType) { }
    }

    private sealed class NoOpOverlayService : IOverlayService
    {
        public ObservableCollection<OverlayInstance> Overlays { get; } = new();
        public void Show(string overlayName, object? parameter = null) { }
        public void Hide() { }
        public void CloseOverlay(string id) { }
        public void CloseOverlay(string id, object? result) { }
        public string CreateOverlay(object content, OverlayOptions options, string? name = null) => string.Empty;
        public Task<string?> CreateDialogAsync(string title, string message, string confirmText = "OK", string cancelText = "", object? icon = null, object? parameter = null, DialogSeverity severity = DialogSeverity.Default)
            => Task.FromResult<string?>(null);
    }

    private sealed class EmptyDeckService : IFlashcardDeckService
    {
        public Task<IReadOnlyList<FlashcardDeck>> ListDecksAsync(CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<FlashcardDeck>>([]);
        public Task<IReadOnlyList<FlashcardFolder>> ListFoldersAsync(CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<FlashcardFolder>>([]);
        public Task SaveFolderAsync(FlashcardFolder folder, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<FlashcardDeck?> GetDeckByIdAsync(string deckId, CancellationToken cancellationToken = default) => Task.FromResult<FlashcardDeck?>(null);
        public Task SaveDeckAsync(FlashcardDeck deck, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task RecordSessionOutcomeAsync(FlashcardSessionResult sessionResult, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<IReadOnlyList<FlashcardRetentionTrendPoint>> GetDeckRetentionTrendAsync(string deckId, int days = 14, CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<FlashcardRetentionTrendPoint>>([]);
        public Task<bool> DeleteDeckAsync(string deckId, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> DeleteFolderAsync(string folderId, CancellationToken cancellationToken = default) => Task.FromResult(false);
    }

    private sealed class EmptyStatisticsManager : IStatisticsManager
    {
        public Task<Result<StatisticsRecord>> CreateAsync(StatisticsRecordWrite write, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<StatisticsRecord>.Failure("Not supported in tests."));
        public Task<Result<StatisticsRecord>> UpdateAsync(StatisticsRecordWrite write, StatisticsFieldMergeMode mergeMode = StatisticsFieldMergeMode.Merge, long? expectedVersion = null, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<StatisticsRecord>.Failure("Not supported in tests."));
        public Task<Result<StatisticsRecord>> UpsertAsync(StatisticsRecordWrite write, StatisticsFieldMergeMode mergeMode = StatisticsFieldMergeMode.Merge, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<StatisticsRecord>.Failure("Not supported in tests."));
        public Task<Result<bool>> ExistsAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<bool>.Success(false));
        public Task<Result<StatisticsRecord?>> GetAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<StatisticsRecord?>.Success(null));
        public Task<Result<IReadOnlyDictionary<string, StatValue>?>> GetFieldsAsync(string ns, string kind, string key, IReadOnlyList<string> fieldNames, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<IReadOnlyDictionary<string, StatValue>?>.Success(null));
        public Task<Result> DeleteAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
            => Task.FromResult(Result.Success());
        public Task<Result<long>> IncrementAsync(string ns, string kind, string key, string fieldName, long delta, string sourceModule, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<long>.Success(0));
        public Task<Result<IReadOnlyList<StatisticsRecord>>> QueryAsync(StatisticsQuery query, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<IReadOnlyList<StatisticsRecord>>.Success([]));
        public Task<Result> RegisterSchemaAsync(StatisticsSchema schema, CancellationToken cancellationToken = default)
            => Task.FromResult(Result.Success());
        public Task<Result<StatisticsSchema?>> GetSchemaAsync(string ns, string kind, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<StatisticsSchema?>.Success(null));
        public Task<Result<IReadOnlyList<StatisticsSchema>>> ListSchemasAsync(string? ns = null, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<IReadOnlyList<StatisticsSchema>>.Success([]));
    }
}
