using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Services.Proofing;

namespace Mnemo.Infrastructure.Modules.Proofing;

/// <summary>
/// Holds every registered engine and answers which of them serve a language.
/// <para>
/// Engines arrive from dependency injection, so a second one is a registration rather than a change
/// here.
/// </para>
/// </summary>
public sealed class ProofingEngineRegistry : IProofingEngineRegistry
{
    private readonly IReadOnlyList<IProofingEngine> _engines;

    public ProofingEngineRegistry(IEnumerable<IProofingEngine> engines)
    {
        _engines = [.. engines];
    }

    public IReadOnlyList<IProofingEngine> Engines => _engines;

    public IReadOnlyList<string> Languages =>
        [.. _engines
            .SelectMany(e => e.Languages)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(l => l, StringComparer.OrdinalIgnoreCase)];

    public IReadOnlyList<IProofingEngine> EnginesFor(string language) =>
        string.IsNullOrWhiteSpace(language)
            ? []
            : [.. _engines.Where(e => e.Languages.Contains(language, StringComparer.OrdinalIgnoreCase))];
}
