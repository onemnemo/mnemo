using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;
using static Mnemo.Infrastructure.Tests.Flashcards.AnkiOcclusionImportKit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>Finding a note's fields by the tags Anki gives them, however they were renamed or moved.</summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiOcclusionFieldTagTests
{
    [Theory]
    [InlineData("anki21b-image-occlusion-fields.apkg")]
    [InlineData("anki-legacy-image-occlusion-fields.apkg")]
    public async Task Import_RenamedAndReorderedFields_AreFoundByTheirTags(string fixture)
    {
        await using var h = new FlashcardStoreHarness();
        var (result, note) = await ImportNoteAsync(h, fixture, "Reordered");

        Assert.Equal("Fields moved", note.Fact.Value(FlashcardCardType.OcclusionBackFieldId));
        Assert.Equal(2, note.Cards.Length);
        Assert.Equal(2, note.Doc.Masks.Count);
        Assert.Single(note.Fact.MediaOn(FlashcardCardType.OcclusionImageFieldId));
        Assert.Equal(1, CountOf(result, "AnkiOcclusionCommentsLeftBehind"));
    }

    [Fact]
    public async Task Reader_FieldsPackages_ReadTheTagsEachFieldCarries()
    {
        foreach (var name in new[] { "anki21b-image-occlusion-fields.apkg", "anki-legacy-image-occlusion-fields.apkg" })
        {
            var type = await ReadNoteTypeAsync(name);

            Assert.True(type.IsImageOcclusion);
            Assert.Equal(1, type.FieldIndexByTag(0));
            Assert.Equal(0, type.FieldIndexByTag(1));
            Assert.Equal(3, type.FieldIndexByTag(2));
            Assert.Equal(4, type.FieldIndexByTag(3));
            Assert.Equal(2, type.FieldIndexByTag(4));
        }

        var stock = await ReadNoteTypeAsync("anki21b-image-occlusion.apkg");
        Assert.Equal(1, stock.FieldIndexByTag(1));
        Assert.Equal(4, stock.FieldIndexByTag(4));
    }

    [Fact]
    public void FieldIndexByTag_WithoutTags_FallsBackToStockPositions()
    {
        var type = new AnkiNoteType(1, "x", true, AnkiStockKind.ImageOcclusion, ["a", "b", "c", "d"], []);

        Assert.Equal(2, type.FieldIndexByTag(2));
        Assert.Null(type.FieldIndexByTag(4));

        var deleted = type with { FieldTags = new int?[] { 0, 1, 2, 3 } };
        Assert.Null(deleted.FieldIndexByTag(4));
    }

    private static async Task<AnkiNoteType> ReadNoteTypeAsync(string name)
    {
        var temp = Path.Combine(Path.GetTempPath(), $"mnemo-anki-io-{Guid.NewGuid():N}");
        Directory.CreateDirectory(temp);
        try
        {
            var contents = await AnkiPackageReader.ExtractAsync(Fixture(name), temp, default);
            await using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
            {
                DataSource = contents.CollectionPath,
                Mode = SqliteOpenMode.ReadOnly,
                Pooling = false,
            }.ToString());
            await connection.OpenAsync();
            AnkiNoteTypeReader.RegisterCollations(connection);
            var modelsJson = contents.Version == AnkiPackageVersion.Latest ? string.Empty : await ReadModelsAsync(connection);
            return Assert.Single((await AnkiNoteTypeReader.ReadAsync(connection, modelsJson, default)).Values);
        }
        finally
        {
            Directory.Delete(temp, recursive: true);
        }
    }

    private static async Task<string> ReadModelsAsync(SqliteConnection connection)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT models FROM col";
        return (string)(await command.ExecuteScalarAsync())!;
    }
}
