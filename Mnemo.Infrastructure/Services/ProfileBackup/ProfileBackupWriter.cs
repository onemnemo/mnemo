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
                var files = Directory.EnumerateFiles(assetsPath, "*", SearchOption.AllDirectories)
                    .OrderBy(path => path, StringComparer.Ordinal)
                    .ToList();
                var copies = await FindCopiesAsync(assetsPath, files, cancellationToken).ConfigureAwait(false);
                foreach (var path in files)
                {
                    if (entryCount >= limits.MaxEntryCount)
                    {
                        throw new ProfileBackupException(
                            "backup_too_many_files",
                            "The profile contains too many managed files to back up safely.");
                    }

                    var relative = Path.GetRelativePath(assetsPath, path).Replace('\\', '/');
                    totalSize += copies.TryGetValue(path, out var copy)
                        ? AddReference("assets/" + relative, copy, manifest, limits, totalSize)
                        : await AddFileAsync(
                            archive, path, "assets/" + relative, manifest, limits, totalSize, cancellationToken)
                            .ConfigureAwait(false);
                    entryCount++;
                    manifest.Contents.ManagedFiles++;
                }
            }

            // Older builds read only the first format, so it stays in use until a reference needs the second.
            manifest.FormatVersion = manifest.Entries.Any(entry => entry.SameAs is not null)
                ? ProfileBackupArchive.FormatVersion
                : ProfileBackupArchive.LegacyFormatVersion;

            var manifestBytes = JsonSerializer.SerializeToUtf8Bytes(manifest, ProfileBackupArchive.SerializerOptions);
            if (manifestBytes.Length > limits.MaxTotalBytes - totalSize)
                throw new ProfileBackupException("backup_too_large", "The profile is too large to back up safely.");
            var manifestEntry = archive.CreateEntry(ProfileBackupArchive.ManifestPath, CompressionLevel.Optimal);
            await using var manifestStream = manifestEntry.Open();
            await manifestStream.WriteAsync(manifestBytes, cancellationToken).ConfigureAwait(false);
        }

        await file.FlushAsync(cancellationToken).ConfigureAwait(false);
        file.Flush(flushToDisk: true);
    }

    private sealed record Copy(string EntryPath, string Sha256, long Size);

    /// <summary>
    /// The files whose bytes match an earlier file, by source path. Only files of equal size are
    /// hashed, so a profile with no duplicates reads almost nothing twice.
    /// </summary>
    private static async Task<Dictionary<string, Copy>> FindCopiesAsync(
        string assetsPath, List<string> files, CancellationToken cancellationToken)
    {
        var copies = new Dictionary<string, Copy>(StringComparer.Ordinal);
        var firstByHash = new Dictionary<(long Size, string Sha256), string>();
        foreach (var group in files.GroupBy(path => new FileInfo(path).Length).Where(group => group.Key > 0 && group.Count() > 1))
        {
            foreach (var path in group)
            {
                var sha256 = await HashFileAsync(path, cancellationToken).ConfigureAwait(false);
                if (firstByHash.TryGetValue((group.Key, sha256), out var first))
                    copies[path] = new Copy("assets/" + Path.GetRelativePath(assetsPath, first).Replace('\\', '/'), sha256, group.Key);
                else
                    firstByHash[(group.Key, sha256)] = path;
            }
        }

        return copies;
    }

    private static async Task<string> HashFileAsync(string path, CancellationToken cancellationToken)
    {
        await using var source = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
        return Convert.ToHexStringLower(await SHA256.HashDataAsync(source, cancellationToken).ConfigureAwait(false));
    }

    private static long AddReference(
        string entryPath,
        Copy copy,
        ProfileBackupManifest manifest,
        ProfileBackupArchive.ReadLimits limits,
        long currentTotal)
    {
        ProfileBackupArchive.ValidatePath(entryPath, limits.MaxPathDepth);
        var size = copy.Size;
        if (size > limits.MaxTotalBytes - currentTotal)
            throw new ProfileBackupException("backup_too_large", "The profile is too large to back up safely.");

        manifest.Entries.Add(new ProfileBackupEntry { Path = entryPath, Size = size, Sha256 = copy.Sha256, SameAs = copy.EntryPath });
        return size;
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
