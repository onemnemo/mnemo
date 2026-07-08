using System.Collections.Generic;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Core.Services;

/// <summary>
/// One layout algorithm in the open registry. Providers are keyed by <see cref="Id"/> and registered
/// via DI/modules, the same extensibility pattern as content renderers. A provider is a <b>pure function</b>
/// of its snapshot: no document access, no UI access, no shared state, so the service can run it off
/// the UI thread and cancel it freely.
/// </summary>
public interface IMindmapLayoutProvider
{
    /// <summary>Registry key (e.g. <see cref="MindmapLayoutAlgorithms.Balanced"/>).</summary>
    string Id { get; }

    /// <summary>Computes top-left positions for the cluster's visible nodes. Must not mutate the snapshot.</summary>
    IReadOnlyDictionary<string, LayoutPosition> Compute(LayoutSnapshot snapshot);
}
