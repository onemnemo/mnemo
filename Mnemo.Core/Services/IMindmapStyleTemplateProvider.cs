using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Core.Services;

/// <summary>
/// Supplies style templates by id, used to build the cascade's template chain for a cluster or document,
/// and owns the user's saved templates. The module's built-ins are always available; user templates are
/// loaded from storage on top of them and refreshed after a save or delete.
/// </summary>
public interface IMindmapStyleTemplateProvider
{
    /// <summary>The template used when a document sets no default.</summary>
    StyleTemplate Default { get; }

    /// <summary>The templates shipped with the module.</summary>
    IReadOnlyList<StyleTemplate> BuiltIns { get; }

    /// <summary>The user's saved templates, as of the last refresh.</summary>
    IReadOnlyList<StyleTemplate> UserTemplates { get; }

    /// <summary>All available templates (built-ins first, then user), for gallery/picker UIs.</summary>
    IReadOnlyList<StyleTemplate> All { get; }

    /// <summary>Look up a template by id; null if none matches.</summary>
    StyleTemplate? ById(string? id);

    /// <summary>Reloads the user templates from storage.</summary>
    Task RefreshAsync(CancellationToken cancellationToken = default);

    /// <summary>Saves (creates or updates) a user template, then refreshes.</summary>
    Task SaveAsync(StyleTemplate template, CancellationToken cancellationToken = default);

    /// <summary>Deletes a user template by id, then refreshes. Built-ins cannot be deleted.</summary>
    Task DeleteAsync(string id, CancellationToken cancellationToken = default);
}
