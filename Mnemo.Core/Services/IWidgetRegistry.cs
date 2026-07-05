using System.Collections.Generic;

namespace Mnemo.Core.Services;

/// <summary>
/// Registry of available widget types. Built-in modules register descriptors during startup
/// (<see cref="IModule.RegisterWidgets"/>); the extension loader will register through the
/// same seam. The widget library and the board resolve descriptors from here.
/// </summary>
public interface IWidgetRegistry
{
    /// <summary>Registers a widget type. Throws when a descriptor with the same WidgetId already exists.</summary>
    void Register(IWidgetDescriptor descriptor);

    /// <summary>All registered descriptors in registration order.</summary>
    IReadOnlyList<IWidgetDescriptor> AvailableDescriptors { get; }

    /// <summary>Resolves a descriptor by widget id, or null when unknown (e.g. uninstalled extension).</summary>
    IWidgetDescriptor? GetDescriptor(string widgetId);
}
