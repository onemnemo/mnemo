using System.Windows.Input;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Markup.Xaml;

namespace Mnemo.UI.Controls;

public partial class SegmentedToggle : UserControl
{
    public static readonly StyledProperty<string> LeftTextProperty =
        AvaloniaProperty.Register<SegmentedToggle, string>(nameof(LeftText), "Left");

    public static readonly StyledProperty<string> RightTextProperty =
        AvaloniaProperty.Register<SegmentedToggle, string>(nameof(RightText), "Right");

    public static readonly StyledProperty<string> LeftIconPathProperty =
        AvaloniaProperty.Register<SegmentedToggle, string>(nameof(LeftIconPath), string.Empty);

    public static readonly StyledProperty<string> RightIconPathProperty =
        AvaloniaProperty.Register<SegmentedToggle, string>(nameof(RightIconPath), string.Empty);

    public static readonly StyledProperty<bool> IsLeftSelectedProperty =
        AvaloniaProperty.Register<SegmentedToggle, bool>(nameof(IsLeftSelected), true);

    public static readonly StyledProperty<ICommand?> LeftCommandProperty =
        AvaloniaProperty.Register<SegmentedToggle, ICommand?>(nameof(LeftCommand));

    public static readonly StyledProperty<ICommand?> RightCommandProperty =
        AvaloniaProperty.Register<SegmentedToggle, ICommand?>(nameof(RightCommand));

    public static readonly StyledProperty<bool> LeftIsEnabledProperty =
        AvaloniaProperty.Register<SegmentedToggle, bool>(nameof(LeftIsEnabled), true);

    public static readonly StyledProperty<bool> RightIsEnabledProperty =
        AvaloniaProperty.Register<SegmentedToggle, bool>(nameof(RightIsEnabled), true);

    public static readonly DirectProperty<SegmentedToggle, bool> IsRightSelectedProperty =
        AvaloniaProperty.RegisterDirect<SegmentedToggle, bool>(
            nameof(IsRightSelected),
            o => o.IsRightSelected);

    private bool _isRightSelected = true;

    public bool IsRightSelected => _isRightSelected;

    static SegmentedToggle()
    {
        IsLeftSelectedProperty.Changed.AddClassHandler<SegmentedToggle>((x, _) => x.UpdateComputedState());
    }

    public SegmentedToggle()
    {
        InitializeComponent();
        UpdateComputedState();
    }

    public string LeftText { get => GetValue(LeftTextProperty); set => SetValue(LeftTextProperty, value); }
    public string RightText { get => GetValue(RightTextProperty); set => SetValue(RightTextProperty, value); }

    public string LeftIconPath { get => GetValue(LeftIconPathProperty); set => SetValue(LeftIconPathProperty, value); }
    public string RightIconPath { get => GetValue(RightIconPathProperty); set => SetValue(RightIconPathProperty, value); }

    public bool IsLeftSelected { get => GetValue(IsLeftSelectedProperty); set => SetValue(IsLeftSelectedProperty, value); }

    public ICommand? LeftCommand { get => GetValue(LeftCommandProperty); set => SetValue(LeftCommandProperty, value); }
    public ICommand? RightCommand { get => GetValue(RightCommandProperty); set => SetValue(RightCommandProperty, value); }

    public bool LeftIsEnabled { get => GetValue(LeftIsEnabledProperty); set => SetValue(LeftIsEnabledProperty, value); }
    public bool RightIsEnabled { get => GetValue(RightIsEnabledProperty); set => SetValue(RightIsEnabledProperty, value); }

    private void OnLeftClicked(object? sender, Avalonia.Interactivity.RoutedEventArgs e)
    {
        IsLeftSelected = true;
    }

    private void OnRightClicked(object? sender, Avalonia.Interactivity.RoutedEventArgs e)
    {
        IsLeftSelected = false;
    }

    private void UpdateComputedState()
    {
        SetAndRaise(IsRightSelectedProperty, ref _isRightSelected, !IsLeftSelected);
    }

    private void InitializeComponent() => AvaloniaXamlLoader.Load(this);
}
