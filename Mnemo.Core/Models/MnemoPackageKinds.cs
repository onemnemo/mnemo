using System;

namespace Mnemo.Core.Models;

/// <summary>
/// What a <c>.mnemo</c> file is for. A backup is everything a collection holds, taken so it can be
/// restored onto itself; an export is a chosen part of it, taken to hand to somebody else.
/// </summary>
/// <remarks>
/// Tokens rather than an enum member, because the value is written into the manifest of files that
/// outlive this build: a kind a later version introduces reads back as itself here instead of as an
/// out of range number.
/// </remarks>
public static class MnemoPackageKinds
{
    /// <summary>A chosen part of a collection, meant to be handed on.</summary>
    public const string Export = "export";

    /// <summary>Everything a collection holds, meant to be restored onto itself.</summary>
    public const string Backup = "backup";

    /// <summary>
    /// Whether a manifest kind names a backup. A package written before the manifest carried a kind
    /// has none, and reads as an export, which is what every such package actually was.
    /// </summary>
    public static bool IsBackup(string? kind) =>
        string.Equals(kind, Backup, StringComparison.OrdinalIgnoreCase);

    /// <summary>The kind as one of the two known tokens, for a manifest that names neither.</summary>
    public static string Normalize(string? kind) => IsBackup(kind) ? Backup : Export;
}
