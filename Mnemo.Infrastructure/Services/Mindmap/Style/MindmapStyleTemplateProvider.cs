using System.Collections.Generic;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Mindmap.Style;

/// <summary>
/// Template registry backed by the shipped built-ins. User templates loaded from storage will layer
/// on top; today the set is exactly the built-ins.
/// </summary>
public sealed class MindmapStyleTemplateProvider : IMindmapStyleTemplateProvider
{
    public StyleTemplate Default => MindmapBuiltInTemplates.Default;

    public IReadOnlyList<StyleTemplate> All => MindmapBuiltInTemplates.All;

    public StyleTemplate? ById(string? id) => MindmapBuiltInTemplates.ById(id);
}
