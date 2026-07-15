using System;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Markup.Xaml;
using Avalonia.Platform.Storage;
using Mnemo.Core.Models;
using Mnemo.UI.Modules.Chat.ViewModels;
using Mnemo.UI.Services;

namespace Mnemo.UI.Modules.Chat.Views;

/// <summary>
/// The shared Atlas composer card (attachments, input, toolbar, send/stop),
/// used by both the landing state and the active conversation. Expects a
/// <see cref="ChatViewModel"/> DataContext inherited from its host.
/// </summary>
public partial class ChatComposerView : UserControl
{
    public static readonly StyledProperty<string?> PlaceholderProperty =
        AvaloniaProperty.Register<ChatComposerView, string?>(nameof(Placeholder));

    /// <summary>Placeholder shown in the empty input (differs between landing and follow-up composers).</summary>
    public string? Placeholder
    {
        get => GetValue(PlaceholderProperty);
        set => SetValue(PlaceholderProperty, value);
    }

    private TextBox? _inputBox;
    private readonly EventHandler<KeyEventArgs> _inputBoxKeyDownHandler;

    public ChatComposerView()
    {
        InitializeComponent();
        _inputBoxKeyDownHandler = InputBox_KeyDown;
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        _inputBox = this.FindControl<TextBox>("InputBox");
        _inputBox?.AddHandler(InputElement.KeyDownEvent, _inputBoxKeyDownHandler, RoutingStrategies.Tunnel);
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        if (_inputBox != null)
        {
            _inputBox.RemoveHandler(InputElement.KeyDownEvent, _inputBoxKeyDownHandler);
            _inputBox = null;
        }
        base.OnDetachedFromVisualTree(e);
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

    private async void AddAttachment_Click(object? sender, RoutedEventArgs e)
    {
        var topLevel = Application.Current?.ApplicationLifetime is Avalonia.Controls.ApplicationLifetimes.IClassicDesktopStyleApplicationLifetime desktop
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

    private void AddScreenshot_Click(object? sender, RoutedEventArgs e)
    {
        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel == null || DataContext is not ChatViewModel vm) return;

        var path = ScreenshotService.CaptureToTempFile(topLevel);
        if (!string.IsNullOrEmpty(path))
            vm.AddPendingAttachment(path, ChatAttachmentKind.Image, "Screenshot");
    }

    private void InitializeComponent()
    {
        AvaloniaXamlLoader.Load(this);
    }
}
