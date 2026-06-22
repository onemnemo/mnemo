using System;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Tools;
using Mnemo.Core.Models.Tools.Notes;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes;

namespace Mnemo.Infrastructure.Services.Tools;

public static class NotesToolRegistrar
{
    public static void Register(IFunctionRegistry registry, NotesToolService svc)
    {
        void Reg<T>(string name, string desc, Func<T, Task<ToolInvocationResult>> fn) where T : class =>
            registry.RegisterTool(new AIToolDefinition(name, desc, typeof(T),
                async args => await fn((T)args).ConfigureAwait(false)));

        Reg<SearchNotesParameters>("search_notes",
            "Find notes. With query: ranked block-level hits (note_id, block_id, heading_path, snippet). Without query: lists notes newest-first. Filters: folder, favorite.",
            svc.SearchNotesAsync);

        Reg<OutlineNoteParameters>("outline_note",
            "Cheap structural map of a note: every block as id, type, depth, length and a short preview. Use this to target edits without reading the whole note. Returns a version token.",
            svc.OutlineNoteAsync);

        Reg<ReadNoteParameters>("read_note",
            "Lossless read of specific parts: by block_ids, by section (a heading and its content), or a from/to block window. Returns markdown plus typed payloads (latex, code, image, page, checked).",
            svc.ReadNoteAsync);

        Reg<EditNoteParameters>("edit_note",
            "Apply a batch of block ops atomically: set_text, replace, insert, delete, move, convert, set_checked. Target blocks by id or short-id prefix. Pass expected_version from outline/read to avoid clobbering.",
            svc.EditNoteAsync);

        Reg<CreateNoteParameters>("create_note",
            "Create a note from markdown or structured blocks. Optional folder and favorite. Prefer edit_note when a note already exists.",
            svc.CreateNoteAsync);

        Reg<ManageNoteParameters>("manage_note",
            "Organize a note: rename, move_to_folder, clear_folder, favorite, or delete.",
            svc.ManageNoteAsync);

        Reg<OpenNoteParameters>("open_note",
            "Open a note in the Notes editor.",
            svc.OpenNoteAsync);
    }
}
