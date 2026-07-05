using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Widgets;

/// <summary>
/// Persists the overview board under a versioned key via <see cref="IStorageProvider"/> and
/// migrates the legacy v1 format (absolute 12-column grid entries) on first load: positions
/// demote to a row-major <see cref="WidgetInstance.Order"/>, spans rescale onto the 4-column
/// flow grid, each entry gets a fresh <see cref="WidgetInstance.InstanceId"/>, and default
/// settings are seeded from the widget's manifest. The legacy record is left untouched.
/// </summary>
public sealed class OverviewLayoutStore : IOverviewLayoutStore
{
    private const string LayoutKey = "overview_layout_v2";
    private const string LegacyLayoutKey = "overview_dashboard_layout";

    /// <summary>Sentinel message <see cref="SqliteStorageProvider"/> returns for an absent key.</summary>
    private const string KeyNotFoundMessage = "Key not found";

    private const int LegacyGridColumns = 12;
    private const double LegacyCellHeight = 120;
    private const double RowHeight = 150;
    private const int MaxColumns = 4;

    /// <summary>Maps v1 widget ids to the namespaced v2 ids. Frozen — v1 only ever shipped these five.</summary>
    private static readonly IReadOnlyDictionary<string, string> LegacyWidgetIdMap = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["flashcard-stats"] = "mnemo.flashcard-stats",
        ["recent-decks"] = "mnemo.recent-decks",
        ["recent-notes"] = "mnemo.recent-notes",
        ["study-goals"] = "mnemo.study-goals",
        ["usage-summary"] = "mnemo.usage-summary"
    };

    private readonly IStorageProvider _storage;
    private readonly IWidgetRegistry _registry;
    private readonly ILoggerService _logger;

    public OverviewLayoutStore(IStorageProvider storage, IWidgetRegistry registry, ILoggerService logger)
    {
        _storage = storage ?? throw new ArgumentNullException(nameof(storage));
        _registry = registry ?? throw new ArgumentNullException(nameof(registry));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<Result<OverviewLayout?>> LoadAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var current = await _storage.LoadAsync<OverviewLayout>(LayoutKey).ConfigureAwait(false);
        if (current.IsSuccess && current.Value != null)
            return Result<OverviewLayout?>.Success(Normalize(current.Value));

        if (!current.IsSuccess && !IsKeyNotFound(current))
            return Result<OverviewLayout?>.Failure(current.ErrorMessage ?? "Failed to load overview layout.", current.Exception);

        cancellationToken.ThrowIfCancellationRequested();

        var legacy = await _storage.LoadAsync<List<LegacyDashboardLayoutEntry>>(LegacyLayoutKey).ConfigureAwait(false);
        if (legacy.IsSuccess && legacy.Value is { Count: > 0 } entries)
        {
            var migrated = MigrateFromLegacy(entries);
            _logger.Info("Overview", $"Migrated overview layout v1 → v2 ({migrated.Widgets.Count} widgets).");

            var saved = await SaveAsync(migrated, cancellationToken).ConfigureAwait(false);
            if (!saved.IsSuccess)
                _logger.Warning("Overview", $"Migrated layout could not be persisted yet: {saved.ErrorMessage}. It will be retried on next save.");

            return Result<OverviewLayout?>.Success(migrated);
        }

        if (!legacy.IsSuccess && !IsKeyNotFound(legacy))
            return Result<OverviewLayout?>.Failure(legacy.ErrorMessage ?? "Failed to load legacy overview layout.", legacy.Exception);

        // Fresh profile: nothing was ever saved. The caller seeds the default board.
        return Result<OverviewLayout?>.Success(null);
    }

    public async Task<Result> SaveAsync(OverviewLayout layout, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(layout);
        cancellationToken.ThrowIfCancellationRequested();

        layout.SchemaVersion = OverviewLayout.CurrentSchemaVersion;
        NormalizeOrder(layout);

        return await _storage.SaveAsync(LayoutKey, layout).ConfigureAwait(false);
    }

    private static bool IsKeyNotFound(Result result)
        => string.Equals(result.ErrorMessage, KeyNotFoundMessage, StringComparison.Ordinal);

    /// <summary>Repairs a loaded layout: sizes snapped to supported ones, order normalized, settings non-null.</summary>
    private OverviewLayout Normalize(OverviewLayout layout)
    {
        foreach (var instance in layout.Widgets)
        {
            instance.Settings ??= new Dictionary<string, string>(StringComparer.Ordinal);

            var manifest = _registry.GetDescriptor(instance.WidgetId)?.Manifest;
            if (manifest != null)
                instance.Size = manifest.NearestSupportedSize(instance.Size);
            else if (instance.Size.Columns < 1 || instance.Size.Rows < 1)
                instance.Size = new WidgetSize(1, 1);
        }

        NormalizeOrder(layout);
        return layout;
    }

    private OverviewLayout MigrateFromLegacy(IReadOnlyList<LegacyDashboardLayoutEntry> entries)
    {
        var layout = new OverviewLayout();

        var ordered = entries
            .Where(e => !string.IsNullOrWhiteSpace(e.WidgetId))
            .OrderBy(e => e.Row)
            .ThenBy(e => e.Column);

        foreach (var entry in ordered)
        {
            var widgetId = LegacyWidgetIdMap.GetValueOrDefault(entry.WidgetId, entry.WidgetId);
            var manifest = _registry.GetDescriptor(widgetId)?.Manifest;

            var scaled = ScaleLegacySize(entry.ColSpan, entry.RowSpan);
            var instance = new WidgetInstance
            {
                WidgetId = widgetId,
                Size = manifest?.NearestSupportedSize(scaled) ?? scaled,
                Settings = manifest?.CreateDefaultSettings() ?? new Dictionary<string, string>(StringComparer.Ordinal)
            };

            layout.Widgets.Add(instance);
        }

        NormalizeOrder(layout);
        return layout;
    }

    /// <summary>Rescales a v1 span (12 columns × 120px rows) onto the v2 grid (4 columns × 150px rows).</summary>
    private static WidgetSize ScaleLegacySize(int colSpan, int rowSpan)
    {
        var columns = Math.Clamp((int)Math.Round(colSpan * (double)MaxColumns / LegacyGridColumns), 1, MaxColumns);
        var rows = Math.Max(1, (int)Math.Round(rowSpan * LegacyCellHeight / RowHeight));
        return new WidgetSize(columns, rows);
    }

    private static void NormalizeOrder(OverviewLayout layout)
    {
        var ordered = layout.Widgets.OrderBy(w => w.Order).ToList();
        for (var i = 0; i < ordered.Count; i++)
            ordered[i].Order = i;
        layout.Widgets = ordered;
    }
}
