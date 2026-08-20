using System.Windows.Input;

namespace Mnemo.UI.Components;

/// <summary>
/// One rendered crumb in the topbar trail: the module label followed by any
/// <see cref="Mnemo.UI.Services.TopbarTrailCrumb"/>s the current page published.
/// Immutable; the topbar rebuilds the whole collection on every change.
/// </summary>
public sealed class TopbarCrumbViewModel
{
    public TopbarCrumbViewModel(string title, bool isLast, ICommand? navigateCommand)
    {
        Title = title;
        IsLast = isLast;
        NavigateCommand = navigateCommand;
    }

    public string Title { get; }

    /// <summary>True for the trailing crumb (the current page); styled as primary text.</summary>
    public bool IsLast { get; }

    public ICommand? NavigateCommand { get; }

    public bool IsNavigable => NavigateCommand is not null;
}
