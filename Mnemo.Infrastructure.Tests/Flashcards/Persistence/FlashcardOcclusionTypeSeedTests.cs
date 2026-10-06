using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>The image occlusion card type reaching fresh and existing collections.</summary>
public sealed class FlashcardOcclusionTypeSeedTests
{
    [Fact]
    public async Task A_new_collection_has_the_type_once_with_its_fixed_fields()
    {
        var path = TempPath();
        try
        {
            await using var store = new FlashcardStore(new TestLogger(), path);
            await store.InitializeAsync();

            var type = await ReadTypeAsync(store);

            Assert.NotNull(type);
            Assert.True(type!.IsBuiltIn);
            Assert.Equal("Image occlusion", type.Name);
            Assert.Equal(FlashcardGenerators.Occlusion, type.Generator);
            Assert.Equal("image", type.GenerateFrom);
            Assert.Equal("front", type.SortFieldId);
            Assert.Equal(["image", "front", "back", "masks"], type.Fields.Select(f => f.Id));
            Assert.Equal(1, await CountAsync(store));
        }
        finally
        {
            FlashcardStoreUpgradeTests.Delete(path);
        }
    }

    [Fact]
    public async Task A_collection_from_before_the_type_gains_it_and_keeps_its_other_types()
    {
        var path = TempPath();
        try
        {
            await using (var first = new FlashcardStore(new TestLogger(), path))
                await first.InitializeAsync();
            await ExecuteAsync(path, "DELETE FROM FlashcardCardTypes WHERE Id = 'occlusion';");
            await FlashcardStoreUpgradeTests.SetVersionAsync(path, 12);

            await using var store = new FlashcardStore(new TestLogger(), path);
            await store.InitializeAsync();

            Assert.NotNull(await ReadTypeAsync(store));
            Assert.Equal(1, await CountAsync(store));
            var all = await store.ReadAsync((conn, ct) => new CardTypeRepository().ListAsync(conn, ct));
            Assert.Contains(all, t => t.Id == FlashcardCardType.ClozeId);
            Assert.Contains(all, t => t.Id == FlashcardCardType.BasicId);
        }
        finally
        {
            FlashcardStoreUpgradeTests.Delete(path);
        }
    }

    [Fact]
    public async Task A_type_row_someone_edited_is_not_overwritten_by_the_upgrade()
    {
        var path = TempPath();
        try
        {
            await using (var first = new FlashcardStore(new TestLogger(), path))
                await first.InitializeAsync();
            await ExecuteAsync(path, "UPDATE FlashcardCardTypes SET Name = 'My occlusion' WHERE Id = 'occlusion';");
            await FlashcardStoreUpgradeTests.SetVersionAsync(path, 12);

            await using var store = new FlashcardStore(new TestLogger(), path);
            await store.InitializeAsync();

            Assert.Equal("My occlusion", (await ReadTypeAsync(store))!.Name);
        }
        finally
        {
            FlashcardStoreUpgradeTests.Delete(path);
        }
    }

    private static string TempPath() => Path.Combine(Path.GetTempPath(), $"mnemo_fc_occl_{Guid.NewGuid():N}.db");

    private static Task<FlashcardCardType?> ReadTypeAsync(FlashcardStore store) =>
        store.ReadAsync((conn, ct) => new CardTypeRepository().GetAsync(conn, FlashcardCardType.OcclusionId, ct));

    private static Task<int> CountAsync(FlashcardStore store) =>
        store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM FlashcardCardTypes WHERE Id = 'occlusion';";
            return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
        });

    private static async Task ExecuteAsync(string path, string sql)
    {
        SqliteTestPools.ClearPoolFor(path);
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
    }
}
