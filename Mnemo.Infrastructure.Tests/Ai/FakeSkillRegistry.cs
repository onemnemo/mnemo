using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Ai;

/// <summary>
/// Skill registry double returning fixed manifest tools. When constructed with a
/// <see cref="FakeToolHost"/>, it captures whether that host was already loaded at the moment
/// the tools were read, so tests can assert the gateway loads the host first.
/// </summary>
internal sealed class FakeSkillRegistry : ISkillRegistry
{
    private readonly IReadOnlyList<(string SkillId, SkillToolDefinition Tool)> _tools;
    private readonly FakeToolHost? _host;

    public bool? HostLoadedAtQueryTime { get; private set; }

    public FakeSkillRegistry(params (string SkillId, SkillToolDefinition Tool)[] tools)
        : this(null, tools)
    {
    }

    public FakeSkillRegistry(FakeToolHost? host, params (string SkillId, SkillToolDefinition Tool)[] tools)
    {
        _host = host;
        _tools = tools;
    }

    public Task LoadAsync(CancellationToken ct = default) => Task.CompletedTask;

    public Task ReloadAsync(CancellationToken ct = default) => Task.CompletedTask;

    public void Unload()
    {
    }

    public IReadOnlyList<SkillDefinition> GetEnabledSkills() => Array.Empty<SkillDefinition>();

    public SkillDefinition? TryGet(string id) => null;

    public SkillInjectionContext GetInjection(string? skillId) => new();

    public SkillInjectionContext GetMergedInjection(IReadOnlyList<string>? skillIds) => new();

    public IReadOnlyList<(string SkillId, SkillToolDefinition Tool)> GetAllEnabledManifestTools()
    {
        HostLoadedAtQueryTime = _host?.IsLoaded;
        return _tools;
    }
}
