using Mnemo.Core.Models.Statistics;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Statistics;

namespace Mnemo.Infrastructure.Tests.Statistics;

/// <summary>
/// The store the app actually persists statistics through. Every other statistics test runs the
/// in-memory double, so nothing else opens the table, writes a tagged value and reads it back
/// off disk. The store resolves the database from the data root, which this assembly points at
/// a directory it owns; sitting in the data root collection keeps that root still while a store
/// is being opened here.
/// </summary>
[Collection(DataRootCollection.Name)]
public sealed class SqliteStatisticsStoreTests
{
    private static readonly DateTimeOffset Now = new(2026, 5, 1, 9, 30, 0, TimeSpan.Zero);

    [Fact]
    public void The_store_lives_under_the_data_root_this_assembly_owns()
    {
        Assert.StartsWith(TestDataRoot.Root, MnemoAppPaths.GetLocalUserDataFile("mnemo.db"), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Every_value_type_survives_a_write_and_a_reopen_with_its_type_intact()
    {
        var ns = Namespace();
        var logger = new TestLogger();
        var written = new StatisticsRecord
        {
            Namespace = ns,
            Kind = "daily.summary",
            Key = "2026-05-01",
            CreatedAt = Now,
            UpdatedAt = Now,
            Version = 1,
            SourceModule = "flashcards",
            Fields = new Dictionary<string, StatValue>(StringComparer.Ordinal)
            {
                ["cards_reviewed"] = StatValue.FromInt(42),
                ["retention"] = StatValue.FromDecimal(0.8725),
                ["deck_name"] = StatValue.FromString("Pharmacology"),
                ["goal_met"] = StatValue.FromBool(true),
                ["last_studied"] = StatValue.FromDateTime(new DateTimeOffset(2026, 4, 30, 22, 15, 0, TimeSpan.Zero)),
            },
            MetadataJson = "{\"source\":\"test\"}",
        };

        await new SqliteStatisticsStore(logger).InsertAsync(written);

        // A second instance is a fresh connection to the same file: what comes back is what is on
        // disk, not what the first instance still held.
        var read = await new SqliteStatisticsStore(logger).GetAsync(ns, "daily.summary", "2026-05-01");

        Assert.NotNull(read);
        Assert.Equal(written.Namespace, read!.Namespace);
        Assert.Equal(written.Kind, read.Kind);
        Assert.Equal(written.Key, read.Key);
        Assert.Equal(written.CreatedAt, read.CreatedAt);
        Assert.Equal(written.UpdatedAt, read.UpdatedAt);
        Assert.Equal(1, read.Version);
        Assert.Equal("flashcards", read.SourceModule);
        Assert.Equal(written.MetadataJson, read.MetadataJson);

        Assert.Equal(5, read.Fields.Count);
        Assert.Equal(StatValueType.Integer, read.Fields["cards_reviewed"].Type);
        Assert.Equal(42, read.Fields["cards_reviewed"].AsInt());
        Assert.Equal(StatValueType.Decimal, read.Fields["retention"].Type);
        Assert.Equal(0.8725, read.Fields["retention"].AsDecimal());
        Assert.Equal(StatValueType.String, read.Fields["deck_name"].Type);
        Assert.Equal("Pharmacology", read.Fields["deck_name"].AsString());
        Assert.Equal(StatValueType.Boolean, read.Fields["goal_met"].Type);
        Assert.True(read.Fields["goal_met"].AsBool());
        Assert.Equal(StatValueType.DateTime, read.Fields["last_studied"].Type);
        Assert.Equal(new DateTimeOffset(2026, 4, 30, 22, 15, 0, TimeSpan.Zero), read.Fields["last_studied"].AsDateTime());

        Assert.Empty(logger.Errors);
    }

    [Fact]
    public async Task An_update_with_a_stale_expected_version_is_refused_and_leaves_the_row_alone()
    {
        var ns = Namespace();
        var logger = new TestLogger();
        var store = new SqliteStatisticsStore(logger);
        await store.InsertAsync(Record(ns, version: 1, "cards_reviewed", 10));

        var stale = await store.UpdateAsync(Record(ns, version: 2, "cards_reviewed", 99), expectedVersion: 7);
        Assert.Null(stale);
        Assert.Equal(10, (await store.GetAsync(ns, "daily.summary", "2026-05-01"))!.Fields["cards_reviewed"].AsInt());

        var applied = await store.UpdateAsync(Record(ns, version: 2, "cards_reviewed", 99), expectedVersion: 1);
        Assert.NotNull(applied);
        var stored = (await store.GetAsync(ns, "daily.summary", "2026-05-01"))!;
        Assert.Equal(2, stored.Version);
        Assert.Equal(99, stored.Fields["cards_reviewed"].AsInt());
        Assert.Empty(logger.Errors);
    }

    [Fact]
    public async Task Updating_a_row_that_was_never_written_answers_null_rather_than_creating_it()
    {
        var ns = Namespace();
        var store = new SqliteStatisticsStore(new TestLogger());

        Assert.Null(await store.UpdateAsync(Record(ns, version: 1, "cards_reviewed", 1), expectedVersion: null));
        Assert.False(await store.ExistsAsync(ns, "daily.summary", "2026-05-01"));
    }

    [Fact]
    public async Task Delete_removes_the_row_and_is_quiet_the_second_time()
    {
        var ns = Namespace();
        var store = new SqliteStatisticsStore(new TestLogger());
        await store.InsertAsync(Record(ns, version: 1, "cards_reviewed", 1));
        Assert.True(await store.ExistsAsync(ns, "daily.summary", "2026-05-01"));

        await store.DeleteAsync(ns, "daily.summary", "2026-05-01");
        await store.DeleteAsync(ns, "daily.summary", "2026-05-01");

        Assert.False(await store.ExistsAsync(ns, "daily.summary", "2026-05-01"));
        Assert.Null(await store.GetAsync(ns, "daily.summary", "2026-05-01"));
    }

    [Fact]
    public async Task A_query_narrows_by_kind_and_key_prefix_and_orders_by_update_time()
    {
        var ns = Namespace();
        var store = new SqliteStatisticsStore(new TestLogger());
        await store.InsertAsync(Record(ns, version: 1, "cards_reviewed", 1, key: "2026-05-01", updated: Now));
        await store.InsertAsync(Record(ns, version: 1, "cards_reviewed", 2, key: "2026-05-02", updated: Now.AddDays(1)));
        await store.InsertAsync(Record(ns, version: 1, "cards_reviewed", 3, key: "2026-04-30", updated: Now.AddDays(-1)));
        await store.InsertAsync(Record(ns, version: 1, "cards_reviewed", 4, key: "2026-05-03", updated: Now.AddDays(2), kind: "deck.summary"));

        var may = await store.QueryAsync(new StatisticsQuery
        {
            Namespace = ns,
            Kind = "daily.summary",
            KeyPrefix = "2026-05",
        });

        Assert.Equal(["2026-05-02", "2026-05-01"], may.Select(r => r.Key));

        var ascending = await store.QueryAsync(new StatisticsQuery
        {
            Namespace = ns,
            Kind = "daily.summary",
            OrderByUpdatedDescending = false,
        });

        Assert.Equal(["2026-04-30", "2026-05-01", "2026-05-02"], ascending.Select(r => r.Key));

        var recent = await store.QueryAsync(new StatisticsQuery
        {
            Namespace = ns,
            UpdatedAfter = Now.AddHours(1),
            Limit = 1,
        });

        Assert.Equal("2026-05-03", Assert.Single(recent).Key);
        Assert.Empty(await store.QueryAsync(new StatisticsQuery { Namespace = Namespace() }));
    }

    private static string Namespace() => $"test-{Guid.NewGuid():N}";

    private static StatisticsRecord Record(
        string ns,
        long version,
        string field,
        long value,
        string key = "2026-05-01",
        DateTimeOffset? updated = null,
        string kind = "daily.summary") => new()
    {
        Namespace = ns,
        Kind = kind,
        Key = key,
        CreatedAt = Now,
        UpdatedAt = updated ?? Now,
        Version = version,
        SourceModule = "flashcards",
        Fields = new Dictionary<string, StatValue>(StringComparer.Ordinal) { [field] = StatValue.FromInt(value) },
    };
}
