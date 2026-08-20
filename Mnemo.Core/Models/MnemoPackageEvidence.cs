using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models;

/// <summary>
/// What opening a <c>.mnemo</c> file would mean, worked out before anything is written. Answers the
/// four questions somebody about to import needs: what kind of file this is, which collection made
/// it, how much of it is already here, and what a replace would destroy.
/// </summary>
/// <remarks>
/// Ids inform this, they never decide it on their own. A package from another collection is not
/// wrong, and one from this collection is not automatically safe: the counts below are what the
/// person reads, and the choice stays theirs.
/// </remarks>
public sealed class MnemoPackageEvidence
{
    /// <summary>Backup or export, as the manifest declares it. See <see cref="MnemoPackageKinds"/>.</summary>
    public string Kind { get; set; } = MnemoPackageKinds.Export;

    /// <summary>The collection that wrote the package, or null for one written before ids existed.</summary>
    public string? CollectionId { get; set; }

    /// <summary>Whether <see cref="CollectionId"/> is this installation's own collection.</summary>
    public bool FromThisCollection { get; set; }

    /// <summary>When the package was written.</summary>
    public DateTimeOffset? CreatedAtUtc { get; set; }

    /// <summary>The app version that wrote it, when the manifest records one.</summary>
    public string? CreatedByAppVersion { get; set; }

    /// <summary>
    /// Whether every payload examined is in a format this build reads. False means the file was
    /// written by a newer version, and importing it would drop whatever this build cannot see.
    /// </summary>
    public bool CanRead { get; set; } = true;

    /// <summary>One entry per payload area the package carries.</summary>
    public List<MnemoPayloadEvidence> Payloads { get; set; } = new();
}

/// <summary>
/// How one payload area of a package compares against what this collection already holds.
/// </summary>
public sealed class MnemoPayloadEvidence
{
    /// <summary>Which payload area this describes, for example <c>flashcards</c>.</summary>
    public string PayloadType { get; set; } = string.Empty;

    /// <summary>The payload format the package declares.</summary>
    public int PayloadVersion { get; set; }

    /// <summary>The newest payload format this build reads.</summary>
    public int SupportedPayloadVersion { get; set; }

    /// <summary>
    /// Whether this build understands the payload's format. False leaves every count below at
    /// zero, because nothing in a format this build cannot read can honestly be counted.
    /// </summary>
    public bool CanRead { get; set; } = true;

    /// <summary>Top level items the package carries, for flashcards a deck count.</summary>
    public int InPackage { get; set; }

    /// <summary>Items in the package whose id this collection already has.</summary>
    public int AlreadyHere { get; set; }

    /// <summary>Items in the package this collection has never seen.</summary>
    public int NewHere { get; set; }

    /// <summary>Items this collection holds that the package does not carry. A restore leaves these alone.</summary>
    public int MissingFromPackage { get; set; }

    /// <summary>
    /// User visible content a replace would destroy: content sitting inside the items the package
    /// also carries, that the package itself does not contain. For flashcards this is a card count.
    /// </summary>
    public int ReplaceWouldDiscard { get; set; }
}
