using System.Collections.Generic;

namespace Mnemo.Core.Services.Proofing;

/// <summary>
/// Picks the engines that serve a language.
/// <para>
/// Plural on purpose. A language is eventually served by more than one engine at once, a spelling
/// engine alongside a grammar engine, and their issues are merged into one answer. Returning a
/// single engine here would make that a change to every caller rather than a new registration.
/// </para>
/// </summary>
public interface IProofingEngineRegistry
{
    /// <summary>Every registered engine, in registration order.</summary>
    IReadOnlyList<IProofingEngine> Engines { get; }

    /// <summary>
    /// The engines that serve <paramref name="language"/>, in registration order. Empty when no
    /// engine claims the language.
    /// </summary>
    IReadOnlyList<IProofingEngine> EnginesFor(string language);

    /// <summary>Every language any registered engine claims, deduplicated and sorted.</summary>
    IReadOnlyList<string> Languages { get; }
}
