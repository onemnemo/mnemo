using System.Collections.ObjectModel;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Widgets;

/// <summary>
/// Minimal <see cref="IWidgetContext"/> for widget ViewModel tests: notes, decks, statistics
/// records, and the three flashcard stat buckets (<see cref="Stats"/>) are all seedable;
/// localization echoes keys; UI affordances are inert no-ops.
/// </summary>
internal sealed class FakeWidgetContext : IWidgetContext
{
    public FakeNoteService NoteService { get; } = new();

    public FakeStatisticsManager StatisticsManager { get; } = new();
    public IStatisticsManager Statistics => StatisticsManager;
    public FakeDeckLibraryService DeckLibraryService { get; } = new();
    public IFlashcardLibraryService Decks => DeckLibraryService;
    public FakeFlashcardStatsService StatsService { get; } = new();
    public IFlashcardStatsService Stats => StatsService;
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
        public Task<string?> CreateDialogAsync(string title, string message, string confirmText = "OK", string cancelText = "", string? confirmIconName = null, DialogSeverity severity = DialogSeverity.Default)
            => Task.FromResult<string?>(null);
        public Task<string?> CreateInputDialogAsync(string title, string confirmText = "Save", string cancelText = "Cancel", string? description = null, string? placeholder = null, string? initialValue = null, string? confirmIconName = null)
            => Task.FromResult<string?>(null);
    }

    /// <summary>Seedable <see cref="IFlashcardLibraryService"/>: <see cref="DecksToReturn"/> backs <see cref="ListDecksAsync"/>.</summary>
    internal sealed class FakeDeckLibraryService : IFlashcardLibraryService
    {
        public List<FlashcardDeckSummary> DecksToReturn { get; } = new();

        public Task<IReadOnlyList<FlashcardFolder>> ListFoldersAsync(CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<FlashcardFolder>>([]);
        public Task<IReadOnlyList<FlashcardDeckSummary>> ListDecksAsync(CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<FlashcardDeckSummary>>(DecksToReturn);
        public Task<FlashcardDeckSummary?> GetDeckAsync(string deckId, CancellationToken cancellationToken = default)
            => Task.FromResult(DecksToReturn.FirstOrDefault(d => d.Id == deckId));
        public Task SaveFolderAsync(FlashcardFolder folder, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<FlashcardDeckHeader> CreateDeckAsync(string name, string? folderId = null, string? presetId = null, CancellationToken cancellationToken = default)
            => Task.FromResult(new FlashcardDeckHeader(Guid.NewGuid().ToString("n"), folderId, presetId ?? string.Empty, name, null, [], 0, null));
        public Task SaveDeckAsync(FlashcardDeckHeader deck, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task MoveDeckAsync(string deckId, string? folderId, int sortOrder, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<bool> DeleteDeckAsync(string deckId, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> DeleteFolderAsync(string folderId, CancellationToken cancellationToken = default) => Task.FromResult(false);
    }

    /// <summary>
    /// Seedable <see cref="IFlashcardStatsService"/> for widget VM tests: retention/trend/test data
    /// per deck id, defaulting to "no data" when a deck was never seeded.
    /// </summary>
    internal sealed class FakeFlashcardStatsService : IFlashcardStatsService
    {
        public Dictionary<string, int> RetentionByDeck { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, IReadOnlyList<FlashcardRetentionTrendPoint>> RetentionTrendByDeck { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, FlashcardTestSummary> TestSummaryByDeck { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, IReadOnlyList<FlashcardTestAttempt>> TestTrendByDeck { get; } = new(StringComparer.Ordinal);
        public List<FlashcardTestAttempt> RecordedAttempts { get; } = new();

        public Task<int> GetTrueRetentionAsync(string deckId, int windowDays = 30, CancellationToken cancellationToken = default)
            => Task.FromResult(RetentionByDeck.TryGetValue(deckId, out var v) ? v : 0);

        public Task<IReadOnlyList<FlashcardRetentionTrendPoint>> GetRetentionTrendAsync(string deckId, int days = 14, CancellationToken cancellationToken = default)
            => Task.FromResult(RetentionTrendByDeck.TryGetValue(deckId, out var v) ? v : (IReadOnlyList<FlashcardRetentionTrendPoint>)[]);

        public Task RecordTestAttemptAsync(FlashcardTestAttempt attempt, CancellationToken cancellationToken = default)
        {
            RecordedAttempts.Add(attempt);
            return Task.CompletedTask;
        }

        public Task<FlashcardTestSummary> GetTestSummaryAsync(string deckId, CancellationToken cancellationToken = default)
            => Task.FromResult(TestSummaryByDeck.TryGetValue(deckId, out var v) ? v : FlashcardTestSummary.None);

        public Task<IReadOnlyList<FlashcardTestAttempt>> GetTestTrendAsync(string deckId, int lastN = 20, CancellationToken cancellationToken = default)
            => Task.FromResult(TestTrendByDeck.TryGetValue(deckId, out var v) ? v : (IReadOnlyList<FlashcardTestAttempt>)[]);
    }

    /// <summary>
    /// Seedable <see cref="IStatisticsManager"/>: <see cref="Seed"/> stores a record's fields so
    /// <see cref="GetAsync"/> can return it; everything else behaves as an inert no-op, matching
    /// widget tests that only ever read (never write) through this surface.
    /// </summary>
    internal sealed class FakeStatisticsManager : IStatisticsManager
    {
        private readonly Dictionary<(string Ns, string Kind, string Key), StatisticsRecord> _records = new();

        public void Seed(string ns, string kind, string key, IReadOnlyDictionary<string, StatValue> fields)
            => _records[(ns, kind, key)] = new StatisticsRecord
            {
                Namespace = ns,
                Kind = kind,
                Key = key,
                Fields = fields
            };

        public Task<Result<StatisticsRecord>> CreateAsync(StatisticsRecordWrite write, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<StatisticsRecord>.Failure("Not supported in tests."));
        public Task<Result<StatisticsRecord>> UpdateAsync(StatisticsRecordWrite write, StatisticsFieldMergeMode mergeMode = StatisticsFieldMergeMode.Merge, long? expectedVersion = null, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<StatisticsRecord>.Failure("Not supported in tests."));
        public Task<Result<StatisticsRecord>> UpsertAsync(StatisticsRecordWrite write, StatisticsFieldMergeMode mergeMode = StatisticsFieldMergeMode.Merge, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<StatisticsRecord>.Failure("Not supported in tests."));
        public Task<Result<bool>> ExistsAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<bool>.Success(_records.ContainsKey((ns, kind, key))));
        public Task<Result<StatisticsRecord?>> GetAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<StatisticsRecord?>.Success(_records.TryGetValue((ns, kind, key), out var record) ? record : null));
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
