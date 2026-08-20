using System;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Tools;

namespace Mnemo.UI.Modules.Statistics;

/// <summary>
/// Registers statistics-system tools and built-in schemas (flashcards/notes) so the
/// <see cref="IStatisticsManager"/> validates writes from any caller, internal or extension.
/// Has no UI surface of its own; widgets/data producers consume the manager directly via DI.
/// </summary>
public sealed class StatisticsModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        // No view models; service registration happens directly in Bootstrapper.
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
    }

    public void RegisterSidebarItems(ISidebarService sidebarService)
    {
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
        var stats = services.GetRequiredService<IStatisticsManager>();
        // RegisterSchemaAsync is in-memory only; .GetAwaiter().GetResult() avoids async signature on IModule.
        RegisterBuiltInSchemas(stats);

        var tools = services.GetRequiredService<StatisticsToolService>();
        StatisticsToolRegistrar.Register(registry, tools);
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
    }

    private static void RegisterBuiltInSchemas(IStatisticsManager stats)
    {
        // Flashcards: per-day aggregate (cards reviewed, minutes studied, sessions, accuracy)
        stats.RegisterSchemaAsync(new StatisticsSchema
        {
            Namespace = StatisticsNamespaces.Flashcards,
            Kind = FlashcardStatKinds.DailySummary,
            Description = "Per-day flashcard activity (study day, key = yyyy-MM-dd).",
            AllowAdditionalFields = true,
            MaxMetadataBytes = 4096,
            Fields = new[]
            {
                IntField("cards_reviewed", required: false, defaultValue: 0, min: 0),
                IntField("minutes_studied", required: false, defaultValue: 0, min: 0),
                IntField("sessions_completed", required: false, defaultValue: 0, min: 0),
                IntField("correct_count", required: false, defaultValue: 0, min: 0),
                IntField("incorrect_count", required: false, defaultValue: 0, min: 0),
                StringField("last_deck_id", required: false)
            }
        }).GetAwaiter().GetResult();

        // Flashcards: per-deck rolling summary (key = deck:{id})
        stats.RegisterSchemaAsync(new StatisticsSchema
        {
            Namespace = StatisticsNamespaces.Flashcards,
            Kind = FlashcardStatKinds.DeckSummary,
            Description = "Per-deck rolling summary (last practiced, totals).",
            AllowAdditionalFields = true,
            MaxMetadataBytes = 4096,
            Fields = new[]
            {
                StringField("deck_name", required: false),
                StringField("subject", required: false),
                IntField("card_count", required: false, defaultValue: 0, min: 0),
                IntField("total_reviewed", required: false, defaultValue: 0, min: 0),
                DateTimeField("last_practiced", required: false)
            }
        }).GetAwaiter().GetResult();

        // Flashcards: completed practice session log (immutable, key = session:{ticks}:{deck})
        stats.RegisterSchemaAsync(new StatisticsSchema
        {
            Namespace = StatisticsNamespaces.Flashcards,
            Kind = FlashcardStatKinds.SessionLog,
            Description = "Single completed practice session (append-only).",
            AllowAdditionalFields = true,
            MaxMetadataBytes = 8192,
            Fields = new[]
            {
                StringField("deck_id", required: true),
                StringField("session_type", required: false),
                IntField("cards_reviewed", required: false, defaultValue: 0, min: 0),
                IntField("correct_count", required: false, defaultValue: 0, min: 0),
                IntField("incorrect_count", required: false, defaultValue: 0, min: 0),
                IntField("again_count", required: false, defaultValue: 0, min: 0),
                IntField("hard_count", required: false, defaultValue: 0, min: 0),
                IntField("good_count", required: false, defaultValue: 0, min: 0),
                IntField("easy_count", required: false, defaultValue: 0, min: 0),
                DecimalField("accuracy", required: false, min: 0d, max: 100d),
                IntField("duration_seconds", required: false, defaultValue: 0, min: 0),
                DateTimeField("started_at", required: true),
                DateTimeField("completed_at", required: true),
                BoolField("ended_early", required: false, defaultValue: false)
            }
        }).GetAwaiter().GetResult();

        // Flashcards: lifetime totals (single record, key = "all")
        stats.RegisterSchemaAsync(new StatisticsSchema
        {
            Namespace = StatisticsNamespaces.Flashcards,
            Kind = FlashcardStatKinds.LifetimeTotals,
            Description = "Lifetime flashcard totals.",
            AllowAdditionalFields = true,
            Fields = new[]
            {
                IntField("total_cards_practiced", required: false, defaultValue: 0, min: 0),
                IntField("total_sessions", required: false, defaultValue: 0, min: 0),
                IntField("current_streak_days", required: false, defaultValue: 0, min: 0),
                IntField("longest_streak_days", required: false, defaultValue: 0, min: 0),
                DateTimeField("last_practiced_day", required: false)
            }
        }).GetAwaiter().GetResult();

        // Notes: per-day aggregate
        stats.RegisterSchemaAsync(new StatisticsSchema
        {
            Namespace = StatisticsNamespaces.Notes,
            Kind = NoteStatKinds.DailySummary,
            Description = "Per-day note activity.",
            AllowAdditionalFields = true,
            Fields = new[]
            {
                IntField("notes_created", required: false, defaultValue: 0, min: 0),
                IntField("notes_edited", required: false, defaultValue: 0, min: 0),
                IntField("notes_deleted", required: false, defaultValue: 0, min: 0)
            }
        }).GetAwaiter().GetResult();

        // Notes: lifetime totals
        stats.RegisterSchemaAsync(new StatisticsSchema
        {
            Namespace = StatisticsNamespaces.Notes,
            Kind = NoteStatKinds.LifetimeTotals,
            Description = "Lifetime note totals.",
            AllowAdditionalFields = true,
            Fields = new[]
            {
                IntField("total_notes_created", required: false, defaultValue: 0, min: 0),
                IntField("total_notes_edited", required: false, defaultValue: 0, min: 0),
                IntField("total_notes_deleted", required: false, defaultValue: 0, min: 0)
            }
        }).GetAwaiter().GetResult();

        // App: dwell time by route category (study day key)
        stats.RegisterSchemaAsync(new StatisticsSchema
        {
            Namespace = StatisticsNamespaces.App,
            Kind = AppStatKinds.DailySummary,
            Description = "Per-day time-on-route estimates (seconds; coarse buckets).",
            AllowAdditionalFields = true,
            Fields = new[]
            {
                IntField("practice_seconds", required: false, defaultValue: 0, min: 0),
                IntField("notes_editor_seconds", required: false, defaultValue: 0, min: 0),
                IntField("flashcards_module_seconds", required: false, defaultValue: 0, min: 0)
            }
        }).GetAwaiter().GetResult();

        stats.RegisterSchemaAsync(new StatisticsSchema
        {
            Namespace = StatisticsNamespaces.App,
            Kind = AppStatKinds.LifetimeTotals,
            Description = "Lifetime app launches, gamification XP, and coarse totals.",
            AllowAdditionalFields = true,
            Fields = new[]
            {
                IntField("app_launch_count", required: false, defaultValue: 0, min: 0),
                IntField("total_xp", required: false, defaultValue: 0, min: 0)
            }
        }).GetAwaiter().GetResult();
    }

    private static StatisticsFieldDefinition BoolField(string name, bool required, bool defaultValue = false)
        => new()
        {
            Name = name,
            Type = StatValueType.Boolean,
            Required = required,
            DefaultValue = StatValue.FromBool(defaultValue)
        };

    private static StatisticsFieldDefinition IntField(string name, bool required, long? defaultValue = null, long? min = null, long? max = null)
        => new()
        {
            Name = name,
            Type = StatValueType.Integer,
            Required = required,
            DefaultValue = defaultValue.HasValue ? StatValue.FromInt(defaultValue.Value) : (StatValue?)null,
            MinValue = min.HasValue ? StatValue.FromInt(min.Value) : (StatValue?)null,
            MaxValue = max.HasValue ? StatValue.FromInt(max.Value) : (StatValue?)null,
        };

    private static StatisticsFieldDefinition DecimalField(string name, bool required, double? defaultValue = null, double? min = null, double? max = null)
        => new()
        {
            Name = name,
            Type = StatValueType.Decimal,
            Required = required,
            DefaultValue = defaultValue.HasValue ? StatValue.FromDecimal(defaultValue.Value) : (StatValue?)null,
            MinValue = min.HasValue ? StatValue.FromDecimal(min.Value) : (StatValue?)null,
            MaxValue = max.HasValue ? StatValue.FromDecimal(max.Value) : (StatValue?)null,
        };

    private static StatisticsFieldDefinition StringField(string name, bool required, string? defaultValue = null)
        => new()
        {
            Name = name,
            Type = StatValueType.String,
            Required = required,
            DefaultValue = defaultValue != null ? StatValue.FromString(defaultValue) : (StatValue?)null
        };

    private static StatisticsFieldDefinition DateTimeField(string name, bool required)
        => new()
        {
            Name = name,
            Type = StatValueType.DateTime,
            Required = required
        };
}
