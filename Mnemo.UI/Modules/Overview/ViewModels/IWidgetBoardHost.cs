using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;

namespace Mnemo.UI.Modules.Overview.ViewModels;

/// <summary>
/// Board-level operations a widget tile can request. Implemented by
/// <see cref="OverviewViewModel"/>; keeps tile ViewModels free of a hard parent reference.
/// </summary>
public interface IWidgetBoardHost
{
    /// <summary>Removes the instance from the board.</summary>
    void RequestRemove(WidgetHostViewModel host);

    /// <summary>Changes the instance's span; the board re-packs.</summary>
    void RequestResize(WidgetHostViewModel host, WidgetSize size);

    /// <summary>Opens the schema-driven config dialog for the instance.</summary>
    Task RequestConfigureAsync(WidgetHostViewModel host);
}
