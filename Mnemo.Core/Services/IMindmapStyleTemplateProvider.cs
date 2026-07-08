using System.Collections.Generic;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Core.Services;

/// <summary>
/// Supplies style templates by id, used to build the cascade's template chain for a cluster or
/// document. The module's built-ins are always available; user templates from storage can layer on
/// top.
/// </summary>
public interface IMindmapStyleTemplateProvider
{
    /// <summary>The template used when a document sets no default.</summary>
    StyleTemplate Default { get; }

    /// <summary>All available templates (built-ins first), for gallery/picker UIs.</summary>
    IReadOnlyList<StyleTemplate> All { get; }

    /// <summary>Look up a template by id; null if none matches.</summary>
    StyleTemplate? ById(string? id);
}
