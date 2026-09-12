using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.ProfileBackup;

internal static class ProfileBackupWriter
{
    public static async Task WriteAsync(
        string archivePath,
        string databasePath,
        string assetsPath,
        ProfileBackupManifest manifest,
        ProfileBackupArchive.ReadLimits limits,
        CancellationToken cancellationToken)
    {
        await using var file = new FileStream(
            archivePath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
        using (var archive = new ZipArchive(file, ZipArchiveMode.Create, leaveOpen: true))
        {
            long totalSize = 0;
            var entryCount = 1;

            totalSize += await AddFileAsync(
                archive, databasePath, ProfileBackupArchive.DatabasePath, manifest, limits, totalSize, cancellationToken)
                .ConfigureAwait(false);
            entryCount++;
            if (Directory.Exists(assetsPath))
            {
                foreach (var path in Directory.EnumerateFiles(assetsPath, "*", SearchOption.AllDirectories)
                             .OrderBy(path => path, StringComparer.Ordinal))
                {
                    if (entryCount >= limits.MaxEntryCount)
                    {
                        throw new ProfileBackupException(
                            "backup_too_many_files",
                            "The profile contains too many managed files to back up safely.");
                    }

                    var relative = Path.GetRelativePath(assetsPath, path).Replace('\\', '/');
                    totalSize += await AddFileAsync(
                        archive, path, "assets/" + relative, manifest, limits, totalSize, cancellationToken)
                        .ConfigureAwait(false);
                    entryCount++;
                    manifest.Contents.ManagedFiles++;
                }
            }

            var manifestBytes = JsonSerializer.SerializeToUtf8Bytes(manifest, ProfileBackupArchive.SerializerOptions);
            if (manifestBytes.Length > 1024 * 1024 || manifestBytes.Length > limits.MaxTotalBytes - totalSize)
                throw new ProfileBackupException("backup_too_large", "The profile is too large to back up safely.");
            var manifestEntry = archive.CreateEntry(ProfileBackupArchive.ManifestPath, CompressionLevel.Optimal);
            await using var manifestStream = manifestEntry.Open();
            await manifestStream.WriteAsync(manifestBytes, cancellationToken).ConfigureAwait(false);
        }

        await file.FlushAsync(cancellationToken).ConfigureAwait(false);
        file.Flush(flushToDisk: true);
    }

    private static async Task<long> AddFileAsync(
        ZipArchive archive,
        string sourcePath,
        string entryPath,
        ProfileBackupManifest manifest,
        ProfileBackupArchive.ReadLimits limits,
        long currentTotal,
        CancellationToken cancellationToken)
    {
        ProfileBackupArchive.ValidatePath(entryPath, limits.MaxPathDepth);
        var declaredSize = new FileInfo(sourcePath).Length;
        if (declaredSize > limits.MaxEntryBytes || declaredSize > limits.MaxTotalBytes - currentTotal)
            throw new ProfileBackupException("backup_too_large", "The profile is too large to back up safely.");

        var entry = archive.CreateEntry(entryPath, CompressionLevel.Optimal);
        await using var destination = entry.Open();
        await using var source = new FileStream(
            sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[81920];
        long size = 0;
        int read;
        while ((read = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false)) > 0)
        {
            size += read;
            hash.AppendData(buffer, 0, read);
            await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
        }

        manifest.Entries.Add(new ProfileBackupEntry
        {
            Path = entryPath,
            Size = size,
            Sha256 = Convert.ToHexStringLower(hash.GetHashAndReset()),
        });
        return size;
    }
}
