using Mnemo.Core.Services;

namespace Mnemo.Host.HeadlessShell;

/// <summary>
/// The host has no UI thread, so main-thread dispatch is a pass-through:
/// the work runs inline on the caller's thread.
/// </summary>
public sealed class HeadlessMainThreadDispatcher : IMainThreadDispatcher
{
    public Task InvokeAsync(Func<Task> action) => action();
}
