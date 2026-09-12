using System.Text.Json;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.ProfileBackup;

internal static class ProfileBackupDatabase
{
    public static async Task ValidateAsync(string databasePath, CancellationToken cancellationToken)
    {
        await using var connection = new SqliteConnection($"Data Source={databasePath};Mode=ReadOnly;Pooling=False");
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText =
            "PRAGMA quick_check; SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'Storage';";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false) || reader.GetString(0) != "ok")
            throw new ProfileBackupException("backup_database_invalid", "The backup database failed its integrity check.");
        if (!await reader.NextResultAsync(cancellationToken).ConfigureAwait(false) ||
            !await reader.ReadAsync(cancellationToken).ConfigureAwait(false) || reader.GetInt32(0) != 1)
        {
            throw new ProfileBackupException("backup_database_invalid", "The backup does not contain a Mnemo database.");
        }
    }

    public static async Task<ProfileBackupContentSummary> SanitizeAndDescribeAsync(
        string databasePath,
        CancellationToken cancellationToken)
    {
        await using var connection = new SqliteConnection($"Data Source={databasePath};Pooling=False");
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);

        await using (var journal = connection.CreateCommand())
        {
            journal.CommandText = "PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON;";
            await journal.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        if (await TableExistsAsync(connection, "Storage", cancellationToken).ConfigureAwait(false))
        {
            var keys = await ReadStorageKeysAsync(connection, cancellationToken).ConfigureAwait(false);
            var excluded = keys
                .Where(key => ProfileBackupSettingsCatalog.Classify(key) != ProfileSettingClassification.Portable)
                .ToArray();
            if (excluded.Length > 0)
            {
                await using var delete = connection.CreateCommand();
                delete.CommandText =
                    $"DELETE FROM Storage WHERE Key IN ({string.Join(',', excluded.Select((_, i) => "$key" + i))})";
                for (var i = 0; i < excluded.Length; i++)
                    delete.Parameters.AddWithValue("$key" + i, excluded[i]);
                await delete.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }
        }

        if (await TableExistsAsync(connection, "AssetCleanupJobs", cancellationToken).ConfigureAwait(false))
        {
            await using var cleanup = connection.CreateCommand();
            cleanup.CommandText = "DELETE FROM AssetCleanupJobs";
            await cleanup.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using (var vacuum = connection.CreateCommand())
        {
            vacuum.CommandText = "VACUUM;";
            await vacuum.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        return await DescribeAsync(connection, cancellationToken).ConfigureAwait(false);
    }

    public static async Task<ProfileBackupContentSummary> DescribeAsync(
        string databasePath,
        CancellationToken cancellationToken)
    {
        await using var connection = new SqliteConnection($"Data Source={databasePath};Mode=ReadOnly;Pooling=False");
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        return await DescribeAsync(connection, cancellationToken).ConfigureAwait(false);
    }

    public static bool ContentSummaryMatches(ProfileBackupContentSummary declared, ProfileBackupContentSummary actual) =>
        declared.Notes == actual.Notes &&
        declared.NoteFolders == actual.NoteFolders &&
        declared.FlashcardDecks == actual.FlashcardDecks &&
        declared.FlashcardCards == actual.FlashcardCards &&
        declared.FlashcardTestAttempts == actual.FlashcardTestAttempts &&
        declared.Mindmaps == actual.Mindmaps &&
        declared.MindmapFolders == actual.MindmapFolders &&
        declared.TrashEntries == actual.TrashEntries &&
        declared.Conversations == actual.Conversations &&
        declared.ManagedFiles == actual.ManagedFiles &&
        declared.PortableSettings == actual.PortableSettings;

    public static async Task<string?> ReadJsonStringAsync(
        string databasePath,
        string key,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(databasePath))
            return null;
        await using var connection = new SqliteConnection($"Data Source={databasePath};Mode=ReadOnly;Pooling=False");
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        var value = await ReadStorageValueAsync(connection, key, cancellationToken).ConfigureAwait(false);
        if (value is null)
            return null;
        try
        {
            return JsonSerializer.Deserialize<string>(value);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static async Task<ProfileBackupContentSummary> DescribeAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        var keys = await ReadStorageKeysAsync(connection, cancellationToken).ConfigureAwait(false);
        return new ProfileBackupContentSummary
        {
            Notes = await CountStorageAsync(connection,
                "Key GLOB 'note_*' AND Key NOT GLOB 'note_folder_*' AND Key NOT IN ('notes_index','notes_trash','note_folders_index','note_folders_trash')",
                cancellationToken).ConfigureAwait(false),
            NoteFolders = await CountStorageAsync(connection, "Key GLOB 'note_folder_*'", cancellationToken)
                .ConfigureAwait(false),
            FlashcardDecks = await CountTableAsync(connection, "FlashcardDecks", cancellationToken).ConfigureAwait(false),
            FlashcardCards = await CountTableAsync(connection, "FlashcardCards", cancellationToken).ConfigureAwait(false),
            FlashcardTestAttempts = await CountTableAsync(connection, "FlashcardTestAttempts", cancellationToken)
                .ConfigureAwait(false),
            Mindmaps = await CountTableAsync(connection, "Mindmaps", cancellationToken).ConfigureAwait(false),
            MindmapFolders = await CountTableAsync(connection, "MindmapFolders", cancellationToken).ConfigureAwait(false),
            TrashEntries = await CountTableAsync(connection, "TrashEntries", cancellationToken).ConfigureAwait(false),
            Conversations = await CountConversationsAsync(connection, cancellationToken).ConfigureAwait(false),
            PortableSettings = keys.Count(key => ProfileBackupSettingsCatalog.All.TryGetValue(key, out var classification) &&
                classification == ProfileSettingClassification.Portable),
        };
    }

    private static async Task<List<string>> ReadStorageKeysAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        var keys = new List<string>();
        if (!await TableExistsAsync(connection, "Storage", cancellationToken).ConfigureAwait(false))
            return keys;
        await using var read = connection.CreateCommand();
        read.CommandText = "SELECT Key FROM Storage";
        await using var reader = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            keys.Add(reader.GetString(0));
        return keys;
    }

    private static async Task<int> CountTableAsync(
        SqliteConnection connection,
        string table,
        CancellationToken cancellationToken)
    {
        if (!await TableExistsAsync(connection, table, cancellationToken).ConfigureAwait(false))
            return 0;
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT COUNT(*) FROM [{table}]";
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false));
    }

    private static async Task<int> CountStorageAsync(
        SqliteConnection connection,
        string where,
        CancellationToken cancellationToken)
    {
        if (!await TableExistsAsync(connection, "Storage", cancellationToken).ConfigureAwait(false))
            return 0;
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM Storage WHERE " + where;
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false));
    }

    private static async Task<int> CountConversationsAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        var value = await ReadStorageValueAsync(connection, "chat_module_history", cancellationToken).ConfigureAwait(false);
        if (value is null)
            return 0;
        try
        {
            using var document = JsonDocument.Parse(value);
            return document.RootElement.TryGetProperty("conversations", out var conversations) &&
                   conversations.ValueKind == JsonValueKind.Array
                ? conversations.GetArrayLength()
                : 0;
        }
        catch (JsonException)
        {
            return 0;
        }
    }

    private static async Task<string?> ReadStorageValueAsync(
        SqliteConnection connection,
        string key,
        CancellationToken cancellationToken)
    {
        if (!await TableExistsAsync(connection, "Storage", cancellationToken).ConfigureAwait(false))
            return null;
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Value FROM Storage WHERE Key = $key";
        command.Parameters.AddWithValue("$key", key);
        return await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) as string;
    }

    private static async Task<bool> TableExistsAsync(
        SqliteConnection connection,
        string table,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name";
        command.Parameters.AddWithValue("$name", table);
        return await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is not null;
    }
}
