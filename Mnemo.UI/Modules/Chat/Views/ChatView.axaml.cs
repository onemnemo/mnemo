using System;
using System.ComponentModel;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Markup.Xaml;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Chat.ViewModels;
using Mnemo.UI.Services;

namespace Mnemo.UI.Modules.Chat.Views;

public partial class ChatView : UserControl
{
    public static readonly StyledProperty<bool> HistoryNavigationEnabledProperty =
        AvaloniaProperty.Register<ChatView, bool>(nameof(HistoryNavigationEnabled));

    public bool HistoryNavigationEnabled
    {
        get => GetValue(HistoryNavigationEnabledProperty);
        private set => SetValue(HistoryNavigationEnabledProperty, value);
    }

    private ScrollViewer? _chatScrollViewer;
    private ItemsRepeater? _chatMessagesRepeater;
    private ChatViewModel? _currentVm;
    private TextBox? _inputBox;
    private TextBox? _landingInputBox;
    private readonly EventHandler<KeyEventArgs> _inputBoxKeyDownHandler;
    private readonly IPerfDiagnostics? _perf;
    private DispatcherTimer? _chatMetricsDebounce;

    public ChatView()
    {
        InitializeComponent();
        _inputBoxKeyDownHandler = InputBox_KeyDown;
        if (Application.Current is App app)
            _perf = app.Services?.GetService(typeof(IPerfDiagnostics)) as IPerfDiagnostics;
    }

    protected override void OnAttachedToVisualTree(Avalonia.VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        _chatScrollViewer = this.FindControl<ScrollViewer>("ChatScrollViewer");
        _chatMessagesRepeater = this.FindControl<ItemsRepeater>("ChatMessagesRepeater");
        if (_chatScrollViewer != null)
            _chatScrollViewer.ScrollChanged += OnScrollChanged;
        _inputBox = this.FindControl<TextBox>("InputBox");
        _inputBox?.AddHandler(InputElement.KeyDownEvent, _inputBoxKeyDownHandler, RoutingStrategies.Tunnel);
        _landingInputBox = this.FindControl<TextBox>("LandingInputBox");
        _landingInputBox?.AddHandler(InputElement.KeyDownEvent, _inputBoxKeyDownHandler, RoutingStrategies.Tunnel);
        DataContextChanged += OnDataContextChanged;
        AttachViewModel(DataContext as ChatViewModel);
    }

    protected override void OnDetachedFromVisualTree(Avalonia.VisualTreeAttachmentEventArgs e)
    {
        DataContextChanged -= OnDataContextChanged;
        AttachViewModel(null);
        if (_inputBox != null)
        {
            _inputBox.RemoveHandler(InputElement.KeyDownEvent, _inputBoxKeyDownHandler);
            _inputBox = null;
        }
        if (_landingInputBox != null)
        {
            _landingInputBox.RemoveHandler(InputElement.KeyDownEvent, _inputBoxKeyDownHandler);
            _landingInputBox = null;
        }
        if (_chatScrollViewer != null)
        {
            _chatScrollViewer.ScrollChanged -= OnScrollChanged;
            _chatScrollViewer = null;
        }
        _chatMessagesRepeater = null;
        _chatMetricsDebounce?.Stop();
        _chatMetricsDebounce = null;
        base.OnDetachedFromVisualTree(e);
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        AttachViewModel(DataContext as ChatViewModel);
    }

    private void AttachViewModel(ChatViewModel? vm)
    {
        if (_currentVm != null)
        {
            _currentVm.PropertyChanged -= OnChatViewModelPropertyChanged;
            _currentVm.RequestScrollToBottom -= OnRequestScrollToBottom;
            _currentVm = null;
        }

        HistoryNavigationEnabled = false;

        if (vm != null)
        {
            _currentVm = vm;
            vm.PropertyChanged += OnChatViewModelPropertyChanged;
            vm.RequestScrollToBottom += OnRequestScrollToBottom;
            OnRequestScrollToBottom(vm, EventArgs.Empty);
            SyncHistoryNavigationEnabled(vm);
        }
    }

    private void OnChatViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (sender is not ChatViewModel vm) return;
        if (e.PropertyName is null || e.PropertyName == nameof(ChatViewModel.CanNavigateChatHistory))
            SyncHistoryNavigationEnabled(vm);
    }

    private void SyncHistoryNavigationEnabled(ChatViewModel vm)
    {
        HistoryNavigationEnabled = vm.CanNavigateChatHistory;
    }

    private void OnRequestScrollToBottom(object? sender, EventArgs e)
    {
        _chatScrollViewer?.ScrollToEnd();
    }

    private void OnScrollChanged(object? sender, ScrollChangedEventArgs e)
    {
        if (_chatScrollViewer == null || DataContext is not ChatViewModel vm) return;
        vm.NotifyScrollPosition(
            _chatScrollViewer.Offset.Y,
            _chatScrollViewer.Extent.Height,
            _chatScrollViewer.Viewport.Height);
        ScheduleChatListMetrics();
    }

    private void ScheduleChatListMetrics()
    {
        if (_perf is not { IsEnabled: true })
            return;

        _chatMetricsDebounce ??= new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
        _chatMetricsDebounce.Tick -= OnChatMetricsDebounceTick;
        _chatMetricsDebounce.Tick += OnChatMetricsDebounceTick;
        _chatMetricsDebounce.Stop();
        _chatMetricsDebounce.Start();
    }

    private void OnChatMetricsDebounceTick(object? sender, EventArgs e)
    {
        _chatMetricsDebounce?.Stop();
        if (_perf is not { IsEnabled: true } || DataContext is not ChatViewModel vm)
            return;

        var total = vm.Messages.Count;
        var realized = 0;
        if (_chatMessagesRepeater != null)
        {
            foreach (var child in _chatMessagesRepeater.GetVisualChildren())
                realized++;
        }
        _perf.RecordMetric("Chat", "messages.total", total, detail: "bound collection count");
        _perf.RecordMetric("Chat", "messages.realized", realized, detail: "ItemsRepeater visual children (approx realized)");
    }

    private void InputBox_KeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        if (sender is not TextBox tb) return;

        if (e.KeyModifiers.HasFlag(KeyModifiers.Control))
        {
            var text = tb.Text ?? string.Empty;
            var caret = Math.Clamp(tb.CaretIndex, 0, text.Length);
            tb.Text = text.Insert(caret, "\n");
            tb.CaretIndex = caret + 1;
            e.Handled = true;
            return;
        }

        if (e.KeyModifiers != KeyModifiers.None) return;

        if (DataContext is not ChatViewModel vm) return;
        if (vm.SendMessageCommand.CanExecute(null))
        {
            vm.SendMessageCommand.Execute(null);
            e.Handled = true;
        }
    }

    private async void AddAttachment_Click(object? sender, Avalonia.Interactivity.RoutedEventArgs e)
    {
        var topLevel = Avalonia.Application.Current?.ApplicationLifetime is Avalonia.Controls.ApplicationLifetimes.IClassicDesktopStyleApplicationLifetime desktop
            ? desktop.MainWindow
            : TopLevel.GetTopLevel(this);
        if (topLevel?.StorageProvider == null || DataContext is not ChatViewModel vm) return;

        var files = await topLevel.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = "Select files",
            AllowMultiple = true
        }).ConfigureAwait(true);

        foreach (var file in files ?? Enumerable.Empty<IStorageFile>())
        {
            var path = file.Path.LocalPath;
            var kind = ChatViewModel.IsImagePath(path) ? ChatAttachmentKind.Image : ChatAttachmentKind.File;
            vm.AddPendingAttachment(path, kind);
        }
    }

    private async void AddImage_Click(object? sender, Avalonia.Interactivity.RoutedEventArgs e)
    {
        var topLevel = Avalonia.Application.Current?.ApplicationLifetime is Avalonia.Controls.ApplicationLifetimes.IClassicDesktopStyleApplicationLifetime desktop
            ? desktop.MainWindow
            : TopLevel.GetTopLevel(this);
        if (topLevel?.StorageProvider == null || DataContext is not ChatViewModel vm) return;

        var files = await topLevel.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = "Select image(s)",
            AllowMultiple = true,
            FileTypeFilter = new[]
            {
                new FilePickerFileType("Images")
                {
                    Patterns = new[] { "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.bmp" }
                }
            }
        }).ConfigureAwait(true);

        foreach (var file in files ?? Enumerable.Empty<IStorageFile>())
        {
            var path = file.Path.LocalPath;
            vm.AddPendingAttachment(path, ChatAttachmentKind.Image);
        }
    }

    private void AddScreenshot_Click(object? sender, Avalonia.Interactivity.RoutedEventArgs e)
    {
        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel == null || DataContext is not ChatViewModel vm) return;

        var path = ScreenshotService.CaptureToTempFile(topLevel);
        if (!string.IsNullOrEmpty(path))
            vm.AddPendingAttachment(path, ChatAttachmentKind.Image, "Screenshot");
    }

    private void ChatHistoryRowSegment_PointerEntered(object? sender, PointerEventArgs e)
    {
        if (sender is Control control && control.DataContext is ChatConversationRowViewModel vm)
            vm.IsRowHovered = true;
    }

    private void ChatHistoryRowSegment_PointerExited(object? sender, PointerEventArgs e)
    {
        if (sender is not Control control || control.DataContext is not ChatConversationRowViewModel vm)
            return;

        var rowHost = FindChatHistoryRowBorder(control);
        if (rowHost == null)
        {
            vm.IsRowHovered = false;
            return;
        }

        var top = TopLevel.GetTopLevel(rowHost);
        if (top == null)
        {
            vm.IsRowHovered = false;
            return;
        }

        // PointerExited + Bounds.Contains is unreliable here (position can still read inside the row).
        // Post to Input so hit-testing sees final pointer target after routing completes.
        var pointerPosInTop = e.GetPosition(top);
        Dispatcher.UIThread.Post(() => ClearChatHistoryRowHoverIfPointerLeft(rowHost, vm, top, pointerPosInTop), DispatcherPriority.Input);
    }

    private static void ClearChatHistoryRowHoverIfPointerLeft(Border rowHost, ChatConversationRowViewModel vm, TopLevel top, Point pointerPosInTop)
    {
        if (top.InputHitTest(pointerPosInTop) is not Visual over)
        {
            vm.IsRowHovered = false;
            return;
        }

        if (!IsVisualUnderChatHistoryRow(over, rowHost))
            vm.IsRowHovered = false;
    }

    private static bool IsVisualUnderChatHistoryRow(Visual pointerOver, Border rowHost) =>
        ReferenceEquals(pointerOver, rowHost) || pointerOver.GetVisualAncestors().Contains(rowHost);

    private static Border? FindChatHistoryRowBorder(Control control) =>
        control.GetVisualAncestors().OfType<Border>().FirstOrDefault(b => b.Classes.Contains("chat-history-row"));

    private void InitializeComponent()
    {
        AvaloniaXamlLoader.Load(this);
    }
}
