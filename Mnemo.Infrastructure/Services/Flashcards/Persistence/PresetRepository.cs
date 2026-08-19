using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>Row-level access to <c>FlashcardPresets</c>.</summary>
public interface IPresetRepository
{
    Task<IReadOnlyList<FlashcardPreset>> ListAsync(SqliteConnection conn, CancellationToken cancellationToken);
    Task<FlashcardPreset?> GetAsync(SqliteConnection conn, string presetId, CancellationToken cancellationToken);
    Task<bool> ExistsAsync(SqliteConnection conn, string presetId, CancellationToken cancellationToken);
    Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardPreset preset, CancellationToken cancellationToken);
    Task<bool> DeleteAsync(SqliteConnection conn, SqliteTransaction tx, string presetId, CancellationToken cancellationToken);
    Task<int> CountDecksUsingAsync(SqliteConnection conn, string presetId, CancellationToken cancellationToken);
}

/// <inheritdoc />
public sealed class PresetRepository : IPresetRepository
{
    private const string SelectColumns =
        "Id, Name, NewPerDay, MaxReviewsPerDay, Algorithm, DesiredRetention, LearningStepsJson, " +
        "RelearnStepsJson, ShuffleOrder, BuryRelated, AutoReveal, WeightsJson, CreatedAt, UpdatedAt, " +
        "NextDayStartsAtHour";

    public async Task<IReadOnlyList<FlashcardPreset>> ListAsync(SqliteConnection conn, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardPresets ORDER BY Name;";
        var list = new List<FlashcardPreset>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            list.Add(Read(reader));
        return list;
    }

    public async Task<FlashcardPreset?> GetAsync(SqliteConnection conn, string presetId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardPresets WHERE Id = $id LIMIT 1;";
        cmd.Parameters.AddWithValue("$id", presetId);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        return await reader.ReadAsync(cancellationToken).ConfigureAwait(false) ? Read(reader) : null;
    }

    public async Task<bool> ExistsAsync(SqliteConnection conn, string presetId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT 1 FROM FlashcardPresets WHERE Id = $id LIMIT 1;";
        cmd.Parameters.AddWithValue("$id", presetId);
        var result = await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return result is not null && result != DBNull.Value;
    }

    public async Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardPreset preset, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO FlashcardPresets
                (Id, Name, NewPerDay, MaxReviewsPerDay, Algorithm, DesiredRetention, LearningStepsJson,
                 RelearnStepsJson, ShuffleOrder, BuryRelated, AutoReveal, WeightsJson, CreatedAt, UpdatedAt,
                 NextDayStartsAtHour)
            VALUES
                ($id, $name, $new, $max, $algo, $ret, $learn, $relearn, $shuffle, $bury, $auto, $weights, $created, $updated,
                 $dayStart)
            ON CONFLICT(Id) DO UPDATE SET
                Name = $name, NewPerDay = $new, MaxReviewsPerDay = $max, Algorithm = $algo,
                DesiredRetention = $ret, LearningStepsJson = $learn, RelearnStepsJson = $relearn,
                ShuffleOrder = $shuffle, BuryRelated = $bury, AutoReveal = $auto, WeightsJson = $weights,
                UpdatedAt = $updated, NextDayStartsAtHour = $dayStart;
            """;
        cmd.Parameters.AddWithValue("$id", preset.Id);
        cmd.Parameters.AddWithValue("$name", preset.Name);
        cmd.Parameters.AddWithValue("$new", preset.NewPerDay);
        cmd.Parameters.AddWithValue("$max", preset.MaxReviewsPerDay);
        cmd.Parameters.AddWithValue("$algo", (int)preset.Algorithm);
        cmd.Parameters.AddWithValue("$ret", preset.DesiredRetention);
        cmd.Parameters.AddWithValue("$learn", FlashcardSqlMap.IntList(preset.LearningSteps));
        cmd.Parameters.AddWithValue("$relearn", FlashcardSqlMap.IntList(preset.RelearnSteps));
        cmd.Parameters.AddWithValue("$shuffle", preset.ShuffleOrder ? 1 : 0);
        cmd.Parameters.AddWithValue("$bury", preset.BuryRelated ? 1 : 0);
        cmd.Parameters.AddWithValue("$auto", FlashcardSqlMap.AutoReveal(preset.AutoReveal));
        cmd.Parameters.AddWithValue("$weights", (object?)FlashcardSqlMap.DoubleListN(preset.Weights) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$created", FlashcardSqlMap.Ts(preset.CreatedAt == default ? DateTimeOffset.UtcNow : preset.CreatedAt));
        cmd.Parameters.AddWithValue("$updated", FlashcardSqlMap.Ts(preset.UpdatedAt == default ? DateTimeOffset.UtcNow : preset.UpdatedAt));
        cmd.Parameters.AddWithValue("$dayStart", preset.DayStartHour);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<bool> DeleteAsync(SqliteConnection conn, SqliteTransaction tx, string presetId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "DELETE FROM FlashcardPresets WHERE Id = $id;";
        cmd.Parameters.AddWithValue("$id", presetId);
        var rows = await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        return rows > 0;
    }

    public async Task<int> CountDecksUsingAsync(SqliteConnection conn, string presetId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM FlashcardDecks WHERE PresetId = $id;";
        cmd.Parameters.AddWithValue("$id", presetId);
        var result = await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return Convert.ToInt32(result);
    }

    private static FlashcardPreset Read(SqliteDataReader reader) => new(
        Id: reader.GetString(0),
        Name: reader.GetString(1),
        NewPerDay: reader.GetInt32(2),
        MaxReviewsPerDay: reader.GetInt32(3),
        Algorithm: (FlashcardSchedulingAlgorithm)reader.GetInt32(4),
        DesiredRetention: reader.GetDouble(5),
        LearningSteps: FlashcardSqlMap.ReadIntList(reader.GetString(6), new[] { 1, 10 }),
        RelearnSteps: FlashcardSqlMap.ReadIntList(reader.GetString(7), new[] { 10 }),
        ShuffleOrder: reader.GetInt32(8) != 0,
        BuryRelated: reader.GetInt32(9) != 0,
        AutoReveal: FlashcardSqlMap.ReadAutoReveal(reader.GetString(10)),
        Weights: FlashcardSqlMap.ReadDoubleListN(FlashcardSqlMap.ReadStringN(reader, 11)),
        CreatedAt: FlashcardSqlMap.ReadTs(reader, 12),
        UpdatedAt: FlashcardSqlMap.ReadTs(reader, 13),
        NextDayStartsAtHour: reader.GetInt32(14));
}
