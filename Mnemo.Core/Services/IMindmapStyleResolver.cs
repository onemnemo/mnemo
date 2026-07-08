using System.Collections.Generic;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Core.Services;

/// <summary>
/// Collapses the style cascade for a single element: element overrides → template root/depth/branch
/// rules → theme defaults. Pure and synchronous. The template chain is ordered most-specific first
/// (cluster template, then document default template).
/// </summary>
public interface IMindmapStyleResolver
{
    /// <summary>
    /// Resolve one element's effective style. <paramref name="templateChain"/> is walked in order; a null
    /// or empty chain resolves to theme defaults. <paramref name="own"/> holds per-element overrides that
    /// always win.
    /// </summary>
    ResolvedStyle Resolve(ElementStyle? own, StyleContext context, IReadOnlyList<StyleTemplate> templateChain);
}
