using System;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Tools;
using Mnemo.Core.Models.Tools.Mindmap;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Tools;

public static class MindmapToolRegistrar
{
    public static void Register(IFunctionRegistry registry, MindmapToolService svc)
    {
        void Reg<T>(string name, string desc, Func<T, Task<ToolInvocationResult>> fn) where T : class =>
            registry.RegisterTool(new AIToolDefinition(name, desc, typeof(T),
                async args => await fn((T)args).ConfigureAwait(false)));

        Reg<SearchMindmapsParameters>("search_mindmaps",
            "Find mindmaps. With query: title search (fuzzy). Without query: lists all (limit 20).",
            svc.SearchMindmapsAsync);

        Reg<OutlineMindmapParameters>("outline_mindmap",
            "Compact nested tree of the mindmap with short node ids, labels, and children. Cheap map before editing. Returns version token.",
            svc.OutlineMindmapAsync);

        Reg<ReadMindmapParameters>("read_mindmap",
            "Read specific nodes: subtree_of (node + descendants), node_ids, or full graph. Returns label, parent, style, layout, and cross-links.",
            svc.ReadMindmapAsync);

        Reg<EditMindmapParameters>("edit_mindmap",
            "Apply a batch of ops atomically. Ops: set_label, add (nested nodes[] under anchor), delete (cascades subtree), move {id, parent}, link {source, target}, unlink, style {id|ids|subtree_of, color, shape, collapsed}. Auto-layout after structural changes.",
            svc.EditMindmapAsync);

        Reg<CreateMindmapParameters>("create_mindmap",
            "Create a mindmap. Provide nested outline[] for a full tree in one call, OR from_note_id to convert a note's headings/bullets. Auto-layout runs after creation.",
            svc.CreateMindmapAsync);

        Reg<ManageMindmapParameters>("manage_mindmap",
            "Rename, change layout_algorithm (TreeVertical/TreeHorizontal/Radial), or delete a mindmap.",
            svc.ManageMindmapAsync);

        Reg<OpenMindmapParameters>("open_mindmap",
            "Open the mindmap in the editor UI.",
            svc.OpenMindmapAsync);
    }
}
