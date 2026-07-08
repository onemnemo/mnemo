using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;

namespace Mnemo.Infrastructure.Services.Mindmap.Style;

/// <summary>
/// Template registry backed by the shipped built-ins plus the user's saved templates from the store.
/// User templates are loaded into an immutable snapshot that is swapped atomically on refresh, so the
/// per-node cascade can read <see cref="ById"/> lock-free while a save or delete is in flight.
/// </summary>
public sealed class MindmapStyleTemplateProvider : IMindmapStyleTemplateProvider
{
    private readonly IMindmapStore _store;
    private volatile Snapshot _snapshot = Snapshot.Build(Array.Empty<StyleTemplate>());

    public MindmapStyleTemplateProvider(IMindmapStore store) => _store = store;

    public StyleTemplate Default => MindmapBuiltInTemplates.Default;

    public IReadOnlyList<StyleTemplate> BuiltIns => MindmapBuiltInTemplates.All;

    public IReadOnlyList<StyleTemplate> UserTemplates => _snapshot.User;

    public IReadOnlyList<StyleTemplate> All => _snapshot.All;

    public StyleTemplate? ById(string? id) =>
        id is not null && _snapshot.ById.TryGetValue(id, out var template) ? template : null;

    public async Task RefreshAsync(CancellationToken cancellationToken = default) =>
        _snapshot = Snapshot.Build(await _store.GetStyleTemplatesAsync(cancellationToken).ConfigureAwait(false));

    public async Task SaveAsync(StyleTemplate template, CancellationToken cancellationToken = default)
    {
        await _store.SaveStyleTemplateAsync(template, cancellationToken).ConfigureAwait(false);
        await RefreshAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task DeleteAsync(string id, CancellationToken cancellationToken = default)
    {
        // Built-ins live in code, not the store, so a delete of a built-in id is a harmless no-op.
        await _store.DeleteStyleTemplateAsync(id, cancellationToken).ConfigureAwait(false);
        await RefreshAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>An immutable merged view: built-ins first, then user templates, indexed by id.</summary>
    private sealed class Snapshot
    {
        private Snapshot(IReadOnlyList<StyleTemplate> user, IReadOnlyList<StyleTemplate> all, IReadOnlyDictionary<string, StyleTemplate> byId)
        {
            User = user;
            All = all;
            ById = byId;
        }

        public IReadOnlyList<StyleTemplate> User { get; }

        public IReadOnlyList<StyleTemplate> All { get; }

        public IReadOnlyDictionary<string, StyleTemplate> ById { get; }

        public static Snapshot Build(IReadOnlyList<StyleTemplate> user)
        {
            var all = new List<StyleTemplate>(MindmapBuiltInTemplates.All);
            all.AddRange(user);

            var byId = new Dictionary<string, StyleTemplate>(all.Count);
            foreach (var template in all)
                byId[template.Id] = template; // a user id colliding with a built-in overrides it; ids are distinct by convention

            return new Snapshot(user, all, byId);
        }
    }
}
