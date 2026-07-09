using System;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Tools;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Mindmap.Tools;

namespace Mnemo.Infrastructure.Services.Tools;

public static class MindmapToolRegistrar
{
    public static void Register(IFunctionRegistry registry, MindmapToolService svc)
    {
        void Reg<T>(string name, string desc, Func<T, Task<ToolInvocationResult>> fn) where T : class =>
            registry.RegisterTool(new AIToolDefinition(name, desc, typeof(T),
                async args => await fn((T)args).ConfigureAwait(false)));

        Reg<SearchMindmapsParameters>("search_mindmaps",
            "Find mindmaps by title (substring or fuzzy). Without a query, lists maps newest-first. Returns [{id, title, rev, modified}].",
            svc.SearchMindmapsAsync);

        Reg<CreateMindmapParameters>("create_mindmap",
            "Create a whole map from a nested {t, c[]} outline in one call. Optional layout and default template. Returns {id, rev, node_count}.",
            svc.CreateMindmapAsync);

        Reg<OutlineMindmapParameters>("outline_mindmap",
            "Compact tree of a map: nodes as {i, t, c[]}, with +n for descendants hidden by depth or a collapsed node. Scope with subtree_of; cap levels with depth. Returns rev, layout, counts, and free (non-tree) elements. Read this before editing.",
            svc.OutlineMindmapAsync);

        Reg<FindInMapParameters>("find_in_map",
            "Full-text search within one map -> [{i, t, path}] with the hierarchy breadcrumb. The entry point into a large map: jump to the branch you need, then outline/read it. Returns rev.",
            svc.FindInMapAsync);

        Reg<ReadElementsParameters>("read_elements",
            "Full detail for selected elements by ids, subtree_of, or kinds (max 100): content ($type payload), style, position, flags, plus incident edges. Returns rev.",
            svc.ReadElementsAsync);

        Reg<EditMindmapParameters>("edit_mindmap",
            "Apply an atomic op batch with the rev from outline/find/read. Ops: add, set, move, del, link, unlink, set_edge, style_subtree, layout, add_el, frame. All-or-nothing; structural edits auto-layout. Returns {rev, created, deleted}.",
            svc.EditMindmapAsync);
    }
}
