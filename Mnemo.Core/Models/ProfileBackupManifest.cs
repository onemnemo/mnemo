using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models;

public sealed class ProfileBackupManifest
{
    public string Format { get; set; } = "mnemo-backup";
    public int FormatVersion { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public string CreatedByAppVersion { get; set; } = string.Empty;
    public string? CollectionId { get; set; }
    public ProfileBackupContentSummary Contents { get; set; } = new();
    public List<ProfileBackupEntry> Entries { get; set; } = [];
}

public sealed class ProfileBackupContentSummary
{
    public int Notes { get; set; }
    public int NoteFolders { get; set; }
    public int FlashcardDecks { get; set; }
    public int FlashcardCards { get; set; }
    public int FlashcardTestAttempts { get; set; }
    public int Mindmaps { get; set; }
    public int MindmapFolders { get; set; }
    public int TrashEntries { get; set; }
    public int Conversations { get; set; }
    public int ManagedFiles { get; set; }
    public int PortableSettings { get; set; }
}

public sealed class ProfileBackupEntry
{
    public string Path { get; set; } = string.Empty;
    public long Size { get; set; }
    public string Sha256 { get; set; } = string.Empty;
}

public sealed record ProfileBackupInspection(
    ProfileBackupManifest Manifest,
    bool FromThisCollection,
    bool CanRestore);

public sealed record ProfileRestoreStage(string OperationId);
