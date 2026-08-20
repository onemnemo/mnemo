using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Mnemo.Core.Models;
using Mnemo.UI.Components.BlockEditor.BlockComponents;
using Mnemo.UI.Components.BlockEditor.BlockComponents.Image;
using System;

namespace Mnemo.UI.Components.BlockEditor;

public partial class EditableBlock
{
    private void OnControlLoaded(object? sender, RoutedEventArgs e)
    {
        if (_viewModel != null)
            FindParentBlockEditor()?.RegisterRealizedEditableBlock(_viewModel, this);

        WireUpBlockComponent();
        Dispatcher.UIThread.Post(() => WireUpBlockComponent(), DispatcherPriority.Render);
        Dispatcher.UIThread.Post(() => WireUpBlockComponent(), DispatcherPriority.ApplicationIdle);
    }

    private void WireUpBlockComponent()
    {
        var incoming = BlockContentControl?.Content as BlockComponentBase;

        if (ReferenceEquals(_currentBlockComponent, incoming) && incoming != null)
        {
            if (_viewModel != null && !ReferenceEquals(incoming.DataContext, _viewModel))
                incoming.DataContext = _viewModel;
            ApplyReadOnlyState();
            return;
        }

        _chrome?.ResetGutterMarginCache();

        if (_currentBlockComponent != null)
        {
            _currentBlockComponent.TextBoxGotFocus -= HandleBlockComponentGotFocus;
            _currentBlockComponent.LegacyTextBoxGotFocus -= HandleLegacyTextBoxGotFocus;
            _currentBlockComponent.TextBoxLostFocus -= HandleBlockComponentLostFocus;
            _currentBlockComponent.TextBoxTextChanged -= HandleBlockComponentTextChanged;
            _currentBlockComponent.TextBoxKeyDown -= HandleBlockComponentKeyDown;
            RemoveBackspaceTunnelHandler();
        }

        if (incoming is { } component)
        {
            _currentBlockComponent = component;

            if (_viewModel != null)
            {
                component.DataContext = _viewModel;
                if (component.GetRichTextEditor() is { } rte)
                    rte.Spans = _viewModel.Spans;
            }

            component.TextBoxGotFocus += HandleBlockComponentGotFocus;
            component.LegacyTextBoxGotFocus += HandleLegacyTextBoxGotFocus;
            component.TextBoxLostFocus += HandleBlockComponentLostFocus;
            component.TextBoxTextChanged += HandleBlockComponentTextChanged;
            component.TextBoxKeyDown += HandleBlockComponentKeyDown;

            var editor = component.GetRichTextEditor();
            if (editor != null)
            {
                _currentEditor = editor;
                editor.IsReadOnly = IsReadOnly;
                editor.ExternalLinkNavigationRequested = _toolbar != null ? _toolbar.OnExternalLinkNavigationRequestedAsync : null;
                _backspaceTunnelHandler = OnBackspaceTunnelKeyDown;
                editor.AddHandler(InputElement.KeyDownEvent, _backspaceTunnelHandler, RoutingStrategies.Tunnel);

                editor.PointerReleased += OnTextBoxPointerReleasedForToolbar;
                editor.InlineEquationEdited += OnInlineEquationEdited;
                AttachSelectionChangeHandlers(editor);
            }
            else
            {
                _currentEditor = null;
            }
        }
        else
        {
            _currentBlockComponent = null;
            _currentEditor = null;
        }

        ApplyReadOnlyState();
        _chrome?.UpdateGutterVerticalAlignment();
    }

    internal void SyncReadOnlyChromeFromBlockEditor() => ApplyReadOnlyState();

    private void ApplyReadOnlyState()
    {
        var readOnly = IsReadOnly;
        _chrome?.ApplyReadOnlyState(readOnly);
        if (BlockContainer != null) DragDrop.SetAllowDrop(BlockContainer, !readOnly);
        if (_currentEditor != null) _currentEditor.IsReadOnly = readOnly;
        if (_currentBlockComponent?.GetLegacyTextBox() is TextBox legacyTb) legacyTb.IsReadOnly = readOnly;
        if (_currentBlockComponent is BlockComponents.IBlockEditorReadOnlyChrome readOnlyChrome) readOnlyChrome.ApplyBlockEditorReadOnly(readOnly);
    }

    private void RemoveBackspaceTunnelHandler()
    {
        DetachSelectionChangeHandlers();
        if (_currentEditor != null)
        {
            _currentEditor.ExternalLinkNavigationRequested = null;
            if (_backspaceTunnelHandler != null)
                _currentEditor.RemoveHandler(InputElement.KeyDownEvent, _backspaceTunnelHandler);
            _currentEditor.PointerReleased -= OnTextBoxPointerReleasedForToolbar;
            _currentEditor.InlineEquationEdited -= OnInlineEquationEdited;
            _currentEditor = null;
            _backspaceTunnelHandler = null;
        }
    }

    private void AttachSelectionChangeHandlers(RichTextEditor editor)
    {
        DetachSelectionChangeHandlers();
        _selectionStartSubscription = Avalonia.AvaloniaObjectExtensions
            .GetObservable(editor, RichTextEditor.SelectionStartProperty)
            .Subscribe(new SelectionChangedObserver(OnEditorSelectionChanged));
        _selectionEndSubscription = Avalonia.AvaloniaObjectExtensions
            .GetObservable(editor, RichTextEditor.SelectionEndProperty)
            .Subscribe(new SelectionChangedObserver(OnEditorSelectionChanged));
    }

    private void DetachSelectionChangeHandlers()
    {
        _selectionStartSubscription?.Dispose();
        _selectionStartSubscription = null;
        _selectionEndSubscription?.Dispose();
        _selectionEndSubscription = null;
    }

    private void OnEditorSelectionChanged() => _toolbar?.OnEditorSelectionChanged();

    private void OnTextBoxPointerReleasedForToolbar(object? sender, PointerReleasedEventArgs e)
    {
        if (_formatHandler?.StickySubSup != null && sender is RichTextEditor editor)
            _formatHandler.ClearStickySubSup(editor);

        // Toolbar checks are suppressed while IsPointerSelecting (includes the _crossBlockArmed
        // flag set on every text press), and releasing the pointer fires no selection-change
        // notification. Without this re-check a mouse drag selection never shows the toolbar.
        // Post so it runs after BlockEditor's release handlers have cleared the armed flags.
        Dispatcher.UIThread.Post(() => _toolbar?.CheckAndToggle(), DispatcherPriority.Input);
    }

    private void OnInlineEquationEdited(int charIndex, string newLatex)
        => _toolbar?.OnInlineEquationEdited(charIndex, newLatex);

    private sealed class SelectionChangedObserver : IObserver<int>
    {
        private readonly Action _onNext;
        internal SelectionChangedObserver(Action onNext) { _onNext = onNext; }
        public void OnCompleted() { }
        public void OnError(Exception error) { }
        public void OnNext(int value) => _onNext();
    }

    private void OnBackspaceTunnelKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key != Key.Back || e.Handled || _viewModel == null || sender is not RichTextEditor textBox)
            return;
        var text = textBox.Text ?? string.Empty;
        var caretIndex = textBox.CaretIndex;
        var selectionLength = Math.Abs(textBox.SelectionEnd - textBox.SelectionStart);

        if (_viewModel.Type == BlockType.Image)
        {
            if (caretIndex != 0 || selectionLength != 0) return;
            if (BlockEditorContentPolicy.IsVisuallyEmpty(text))
            {
                _viewModel.NotifyStructuralChangeStarting();
                _backspaceHandledInTunnel = true;
                e.Handled = true;
                _viewModel.RequestDeleteAndFocusAbove();
            }
            return;
        }

        if (caretIndex != 0 || selectionLength != 0) return;
        // Must match KeyboardHandler.HandlePlainTextBackspace: a block holding only the legacy
        // sentinel is visually empty; treating it as content here routed Backspace to a
        // merge-with-previous (cross-column for split cells) instead of delete/unwrap.
        var isEmpty = BlockEditorContentPolicy.IsVisuallyEmpty(text);

        if (isEmpty)
        {
            _viewModel.NotifyStructuralChangeStarting();
            _backspaceHandledInTunnel = true;
            e.Handled = true;
            HandleBackspaceOnEmptyBlock();
        }
        else if (_viewModel.Type != BlockType.Text)
        {
            _viewModel.NotifyStructuralChangeStarting();
            _backspaceHandledInTunnel = true;
            e.Handled = true;
            HandleConvertToTextPreservingContent();
        }
        else
        {
            _viewModel.NotifyStructuralChangeStarting();
            _viewModel.Content = text;
            _backspaceHandledInTunnel = true;
            e.Handled = true;
            _viewModel.RequestMergeWithPrevious();
        }
    }

    private void HandleBlockComponentGotFocus(object? sender, RichTextEditor editor)
        => TextBox_GotFocus(editor, new RoutedEventArgs());

    private void HandleLegacyTextBoxGotFocus(object? sender, TextBox textBox)
        => TextBox_GotFocus(textBox, new RoutedEventArgs());

    private void HandleBlockComponentLostFocus(object? sender, RoutedEventArgs e)
        => TextBox_LostFocus(sender, e);

    private void HandleBlockComponentTextChanged(object? sender, TextChangedEventArgs e)
    {
        if (sender is not BlockComponentBase component) return;
        if (component.GetRichTextEditor() is RichTextEditor editor)
            TextBox_TextChanged(editor, e);
        else if (component.GetLegacyTextBox() is TextBox tb)
            LegacyTextBox_TextChanged(tb, e);
    }

    private void LegacyTextBox_TextChanged(TextBox tb, TextChangedEventArgs e)
    {
        if (IsReadOnly || _viewModel == null || _stateManager == null) return;
        if (_stateManager.IsUpdatingFromViewModel) return;
        var text = tb.Text ?? string.Empty;
        var previousText = _stateManager.PreviousText;
        if (text == previousText) return;
        _viewModel.PreviousContent = previousText;
        FindParentBlockEditor()?.TrackTypingEdit(_viewModel, previousText);
        _viewModel.Content = text;
        _stateManager.PreviousText = text;
    }

    private void HandleBlockComponentKeyDown(object? sender, KeyEventArgs e)
    {
        if (sender is not BlockComponentBase component || _viewModel == null || _keyboardHandler == null) return;
        if (component.GetRichTextEditor() is RichTextEditor editor)
            TextBox_KeyDown(editor, e);
        else if (component.GetLegacyTextBox() is TextBox tb)
            _keyboardHandler.HandleLegacyTextBoxKeyDown(e, tb, _viewModel);
    }
}
