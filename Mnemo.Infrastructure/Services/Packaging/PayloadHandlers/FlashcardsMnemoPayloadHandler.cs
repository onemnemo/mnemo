using System.Text.Json;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Common;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

public sealed class FlashcardsMnemoPayloadHandler : IMnemoPayloadHandler
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly IFlashcardDeckService _deckService;

    public FlashcardsMnemoPayloadHandler(IFlashcardDeckService deckService)
    {
        _deckService = deckService;
    }

    public string PayloadType => "flashcards";

    public async Task<MnemoPayloadExportData> ExportAsync(MnemoPayloadExportContext context, CancellationToken cancellationToken = default)
    {
        var folders = await _deckService.ListFoldersAsync(cancellationToken).ConfigureAwait(false);
        var decks = await _deckService.ListDecksAsync(cancellationToken).ConfigureAwait(false);
        var selectedDeckIds = ResolveSelectedDeckIds(context.Options);
        if (selectedDeckIds.Count > 0)
        {
            decks = decks.Where(d => selectedDeckIds.Contains(d.Id)).ToArray();
            var usedFolderIds = new HashSet<string>(decks.Where(d => !string.IsNullOrWhiteSpace(d.FolderId)).Select(d => d.FolderId!), StringComparer.Ordinal);
            folders = folders.Where(f => usedFolderIds.Contains(f.Id)).ToArray();
        }

        return new MnemoPayloadExportData
        {
            ItemCount = decks.Count,
            SchemaVersion = 1,
            Files = new Dictionary<string, byte[]>
            {
                ["flashcards.db"] = BuildFlashcardsSqlite(decks, folders)
            }
        };
    }

    public async Task<MnemoPayloadImportResult> ImportAsync(MnemoPayloadImportContext context, CancellationToken cancellationToken = default)
    {
        if (!context.Files.TryGetValue("flashcards.db", out var bytes))
            return new MnemoPayloadImportResult { Warnings = { "Flashcards payload missing flashcards.db file." } };

        var snapshot = ReadFlashcardsSqlite(bytes);
        var existingFolders = await _deckService.ListFoldersAsync(cancellationToken).ConfigureAwait(false);
        var existingDecks = await _deckService.ListDecksAsync(cancellationToken).ConfigureAwait(false);
        var existingFolderIds = new HashSet<string>(existingFolders.Select(f => f.Id), StringComparer.Ordinal);
        var existingDeckIds = new HashSet<string>(existingDecks.Select(d => d.Id), StringComparer.Ordinal);
        var folderMap = new Dictionary<string, string>(StringComparer.Ordinal);

        var result = new MnemoPayloadImportResult();
        var policy = context.Options.ConflictPolicy;
        var usedDeckNames = new HashSet<string>(existingDecks.Select(d => d.Name), StringComparer.OrdinalIgnoreCase);

        foreach (var folder in snapshot.Folders)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var imported = folder with { };
            if (existingFolderIds.Contains(imported.Id))
            {
                if (policy == ImportConflictPolicy.Skip)
                {
                    folderMap[folder.Id] = imported.Id;
                    continue;
                }

                if (policy == ImportConflictPolicy.KeepBoth)
                {
                    imported = imported with { Id = Guid.NewGuid().ToString() };
                    result.DuplicatedCount++;
                }
            }

            if (!string.IsNullOrWhiteSpace(imported.ParentId) && folderMap.TryGetValue(imported.ParentId, out var remappedParentId))
                imported = imported with { ParentId = remappedParentId };

            folderMap[folder.Id] = imported.Id;
            await _deckService.SaveFolderAsync(imported, cancellationToken).ConfigureAwait(false);
        }

        foreach (var deck in snapshot.Decks)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var imported = deck with { };
            if (existingDeckIds.Contains(imported.Id))
            {
                if (policy == ImportConflictPolicy.Skip)
                {
                    result.SkippedCount++;
                    continue;
                }

                if (policy == ImportConflictPolicy.KeepBoth)
                {
                    imported = imported with
                    {
                        Id = Guid.NewGuid().ToString(),
                        Name = ImportNaming.NextAvailableName(imported.Name, usedDeckNames)
                    };
                    result.DuplicatedCount++;
                }
            }

            usedDeckNames.Add(imported.Name);
            if (!string.IsNullOrWhiteSpace(imported.FolderId) && folderMap.TryGetValue(imported.FolderId, out var remappedFolderId))
                imported = imported with { FolderId = remappedFolderId };

            await _deckService.SaveDeckAsync(imported, cancellationToken).ConfigureAwait(false);
            result.ImportedCount++;
        }

        return result;
    }

    private static HashSet<string> ResolveSelectedDeckIds(MnemoPackageExportOptions options)
    {
        if (!options.PayloadOptions.TryGetValue("flashcards.deckIds", out var value))
            return new HashSet<string>(StringComparer.Ordinal);
        if (value is IEnumerable<string> ids)
            return new HashSet<string>(ids.Where(v => !string.IsNullOrWhiteSpace(v)), StringComparer.Ordinal);
        return new HashSet<string>(StringComparer.Ordinal);
    }

    private static byte[] BuildFlashcardsSqlite(IReadOnlyList<FlashcardDeck> decks, IReadOnlyList<FlashcardFolder> folders)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"mnemo-flashcards-{Guid.NewGuid():N}.db");
        try
        {
            using (var connection = new SqliteConnection($"Data Source={tempPath}"))
            {
                connection.Open();
                using var cmd = connection.CreateCommand();
                cmd.CommandText = """
                                  CREATE TABLE IF NOT EXISTS Decks (
                                      DeckId TEXT PRIMARY KEY,
                                      Json TEXT NOT NULL
                                  );
                                  CREATE TABLE IF NOT EXISTS Folders (
                                      FolderId TEXT PRIMARY KEY,
                                      Json TEXT NOT NULL
                                  );
                                  """;
                cmd.ExecuteNonQuery();

                using var tx = connection.BeginTransaction();
                foreach (var deck in decks)
                {
                    using var insert = connection.CreateCommand();
                    insert.Transaction = tx;
                    insert.CommandText = "INSERT OR REPLACE INTO Decks (DeckId, Json) VALUES ($id, $json)";
                    insert.Parameters.AddWithValue("$id", deck.Id);
                    insert.Parameters.AddWithValue("$json", JsonSerializer.Serialize(deck, JsonOptions));
                    insert.ExecuteNonQuery();
                }

                foreach (var folder in folders)
                {
                    using var insert = connection.CreateCommand();
                    insert.Transaction = tx;
                    insert.CommandText = "INSERT OR REPLACE INTO Folders (FolderId, Json) VALUES ($id, $json)";
                    insert.Parameters.AddWithValue("$id", folder.Id);
                    insert.Parameters.AddWithValue("$json", JsonSerializer.Serialize(folder, JsonOptions));
                    insert.ExecuteNonQuery();
                }

                tx.Commit();
            }

            SqliteConnection.ClearAllPools();
            return File.ReadAllBytes(tempPath);
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                try { File.Delete(tempPath); } catch (IOException) { }
            }
        }
    }

    private static FlashcardSnapshot ReadFlashcardsSqlite(byte[] dbBytes)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"mnemo-flashcards-import-{Guid.NewGuid():N}.db");
        try
        {
            File.WriteAllBytes(tempPath, dbBytes);
            var snapshot = new FlashcardSnapshot();
            using var connection = new SqliteConnection($"Data Source={tempPath}");
            connection.Open();

            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = "SELECT Json FROM Decks";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var deck = JsonSerializer.Deserialize<FlashcardDeck>(reader.GetString(0), JsonOptions);
                    if (deck != null)
                        snapshot.Decks.Add(deck);
                }
            }

            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = "SELECT Json FROM Folders";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var folder = JsonSerializer.Deserialize<FlashcardFolder>(reader.GetString(0), JsonOptions);
                    if (folder != null)
                        snapshot.Folders.Add(folder);
                }
            }

            SqliteConnection.ClearAllPools();
            return snapshot;
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                try { File.Delete(tempPath); } catch (IOException) { }
            }
        }
    }

    private sealed class FlashcardSnapshot
    {
        public List<FlashcardFolder> Folders { get; set; } = new();
        public List<FlashcardDeck> Decks { get; set; } = new();
    }
}
