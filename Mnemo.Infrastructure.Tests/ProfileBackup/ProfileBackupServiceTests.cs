using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.ProfileBackup;

namespace Mnemo.Infrastructure.Tests.ProfileBackup;

public sealed class ProfileBackupServiceTests
{
    [Fact]
    public async Task CreateAsync_RoundTripsDurableProfileAndExcludesSecretsAndMachineState()
    {
        using var profile = await TestProfile.CreateAsync();
        await profile.WriteAssetAsync("note-assets", "note.png", "note image");
        await profile.WriteAssetAsync("images", "card.png", "card image");
        await profile.WriteAssetAsync("mindmap-assets", "map.png", "map image");
        await profile.WriteAssetAsync("chat-attachments", "paper.pdf", "chat file");
        await profile.WriteAssetAsync("avatar", "me.png", "avatar");
        await profile.WriteRootFileAsync("logs/app.log", "runtime log");
        await profile.WriteRootFileAsync("transfer-staging/upload.tmp", "staged import");
        await profile.WriteRootFileAsync("packages/update.bin", "update package");
        await profile.WriteRootFileAsync("mnemo.lock", "process lock");
        var archive = Path.Combine(profile.Parent, "profile.mnemo-backup");
        var service = profile.Service();

        var manifest = await service.CreateAsync(archive, "0.8.0-beta");
        var inspection = await service.InspectAsync(archive, "0.8.0-beta");

        Assert.Equal(1, manifest.Contents.Notes);
        Assert.Equal(1, manifest.Contents.NoteFolders);
        Assert.Equal(2, manifest.Contents.FlashcardDecks);
        Assert.Equal(1, manifest.Contents.FlashcardCards);
        Assert.Equal(1, manifest.Contents.FlashcardTestAttempts);
        Assert.Equal(1, manifest.Contents.Mindmaps);
        Assert.Equal(1, manifest.Contents.MindmapFolders);
        Assert.Equal(1, manifest.Contents.TrashEntries);
        Assert.Equal(5, manifest.Contents.ManagedFiles);
        Assert.True(inspection.FromThisCollection);

        var extracted = Path.Combine(profile.Parent, "extracted");
        ZipFile.ExtractToDirectory(archive, extracted);
        using (var zip = ZipFile.OpenRead(archive))
        {
            Assert.DoesNotContain(zip.Entries, entry => entry.FullName.StartsWith("logs/", StringComparison.Ordinal));
            Assert.DoesNotContain(zip.Entries, entry => entry.FullName.StartsWith("transfer-staging/", StringComparison.Ordinal));
            Assert.DoesNotContain(zip.Entries, entry => entry.FullName.StartsWith("packages/", StringComparison.Ordinal));
            Assert.DoesNotContain(zip.Entries, entry => entry.FullName.EndsWith(".lock", StringComparison.Ordinal));
        }
        await using var database = new SqliteConnection($"Data Source={Path.Combine(extracted, "profile.db")};Mode=ReadOnly;Pooling=False");
        await database.OpenAsync();
        Assert.Equal("\"Ada\"", await StoredValueAsync(database, "User.DisplayName"));
        Assert.Equal("[\"en\",\"nb\"]", await StoredValueAsync(database, "Proofing.Languages"));
        Assert.Equal("{\"n1\":{\"mode\":\"custom\",\"languages\":[\"nb\"]}}",
            await StoredValueAsync(database, "Proofing.NoteLanguages"));
        Assert.Equal("{\"widgets\":[\"recent-notes\"]}", await StoredValueAsync(database, "overview_layout_v2"));
        Assert.Equal("true", await StoredValueAsync(database, "Updates.AutoCheck"));
        Assert.Null(await StoredValueAsync(database, "AI.OpenRouter.ApiKey"));
        Assert.Null(await StoredValueAsync(database, "App.LaunchAtStartup"));
        Assert.Null(await StoredValueAsync(database, "Updates.LastCheckedUtc"));
        Assert.Null(await StoredValueAsync(database, "App.BetaNoticeSeenVersion"));
        Assert.Null(await StoredValueAsync(database, "unknown.future.setting"));
        Assert.Null(await ScalarAsync(database, "SELECT 1 FROM AssetCleanupJobs LIMIT 1"));
        Assert.Equal("folder-1", await ScalarAsync(database, "SELECT FolderId FROM FlashcardDecks WHERE Id = 'deck-1'"));
        Assert.Equal("fact-1", await ScalarAsync(database, "SELECT FactId FROM FlashcardCards WHERE Id = 'card-1'"));
        Assert.Equal(6L, await ScalarAsync(database, "SELECT Reps FROM FlashcardScheduling WHERE CardId = 'card-1'"));
        Assert.Equal(3L, await ScalarAsync(database, "SELECT Grade FROM FlashcardReviews WHERE Id = 41"));
        Assert.Equal("2030-02-01T00:00:00Z", await ScalarAsync(database, "SELECT ExpiresAt FROM TrashEntries WHERE Id = 'trash-1'"));
        Assert.Equal("map-folder-1", await ScalarAsync(database, "SELECT FolderId FROM Mindmaps WHERE Id = 'map-1'"));
        Assert.Equal("note image", await File.ReadAllTextAsync(Path.Combine(extracted, "assets", "note-assets", "note.png")));
    }

    [Fact]
    public async Task CreateAsync_FailureLeavesNoFinalArchive()
    {
        using var profile = await TestProfile.CreateAsync();
        var archive = Path.Combine(profile.Parent, "failed.mnemo-backup");

        await Assert.ThrowsAsync<IOException>(() =>
            profile.Service(checkpoint: _ => throw new IOException("write failed"))
                .CreateAsync(archive, "0.8.0-beta"));

        Assert.False(File.Exists(archive));
        Assert.Empty(Directory.EnumerateFiles(profile.Parent, "*.building", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task CreateAsync_CancellationPreservesThePreviousValidBackup()
    {
        using var profile = await TestProfile.CreateAsync();
        var archive = Path.Combine(profile.Parent, "existing.mnemo-backup");
        var service = profile.Service();
        await service.CreateAsync(archive, "0.8.0-beta");
        var previous = await File.ReadAllBytesAsync(archive);
        using var cancellation = new CancellationTokenSource();
        var cancelling = profile.Service(checkpoint: _ => cancellation.Cancel());

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            cancelling.CreateAsync(archive, "0.8.0-beta", cancellation.Token));

        Assert.Equal(previous, await File.ReadAllBytesAsync(archive));
        await service.InspectAsync(archive, "0.8.0-beta");
    }

    [Fact]
    public async Task CreateAsync_AtomicallyReplacesAnExistingBackup()
    {
        using var profile = await TestProfile.CreateAsync();
        var archive = Path.Combine(profile.Parent, "existing.mnemo-backup");
        var service = profile.Service();
        await service.CreateAsync(archive, "0.8.0-beta");
        await profile.SetStorageAsync("User.DisplayName", "\"Grace\"");

        await service.CreateAsync(archive, "0.8.0-beta");

        var extracted = Path.Combine(profile.Parent, "replacement");
        ZipFile.ExtractToDirectory(archive, extracted);
        await using var database = new SqliteConnection(
            $"Data Source={Path.Combine(extracted, "profile.db")};Mode=ReadOnly;Pooling=False");
        await database.OpenAsync();
        Assert.Equal("\"Grace\"", await StoredValueAsync(database, "User.DisplayName"));
        Assert.Empty(Directory.EnumerateFiles(profile.Parent, "*.building", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task CreateAsync_CapturesCommittedWalRowsAndProducesAStandaloneDatabase()
    {
        using var profile = await TestProfile.CreateAsync();
        await using var writer = new SqliteConnection($"Data Source={profile.DatabasePath};Pooling=False");
        await writer.OpenAsync();
        await using (var command = writer.CreateCommand())
        {
            command.CommandText =
                "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; " +
                "UPDATE Storage SET Value = '\"captured\"' WHERE Key = 'User.DisplayName';";
            await command.ExecuteNonQueryAsync();
        }
        Assert.True(File.Exists(profile.DatabasePath + "-wal"));

        var archive = Path.Combine(profile.Parent, "wal.mnemo-backup");
        await profile.Service().CreateAsync(archive, "0.8.0-beta");
        var extracted = Path.Combine(profile.Parent, "wal-extracted");
        ZipFile.ExtractToDirectory(archive, extracted);

        Assert.False(File.Exists(Path.Combine(extracted, "profile.db-wal")));
        Assert.False(File.Exists(Path.Combine(extracted, "profile.db-shm")));
        await using var database = new SqliteConnection(
            $"Data Source={Path.Combine(extracted, "profile.db")};Mode=ReadOnly;Pooling=False");
        await database.OpenAsync();
        Assert.Equal("\"captured\"", await StoredValueAsync(database, "User.DisplayName"));
        Assert.Equal("delete", await ScalarAsync(database, "PRAGMA journal_mode"));
    }

    [Fact]
    public async Task WriteAsync_BoundsTheManifestByTheEntryLimitNotAFixedSize()
    {
        using var profile = await TestProfile.CreateAsync();
        var assets = Path.Combine(profile.Parent, "assets");
        var images = Path.Combine(assets, "images");
        Directory.CreateDirectory(images);
        const int fileCount = 6_000;
        for (var index = 0; index < fileCount; index++)
            await File.WriteAllBytesAsync(Path.Combine(images, $"{Guid.NewGuid():N}.png"), [1]);
        var limits = new ProfileBackupArchive.ReadLimits(10_000, 16 * 1024 * 1024, 64 * 1024 * 1024, 3);
        var manifest = new Mnemo.Core.Models.ProfileBackupManifest
        {
            FormatVersion = ProfileBackupArchive.FormatVersion,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            CreatedByAppVersion = "0.8.0-beta",
            CollectionId = "collection",
        };
        var archive = Path.Combine(profile.Parent, "crowded.mnemo-backup");

        await ProfileBackupWriter.WriteAsync(
            archive, profile.DatabasePath, assets, manifest, limits, CancellationToken.None);

        using (var zip = ZipFile.OpenRead(archive))
            Assert.True(zip.GetEntry("manifest.json")!.Length > 1024 * 1024);
        var read = await ProfileBackupArchive.ValidateAsync(archive, "0.8.0-beta", limits);
        Assert.Equal(fileCount + 1, read.Entries.Count);
        Assert.Equal(fileCount, read.Contents.ManagedFiles);
    }

    [Fact]
    public async Task InspectAsync_RefusesAManifestLargerThanTheEntryLimitCanDescribe()
    {
        using var profile = await TestProfile.CreateAsync();
        var archive = Path.Combine(profile.Parent, "padded.mnemo-backup");
        var service = profile.Service();
        await service.CreateAsync(archive, "0.8.0-beta");
        await PadManifestAsync(archive, TestProfile.Limits.MaxManifestBytes + 1);

        var refused = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(archive, "0.8.0-beta"));

        Assert.Equal("backup_manifest_invalid", refused.Code);
    }

    [Fact]
    public async Task InspectAsync_IdentifiesABackupFromAnotherCollection()
    {
        using var source = await TestProfile.CreateAsync("source");
        await source.SetStorageAsync("Collection.Id", "\"other-collection\"");
        var archive = Path.Combine(source.Parent, "other.mnemo-backup");
        await source.Service().CreateAsync(archive, "0.8.0-beta");
        using var target = await TestProfile.CreateAsync("target");

        var inspection = await target.Service().InspectAsync(archive, "0.8.0-beta");

        Assert.False(inspection.FromThisCollection);
    }

    [Fact]
    public async Task CancelStagedRestoreAsync_RemovesThePendingRequestAndArchive()
    {
        using var profile = await TestProfile.CreateAsync();
        var archive = Path.Combine(profile.Parent, "profile.mnemo-backup");
        var service = profile.Service();
        await service.CreateAsync(archive, "0.8.0-beta");
        var staged = await service.StageRestoreAsync(archive, "0.8.0-beta");

        Assert.True(service.IsRestoreStaged(staged.OperationId));
        Assert.True(await service.CancelStagedRestoreAsync(staged.OperationId));
        Assert.False(service.IsRestoreStaged(staged.OperationId));
        Assert.False(await service.CancelStagedRestoreAsync(staged.OperationId));
    }

    [Theory]
    [InlineData("../profile.db", "backup_path_unsafe")]
    [InlineData("/profile.db", "backup_path_unsafe")]
    [InlineData("assets\\images\\a.png", "backup_path_unsafe")]
    [InlineData("assets/images/a/b.png", "backup_path_unsafe")]
    [InlineData("assets/images/CON.png", "backup_path_unsafe")]
    [InlineData("assets/images/a.png.", "backup_path_unsafe")]
    [InlineData("other/file.bin", "backup_unknown_file")]
    [InlineData("rogue.txt", "backup_unknown_file")]
    public async Task InspectAsync_RejectsUnsafePaths(string path, string code)
    {
        using var profile = await TestProfile.CreateAsync();
        var archive = Path.Combine(profile.Parent, Guid.NewGuid().ToString("N") + ".mnemo-backup");
        await using (var file = File.Create(archive))
        using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
        {
            var entry = zip.CreateEntry(path);
            await using var stream = entry.Open();
            await stream.WriteAsync(new byte[] { 1 });
        }

        var error = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            profile.Service().InspectAsync(archive, "0.8.0-beta"));
        Assert.Equal(code, error.Code);
    }

    [Fact]
    public async Task InspectAsync_RejectsDuplicateUnknownAndMissingEntries()
    {
        using var profile = await TestProfile.CreateAsync();
        await profile.WriteAssetAsync("images", "card.png", "card image");
        var service = profile.Service();

        var duplicateArchive = Path.Combine(profile.Parent, "duplicate.mnemo-backup");
        await service.CreateAsync(duplicateArchive, "0.8.0-beta");
        using (var zip = ZipFile.Open(duplicateArchive, ZipArchiveMode.Update))
            zip.CreateEntry("profile.db");
        var duplicate = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(duplicateArchive, "0.8.0-beta"));
        Assert.Equal("backup_duplicate_path", duplicate.Code);

        var unknownArchive = Path.Combine(profile.Parent, "unknown.mnemo-backup");
        await service.CreateAsync(unknownArchive, "0.8.0-beta");
        using (var zip = ZipFile.Open(unknownArchive, ZipArchiveMode.Update))
            zip.CreateEntry("assets/images/unlisted.png");
        var unknown = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(unknownArchive, "0.8.0-beta"));
        Assert.Equal("backup_unknown_file", unknown.Code);

        var missingArchive = Path.Combine(profile.Parent, "missing.mnemo-backup");
        await service.CreateAsync(missingArchive, "0.8.0-beta");
        using (var zip = ZipFile.Open(missingArchive, ZipArchiveMode.Update))
            zip.GetEntry("assets/images/card.png")!.Delete();
        var missing = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(missingArchive, "0.8.0-beta"));
        Assert.Equal("backup_file_missing", missing.Code);
    }

    [Fact]
    public async Task InspectAsync_RejectsNormalizedDuplicatesAndLinks()
    {
        using var profile = await TestProfile.CreateAsync();
        var service = profile.Service();
        var normalizedArchive = Path.Combine(profile.Parent, "normalized-duplicate.mnemo-backup");
        await using (var file = File.Create(normalizedArchive))
        using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
        {
            zip.CreateEntry("assets/images/café.png");
            zip.CreateEntry("assets/images/café.png");
        }
        var duplicate = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(normalizedArchive, "0.8.0-beta"));
        Assert.Equal("backup_duplicate_path", duplicate.Code);

        var linkArchive = Path.Combine(profile.Parent, "link.mnemo-backup");
        await using (var file = File.Create(linkArchive))
        using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
        {
            var link = zip.CreateEntry("profile.db");
            link.ExternalAttributes = 0xA000 << 16;
        }
        var rejectedLink = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(linkArchive, "0.8.0-beta"));
        Assert.Equal("backup_link_rejected", rejectedLink.Code);
    }

    [Fact]
    public async Task InspectAsync_RejectsMalformedAndUnsupportedManifests()
    {
        using var profile = await TestProfile.CreateAsync();
        var service = profile.Service();

        var malformedArchive = Path.Combine(profile.Parent, "malformed.mnemo-backup");
        await using (var file = File.Create(malformedArchive))
        using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
        {
            var manifest = zip.CreateEntry("manifest.json");
            await using var stream = manifest.Open();
            await stream.WriteAsync("{"u8.ToArray());
        }
        var malformed = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(malformedArchive, "0.8.0-beta"));
        Assert.Equal("backup_manifest_invalid", malformed.Code);

        var unsupportedArchive = Path.Combine(profile.Parent, "unsupported.mnemo-backup");
        await service.CreateAsync(unsupportedArchive, "0.8.0-beta");
        await RewriteManifestAsync(unsupportedArchive, manifest => manifest.FormatVersion = 0);
        var unsupported = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(unsupportedArchive, "0.8.0-beta"));
        Assert.Equal("backup_version_unsupported", unsupported.Code);

        var dishonestArchive = Path.Combine(profile.Parent, "dishonest.mnemo-backup");
        await service.CreateAsync(dishonestArchive, "0.8.0-beta");
        await RewriteManifestAsync(dishonestArchive, manifest => manifest.Contents.Notes++);
        var dishonest = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(dishonestArchive, "0.8.0-beta"));
        Assert.Equal("backup_manifest_invalid", dishonest.Code);
    }

    [Fact]
    public async Task InspectAsync_RejectsNewerFormatAndConfiguredSizeLimits()
    {
        using var profile = await TestProfile.CreateAsync();
        var service = profile.Service();
        var newerArchive = Path.Combine(profile.Parent, "newer.mnemo-backup");
        await service.CreateAsync(newerArchive, "0.8.0-beta");
        await RewriteManifestAsync(newerArchive, manifest => manifest.FormatVersion = 2);
        var newer = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(newerArchive, "0.8.0-beta"));
        Assert.Equal("backup_version_newer", newer.Code);

        var largeArchive = Path.Combine(profile.Parent, "large.mnemo-backup");
        await using (var file = File.Create(largeArchive))
        using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
        {
            var entry = zip.CreateEntry("profile.db", CompressionLevel.NoCompression);
            await using var stream = entry.Open();
            await stream.WriteAsync(new byte[16 * 1024 * 1024 + 1]);
        }
        var large = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(largeArchive, "0.8.0-beta"));
        Assert.Equal("backup_too_large", large.Code);

        var crowdedArchive = Path.Combine(profile.Parent, "crowded.mnemo-backup");
        await using (var file = File.Create(crowdedArchive))
        using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
        {
            for (var index = 0; index <= 100; index++)
                zip.CreateEntry($"assets/images/{index}.png");
        }
        var crowded = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(crowdedArchive, "0.8.0-beta"));
        Assert.Equal("backup_too_many_files", crowded.Code);
    }

    [Fact]
    public async Task InspectAsync_RejectsChecksumFailureAndNewerAppVersion()
    {
        using var profile = await TestProfile.CreateAsync();
        var archive = Path.Combine(profile.Parent, "profile.mnemo-backup");
        var service = profile.Service();
        await service.CreateAsync(archive, "0.9.0");

        var newer = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(archive, "0.8.0-beta"));
        Assert.Equal("backup_app_newer", newer.Code);

        await RewriteManifestAsync(archive, manifest =>
        {
            manifest.CreatedByAppVersion = "0.8.0-beta";
            manifest.Entries.Single(entry => entry.Path == "profile.db").Sha256 = new string('0', 64);
        });
        var checksum = await Assert.ThrowsAsync<ProfileBackupException>(() =>
            service.InspectAsync(archive, "0.8.0-beta"));
        Assert.Equal("backup_checksum_failed", checksum.Code);
    }

    [Fact]
    public async Task ApplyPendingAsync_ReplacesProfileAndKeepsRecoveryCopy()
    {
        using var source = await TestProfile.CreateAsync("source");
        await source.SetStorageAsync("User.DisplayName", "\"Source\"");
        await source.WriteAssetAsync("note-assets", "note.png", "source asset");
        await source.WriteAssetAsync("images", "card.png", "source card asset");
        await source.WriteAssetAsync("mindmap-assets", "map.png", "source map asset");
        await source.WriteAssetAsync("chat-attachments", "paper.pdf", "source chat attachment");
        await source.WriteAssetAsync("avatar", "me.png", "source avatar");
        var archive = Path.Combine(source.Parent, "source.mnemo-backup");
        await source.Service().CreateAsync(archive, "0.8.0-beta");

        using var target = await TestProfile.CreateAsync("target");
        await target.SetStorageAsync("User.DisplayName", "\"Target\"");
        await target.WriteAssetAsync("note-assets", "note.png", "target asset");
        await target.WriteAssetAsync("images", "old.png", "target card asset");
        var originalDatabase = await File.ReadAllBytesAsync(target.DatabasePath);
        await target.Service().StageRestoreAsync(archive, "0.8.0-beta");
        await File.WriteAllBytesAsync(target.DatabasePath + "-wal", [5, 4, 3]);
        await File.WriteAllBytesAsync(target.DatabasePath + "-shm", [2, 1]);

        await ProfileRestoreStartup.ApplyPendingAsync(target.Root, "0.8.0-beta");

        Assert.Equal("\"Source\"", await target.StoredValueAsync("User.DisplayName"));
        Assert.Equal("source asset", await File.ReadAllTextAsync(Path.Combine(target.Root, "note-assets", "note.png")));
        Assert.Equal("source card asset", await File.ReadAllTextAsync(Path.Combine(target.Root, "images", "card.png")));
        Assert.Equal("source map asset", await File.ReadAllTextAsync(Path.Combine(target.Root, "mindmap-assets", "map.png")));
        Assert.Equal("source chat attachment", await File.ReadAllTextAsync(Path.Combine(target.Root, "chat-attachments", "paper.pdf")));
        Assert.Equal("source avatar", await File.ReadAllTextAsync(Path.Combine(target.Root, "avatar", "me.png")));
        Assert.False(File.Exists(Path.Combine(target.Root, "images", "old.png")));
        await using (var restored = new SqliteConnection($"Data Source={target.DatabasePath};Mode=ReadOnly;Pooling=False"))
        {
            await restored.OpenAsync();
            Assert.Equal("fact-1", await ScalarAsync(restored, "SELECT FactId FROM FlashcardCards WHERE Id = 'card-1'"));
            Assert.Equal(6L, await ScalarAsync(restored, "SELECT Reps FROM FlashcardScheduling WHERE CardId = 'card-1'"));
            Assert.Equal(3L, await ScalarAsync(restored, "SELECT Grade FROM FlashcardReviews WHERE Id = 41"));
            Assert.Equal(87.5, await ScalarAsync(restored, "SELECT ScorePct FROM FlashcardTestAttempts WHERE Id = 'attempt-1'"));
            Assert.Equal("2030-02-01T00:00:00Z", await ScalarAsync(restored, "SELECT ExpiresAt FROM TrashEntries WHERE Id = 'trash-1'"));
            Assert.Equal("{\"widgets\":[\"recent-notes\"]}", await StoredValueAsync(restored, "overview_layout_v2"));
            Assert.Null(await StoredValueAsync(restored, "AI.OpenRouter.ApiKey"));
        }
        var status = ProfileRestoreStartup.ReadStatus(target.Root);
        Assert.NotNull(status);
        Assert.True(status.Success);
        var recovery = Path.Combine(target.Root, ProfileRestoreStartup.RecoveryDirectoryName, status.RecoveryDirectoryName!);
        Assert.Equal(originalDatabase, await File.ReadAllBytesAsync(Path.Combine(recovery, "mnemo.db")));
        Assert.Equal([5, 4, 3], await File.ReadAllBytesAsync(Path.Combine(recovery, "mnemo.db-wal")));
        Assert.Equal([2, 1], await File.ReadAllBytesAsync(Path.Combine(recovery, "mnemo.db-shm")));
        Assert.Equal("target asset", await File.ReadAllTextAsync(Path.Combine(recovery, "note-assets", "note.png")));
        Assert.False(File.Exists(target.DatabasePath + "-wal"));
        Assert.False(File.Exists(target.DatabasePath + "-shm"));
    }

    [Fact]
    public async Task ApplyPendingAsync_InvalidArchiveLeavesOriginalProfileByteForByteUsable()
    {
        using var source = await TestProfile.CreateAsync("source");
        var archive = Path.Combine(source.Parent, "source.mnemo-backup");
        await source.Service().CreateAsync(archive, "0.8.0-beta");

        using var target = await TestProfile.CreateAsync("target");
        await target.WriteAssetAsync("avatar", "me.png", "original avatar");
        var originalDatabase = await File.ReadAllBytesAsync(target.DatabasePath);
        var staged = await target.Service().StageRestoreAsync(archive, "0.8.0-beta");
        var stagedArchive = Path.Combine(
            target.Root, ProfileBackupService.RestoreStagingDirectoryName, staged.OperationId + ".mnemo-backup");
        await File.WriteAllBytesAsync(stagedArchive, [1, 2, 3, 4]);

        await ProfileRestoreStartup.ApplyPendingAsync(target.Root, "0.8.0-beta");

        Assert.Equal(originalDatabase, await File.ReadAllBytesAsync(target.DatabasePath));
        Assert.Equal("original avatar", await File.ReadAllTextAsync(Path.Combine(target.Root, "avatar", "me.png")));
        Assert.False(ProfileRestoreStartup.ReadStatus(target.Root)!.Success);
        await using var database = new SqliteConnection($"Data Source={target.DatabasePath};Mode=ReadOnly;Pooling=False");
        await database.OpenAsync();
        Assert.Equal("\"Ada\"", await StoredValueAsync(database, "User.DisplayName"));
    }

    [Fact]
    public async Task ApplyPendingAsync_RollsBackAnInterruptedInstallBeforeOpeningTheProfile()
    {
        using var target = await TestProfile.CreateAsync("target");
        await target.WriteAssetAsync("avatar", "me.png", "original avatar");
        var originalDatabase = await File.ReadAllBytesAsync(target.DatabasePath);
        var operationId = Guid.NewGuid().ToString("N");
        var archiveName = operationId + ".mnemo-backup";
        var recoveryName = "20260911-120000-" + operationId;
        var staging = Path.Combine(target.Root, ProfileBackupService.RestoreStagingDirectoryName);
        var recovery = Path.Combine(target.Root, ProfileRestoreStartup.RecoveryDirectoryName, recoveryName);
        Directory.CreateDirectory(staging);
        Directory.CreateDirectory(recovery);
        File.Move(target.DatabasePath, Path.Combine(recovery, "mnemo.db"));
        Directory.Move(Path.Combine(target.Root, "avatar"), Path.Combine(recovery, "avatar"));
        await File.WriteAllTextAsync(target.DatabasePath, "partial replacement");
        await File.WriteAllTextAsync(Path.Combine(staging, archiveName), "staged archive");
        await File.WriteAllTextAsync(
            Path.Combine(staging, "operation.json"),
            JsonSerializer.Serialize(
                new
                {
                    operationId,
                    archiveFileName = archiveName,
                    recoveryDirectoryName = recoveryName,
                    existingTargets = new[] { "mnemo.db", "avatar" },
                    phase = 1,
                },
                ProfileBackupArchive.SerializerOptions));

        await ProfileRestoreStartup.ApplyPendingAsync(target.Root, "0.8.0-beta");

        Assert.Equal(originalDatabase, await File.ReadAllBytesAsync(target.DatabasePath));
        Assert.Equal("original avatar", await File.ReadAllTextAsync(Path.Combine(target.Root, "avatar", "me.png")));
        Assert.False(File.Exists(Path.Combine(staging, "operation.json")));
        Assert.False(File.Exists(Path.Combine(staging, archiveName)));
        Assert.False(ProfileRestoreStartup.ReadStatus(target.Root)!.Success);
    }

    [Fact]
    public async Task ApplyPendingAsync_QuarantinesAnUnsafeJournalWithoutTouchingTheProfile()
    {
        using var target = await TestProfile.CreateAsync("target");
        var originalDatabase = await File.ReadAllBytesAsync(target.DatabasePath);
        var operationId = Guid.NewGuid().ToString("N");
        var staging = Path.Combine(target.Root, ProfileBackupService.RestoreStagingDirectoryName);
        Directory.CreateDirectory(staging);
        await File.WriteAllTextAsync(Path.Combine(staging, operationId + ".mnemo-backup"), "staged archive");
        await File.WriteAllTextAsync(
            Path.Combine(staging, ProfileBackupService.RestoreJournalFileName),
            JsonSerializer.Serialize(
                new
                {
                    operationId,
                    archiveFileName = operationId + ".mnemo-backup",
                    recoveryDirectoryName = "..",
                    existingTargets = new[] { "mnemo.db" },
                    phase = 1,
                },
                ProfileBackupArchive.SerializerOptions));

        var status = await ProfileRestoreStartup.ApplyPendingAsync(target.Root, "0.8.0-beta");

        Assert.NotNull(status);
        Assert.Equal("restore_journal_invalid", status.Code);
        Assert.Equal(originalDatabase, await File.ReadAllBytesAsync(target.DatabasePath));
        Assert.Single(Directory.EnumerateFiles(staging, "operation.invalid-*.json"));
        Assert.Empty(Directory.EnumerateFiles(staging, "*.mnemo-backup"));
    }

    [Fact]
    public async Task ApplyPendingAsync_CompletesJournalCleanupAfterTheInstallWasCommitted()
    {
        using var target = await TestProfile.CreateAsync("target");
        var operationId = Guid.NewGuid().ToString("N");
        var archiveName = operationId + ".mnemo-backup";
        var recoveryName = "20260911-120000-" + operationId;
        var staging = Path.Combine(target.Root, ProfileBackupService.RestoreStagingDirectoryName);
        var recovery = Path.Combine(target.Root, ProfileRestoreStartup.RecoveryDirectoryName, recoveryName);
        var oldRecovery = Path.Combine(target.Root, ProfileRestoreStartup.RecoveryDirectoryName, "old");
        Directory.CreateDirectory(staging);
        Directory.CreateDirectory(recovery);
        Directory.CreateDirectory(oldRecovery);
        await File.WriteAllTextAsync(Path.Combine(staging, archiveName), "staged archive");
        await File.WriteAllTextAsync(Path.Combine(staging, ProfileBackupService.PendingRestoreFileName), "pending");
        await File.WriteAllTextAsync(
            Path.Combine(staging, ProfileBackupService.RestoreJournalFileName),
            JsonSerializer.Serialize(
                new
                {
                    operationId,
                    archiveFileName = archiveName,
                    recoveryDirectoryName = recoveryName,
                    existingTargets = new[] { "mnemo.db" },
                    phase = 2,
                    backupCreatedAtUtc = "2026-09-11T12:00:00Z",
                    backupAppVersion = "0.8.0-beta",
                },
                ProfileBackupArchive.SerializerOptions));

        var status = await ProfileRestoreStartup.ApplyPendingAsync(target.Root, "0.8.0-beta");

        Assert.NotNull(status);
        Assert.True(status.Success);
        Assert.Equal("0.8.0-beta", status.BackupAppVersion);
        Assert.True(Directory.Exists(recovery));
        Assert.False(Directory.Exists(oldRecovery));
        Assert.False(File.Exists(Path.Combine(staging, ProfileBackupService.RestoreJournalFileName)));
        Assert.False(File.Exists(Path.Combine(staging, archiveName)));
    }

    [Fact]
    public async Task ApplyPendingAsync_RejectsAnExpiredRequestAndRemovesItsArchive()
    {
        using var source = await TestProfile.CreateAsync("source");
        var archive = Path.Combine(source.Parent, "source.mnemo-backup");
        await source.Service().CreateAsync(archive, "0.8.0-beta");
        using var target = await TestProfile.CreateAsync("target");
        var staged = await target.Service().StageRestoreAsync(archive, "0.8.0-beta");
        var staging = Path.Combine(target.Root, ProfileBackupService.RestoreStagingDirectoryName);
        await File.WriteAllTextAsync(
            Path.Combine(staging, ProfileBackupService.PendingRestoreFileName),
            JsonSerializer.Serialize(
                new ProfileBackupService.PendingRestore(
                    staged.OperationId,
                    staged.OperationId + ".mnemo-backup",
                    DateTimeOffset.UtcNow.AddDays(-2)),
                ProfileBackupArchive.SerializerOptions));

        var status = await ProfileRestoreStartup.ApplyPendingAsync(target.Root, "0.8.0-beta");

        Assert.NotNull(status);
        Assert.Equal("restore_request_invalid", status.Code);
        Assert.Empty(Directory.EnumerateFiles(staging, "*.mnemo-backup"));
    }

    [Fact]
    public async Task ApplyPendingAsync_NamesTheRecoveryDirectoryWhenRollbackCannotProceed()
    {
        using var target = await TestProfile.CreateAsync("target");
        var operationId = Guid.NewGuid().ToString("N");
        var archiveName = operationId + ".mnemo-backup";
        var recoveryName = "20260911-120000-" + operationId;
        var staging = Path.Combine(target.Root, ProfileBackupService.RestoreStagingDirectoryName);
        var recovery = Path.Combine(target.Root, ProfileRestoreStartup.RecoveryDirectoryName, recoveryName);
        Directory.CreateDirectory(staging);
        Directory.CreateDirectory(recovery);
        File.Delete(target.DatabasePath);
        await File.WriteAllTextAsync(
            Path.Combine(staging, ProfileBackupService.RestoreJournalFileName),
            JsonSerializer.Serialize(
                new
                {
                    operationId,
                    archiveFileName = archiveName,
                    recoveryDirectoryName = recoveryName,
                    existingTargets = new[] { "mnemo.db" },
                    phase = 1,
                },
                ProfileBackupArchive.SerializerOptions));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            ProfileRestoreStartup.ApplyPendingAsync(target.Root, "0.8.0-beta"));

        Assert.Contains(recovery, error.Message);
        Assert.True(File.Exists(Path.Combine(staging, ProfileBackupService.RestoreJournalFileName)));
    }

    private static async Task RewriteManifestAsync(string archivePath, Action<Mnemo.Core.Models.ProfileBackupManifest> change)
    {
        using var archive = ZipFile.Open(archivePath, ZipArchiveMode.Update);
        var entry = archive.GetEntry("manifest.json")!;
        Mnemo.Core.Models.ProfileBackupManifest manifest;
        await using (var stream = entry.Open())
            manifest = (await JsonSerializer.DeserializeAsync<Mnemo.Core.Models.ProfileBackupManifest>(stream,
                ProfileBackupArchive.SerializerOptions))!;
        entry.Delete();
        change(manifest);
        var replacement = archive.CreateEntry("manifest.json");
        await using var output = replacement.Open();
        await JsonSerializer.SerializeAsync(output, manifest, ProfileBackupArchive.SerializerOptions);
    }

    private static async Task PadManifestAsync(string archivePath, long totalBytes)
    {
        using var archive = ZipFile.Open(archivePath, ZipArchiveMode.Update);
        var entry = archive.GetEntry("manifest.json")!;
        byte[] manifest;
        await using (var stream = entry.Open())
        using (var buffer = new MemoryStream())
        {
            await stream.CopyToAsync(buffer);
            manifest = buffer.ToArray();
        }
        entry.Delete();
        var replacement = archive.CreateEntry("manifest.json");
        await using var output = replacement.Open();
        await output.WriteAsync(manifest);
        await output.WriteAsync(Encoding.ASCII.GetBytes(new string(' ', (int)(totalBytes - manifest.Length))));
    }

    private static async Task<string?> StoredValueAsync(SqliteConnection database, string key)
    {
        await using var command = database.CreateCommand();
        command.CommandText = "SELECT Value FROM Storage WHERE Key = $key";
        command.Parameters.AddWithValue("$key", key);
        return await command.ExecuteScalarAsync() as string;
    }

    private static async Task<object?> ScalarAsync(SqliteConnection database, string sql)
    {
        await using var command = database.CreateCommand();
        command.CommandText = sql;
        return await command.ExecuteScalarAsync();
    }

    private sealed class TestProfile : IDisposable
    {
        private TestProfile(string parent, string root)
        {
            Parent = parent;
            Root = root;
            DatabasePath = Path.Combine(root, "mnemo.db");
        }

        public string Parent { get; }
        public string Root { get; }
        public string DatabasePath { get; }

        public static async Task<TestProfile> CreateAsync(string name = "profile")
        {
            var parent = Path.Combine(Path.GetTempPath(), "mnemo-backup-tests", Guid.NewGuid().ToString("N"));
            var root = Path.Combine(parent, name);
            Directory.CreateDirectory(root);
            var profile = new TestProfile(parent, root);
            await using var database = new SqliteConnection($"Data Source={profile.DatabasePath};Pooling=False");
            await database.OpenAsync();
            await using var schema = database.CreateCommand();
            schema.CommandText =
                """
                CREATE TABLE Storage (Key TEXT PRIMARY KEY, Value TEXT);
                CREATE TABLE FlashcardFolders (Id TEXT PRIMARY KEY, ParentId TEXT, Name TEXT, TrashId TEXT);
                CREATE TABLE FlashcardPresets (Id TEXT PRIMARY KEY, Name TEXT, NewPerDay INTEGER);
                CREATE TABLE FlashcardDecks (Id TEXT PRIMARY KEY, FolderId TEXT, PresetId TEXT, Name TEXT, TrashId TEXT);
                CREATE TABLE FlashcardCardTypes (Id TEXT PRIMARY KEY, Name TEXT, FieldsJson TEXT);
                CREATE TABLE FlashcardFacts (Id TEXT PRIMARY KEY, DeckId TEXT, TypeId TEXT, ValuesJson TEXT, TrashId TEXT);
                CREATE TABLE FlashcardCards (Id TEXT PRIMARY KEY, DeckId TEXT, FactId TEXT, Front TEXT, Back TEXT, AttachmentsJson TEXT, TrashId TEXT);
                CREATE TABLE FlashcardScheduling (CardId TEXT PRIMARY KEY, DueDate TEXT, Reps INTEGER, Lapses INTEGER);
                CREATE TABLE FlashcardReviews (Id INTEGER PRIMARY KEY, CardId TEXT, DeckId TEXT, Grade INTEGER, ReviewedAt TEXT);
                CREATE TABLE FlashcardTestAttempts (Id TEXT PRIMARY KEY, DeckId TEXT, ScorePct REAL);
                CREATE TABLE FlashcardDailyStats (DeckId TEXT, Date TEXT, ReviewsDone INTEGER, PRIMARY KEY (DeckId, Date));
                CREATE TABLE FlashcardTrashFactHomes (TrashId TEXT, FactId TEXT, OriginalDeckId TEXT, ReplacementDeckId TEXT);
                CREATE TABLE MindmapFolders (Id TEXT PRIMARY KEY, ParentId TEXT, Name TEXT, TrashId TEXT);
                CREATE TABLE Mindmaps (Id TEXT PRIMARY KEY, Title TEXT, Doc TEXT, FolderId TEXT, LinkedDecksJson TEXT, TrashId TEXT);
                CREATE TABLE MindmapStyleTemplates (Id TEXT PRIMARY KEY, Name TEXT, Json TEXT);
                CREATE TABLE TrashEntries (
                    Id TEXT PRIMARY KEY, Kind TEXT, ItemId TEXT, Title TEXT, Origin TEXT,
                    ContainedCount INTEGER, BatchId TEXT, State TEXT, DeletedAt TEXT, ExpiresAt TEXT);
                CREATE TABLE AssetCleanupJobs (Id TEXT PRIMARY KEY);
                INSERT INTO Storage VALUES ('Collection.Id', '"collection"');
                INSERT INTO Storage VALUES ('User.DisplayName', '"Ada"');
                INSERT INTO Storage VALUES ('Appearance.Theme', '"Dawn"');
                INSERT INTO Storage VALUES ('Proofing.Languages', '["en","nb"]');
                INSERT INTO Storage VALUES ('Proofing.NoteLanguages', '{"n1":{"mode":"custom","languages":["nb"]}}');
                INSERT INTO Storage VALUES ('Proofing.NoteIgnores', '{"n1":["Mnemo"]}');
                INSERT INTO Storage VALUES ('Proofing.PersonalWords', '[{"word":"Mnemo","language":"en"}]');
                INSERT INTO Storage VALUES ('overview_layout_v2', '{"widgets":["recent-notes"]}');
                INSERT INTO Storage VALUES ('Updates.AutoCheck', 'true');
                INSERT INTO Storage VALUES ('Updates.LastCheckedUtc', '"2026-09-11T12:00:00Z"');
                INSERT INTO Storage VALUES ('AI.OpenRouter.ApiKey', '"top-secret"');
                INSERT INTO Storage VALUES ('App.LaunchAtStartup', 'true');
                INSERT INTO Storage VALUES ('App.BetaNoticeSeenVersion', '"0.8.0-beta"');
                INSERT INTO Storage VALUES ('unknown.future.setting', '"private"');
                INSERT INTO Storage VALUES ('notes_index', '["n1"]');
                INSERT INTO Storage VALUES ('note_folders_index', '["nf1"]');
                INSERT INTO Storage VALUES ('note_n1', '{"id":"n1","folderId":"nf1","title":"Anatomy","blocks":[{"type":"image","path":"note.png"}]}');
                INSERT INTO Storage VALUES ('note_folder_nf1', '{"id":"nf1","name":"Medicine"}');
                INSERT INTO Storage VALUES ('notes_trash', '{"n-deleted":{"deletedAt":"2026-01-01T00:00:00Z"}}');
                INSERT INTO Storage VALUES ('chat_module_history', '{"conversations":[{"id":"c1"}]}');
                INSERT INTO FlashcardFolders VALUES ('folder-1', NULL, 'Biology', NULL);
                INSERT INTO FlashcardPresets VALUES ('preset-1', 'Daily', 20);
                INSERT INTO FlashcardDecks VALUES ('deck-1', 'folder-1', 'preset-1', 'Cells', NULL);
                INSERT INTO FlashcardDecks VALUES ('deck-old', 'folder-1', 'preset-1', 'Archived cells', 'trash-1');
                INSERT INTO FlashcardCardTypes VALUES ('type-1', 'Basic', '["front","back"]');
                INSERT INTO FlashcardFacts VALUES ('fact-1', 'deck-1', 'type-1', '{"front":"Mitochondria"}', NULL);
                INSERT INTO FlashcardCards VALUES ('card-1', 'deck-1', 'fact-1', 'Powerhouse?', 'Mitochondria', '[{"assetId":"card.png"}]', NULL);
                INSERT INTO FlashcardScheduling VALUES ('card-1', '2026-09-12T08:00:00Z', 6, 1);
                INSERT INTO FlashcardReviews VALUES (41, 'card-1', 'deck-1', 3, '2026-09-10T08:00:00Z');
                INSERT INTO FlashcardTestAttempts VALUES ('attempt-1', 'deck-1', 87.5);
                INSERT INTO FlashcardDailyStats VALUES ('deck-1', '2026-09-10', 12);
                INSERT INTO FlashcardTrashFactHomes VALUES ('trash-1', 'fact-1', 'deck-old', 'deck-1');
                INSERT INTO MindmapFolders VALUES ('map-folder-1', NULL, 'Diagrams', NULL);
                INSERT INTO Mindmaps VALUES ('map-1', 'Cell map', '{"elements":[{"id":"image-1","assetId":"map.png"}]}', 'map-folder-1', '["deck-1"]', NULL);
                INSERT INTO MindmapStyleTemplates VALUES ('style-1', 'Blue', '{"node":"accent"}');
                INSERT INTO TrashEntries VALUES (
                    'trash-1', 'flashcard-deck', 'deck-old', 'Old deck', 'Biology', 3,
                    'batch-1', 'held', '2026-01-01T00:00:00Z', '2030-02-01T00:00:00Z');
                INSERT INTO AssetCleanupJobs VALUES ('j1');
                """;
            await schema.ExecuteNonQueryAsync();
            return profile;
        }

        public static readonly ProfileBackupArchive.ReadLimits Limits =
            new(100, 16 * 1024 * 1024, 64 * 1024 * 1024, 3);

        public ProfileBackupService Service(Action<ProfileBackupService.BackupCheckpoint>? checkpoint = null) =>
            new(Root, Limits, checkpoint: checkpoint);

        public async Task SetStorageAsync(string key, string value)
        {
            await using var database = new SqliteConnection($"Data Source={DatabasePath};Pooling=False");
            await database.OpenAsync();
            await using var command = database.CreateCommand();
            command.CommandText = "INSERT OR REPLACE INTO Storage (Key, Value) VALUES ($key, $value)";
            command.Parameters.AddWithValue("$key", key);
            command.Parameters.AddWithValue("$value", value);
            await command.ExecuteNonQueryAsync();
        }

        public async Task<string?> StoredValueAsync(string key)
        {
            await using var database = new SqliteConnection($"Data Source={DatabasePath};Mode=ReadOnly;Pooling=False");
            await database.OpenAsync();
            return await ProfileBackupServiceTests.StoredValueAsync(database, key);
        }

        public async Task WriteAssetAsync(string directory, string name, string contents)
        {
            var path = Path.Combine(Root, directory, name);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await File.WriteAllTextAsync(path, contents, Encoding.UTF8);
        }

        public async Task WriteRootFileAsync(string relativePath, string contents)
        {
            var path = Path.Combine(Root, relativePath.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await File.WriteAllTextAsync(path, contents, Encoding.UTF8);
        }

        public void Dispose()
        {
            try { if (Directory.Exists(Parent)) Directory.Delete(Parent, recursive: true); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}
