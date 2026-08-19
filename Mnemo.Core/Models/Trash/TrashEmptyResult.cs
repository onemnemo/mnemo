using System.Collections.Generic;

namespace Mnemo.Core.Models.Trash;

/// <summary>
/// What emptying the trash achieved.
/// </summary>
/// <param name="PurgedCount">Entries destroyed.</param>
/// <param name="Blocked">
/// Entries left in place because another entry owns rows inside their cascade. Their ledger
/// rows survive, so the page keeps telling the truth about what is still held.
/// </param>
public sealed record TrashEmptyResult(int PurgedCount, IReadOnlyList<TrashPurgeResult> Blocked);
