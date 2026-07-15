using System;
using System.ComponentModel;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Markup.Xaml;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Chat.ViewModels;

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
    private readonly IPerfDiagnostics? _perf;
    private DispatcherTimer? _chatMetricsDebounce;

    public ChatView()
    {
        InitializeComponent();
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
        DataContextChanged += OnDataContextChanged;
        AttachViewModel(DataContext as ChatViewModel);
    }

    protected override void OnDetachedFromVisualTree(Avalonia.VisualTreeAttachmentEventArgs e)
    {
        DataContextChanged -= OnDataContextChanged;
        AttachViewModel(null);
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
