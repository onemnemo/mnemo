namespace Mnemo.Core.Models.Proofing;

/// <summary>
/// What happened to an attempt to add a personal word. Every outcome but <see cref="Added"/> leaves
/// the stored list as it was, and each is a different thing to tell the user.
/// </summary>
public enum PersonalWordAddResult
{
    /// <summary>Stored.</summary>
    Added,

    /// <summary>The same word is already stored under the same scope.</summary>
    AlreadyPresent,

    /// <summary>
    /// Not a word the checker can ever ask about: a phrase, something holding a digit, or a run with
    /// fewer than two letters. Storing it would look like it worked and change nothing.
    /// </summary>
    NotCheckable,

    /// <summary>The list is full.</summary>
    LimitReached
}
