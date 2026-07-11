using System;
using System.Collections.Generic;

namespace Mnemo.Infrastructure.Tests.Ai;

/// <summary>
/// Synchronous <see cref="IProgress{T}"/> that records reports in order. Unlike
/// <see cref="Progress{T}"/>, it captures on the calling thread so assertions are deterministic.
/// </summary>
internal sealed class CapturingProgress : IProgress<string>
{
    public List<string> Reports { get; } = new();

    public void Report(string value) => Reports.Add(value);
}
