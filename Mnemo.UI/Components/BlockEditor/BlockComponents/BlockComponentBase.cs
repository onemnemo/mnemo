using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Mnemo.UI.Components.BlockEditor;
using System;
using System.ComponentModel;
using System.Threading;

namespace Mnemo.UI.Components.BlockEditor.BlockComponents;

/// <summary>
/// Base class for all block components.
/// Subclasses call <see cref="WireRichTextEditor"/> after InitializeComponent().
/// </summary>
public abstract class BlockComponentBase : UserControl
{
    // Realization counters. Diagnostics only; intentionally cheap.
    // MountedCount = currently attached to a visual tree (live RichTextEditor / TextLayout cost).
    // LifetimeMountCount = total attach events since process start (catches "we mount blocks more times than rows realize").
    private static int s_mountedCount;
    private static long s_lifetimeMountCount;
    public static int MountedCount => Volatile.Read(ref s_mountedCount);
    public static long LifetimeMountCount => Interlocked.Read(ref s_lifetimeMountCount);

    private RichTextEditor? _editor;
    private BlockViewModel? _subscribedVm;
    private bool _suppressSync;

    protected BlockViewModel? ViewModel => DataContext as BlockViewModel;

    /// <summary>Returns the primary editable control (a <see cref="RichTextEditor"/>).</summary>
    public abstract Control? GetInputControl();

    /// <summary>Returns the wired <see cref="RichTextEditor"/> for this block, or null.</summary>
    public RichTextEditor? GetRichTextEditor() => _editor;

    /// <summary>Legacy wiring for plain TextBox blocks (e.g. Code). Rich text rendering is not available.</summary>
    protected void WireInputControl(TextBox textBox)
    {
        _legacyTextBox = textBox;
        textBox.GotFocus += (s, e) => LegacyTextBoxGotFocus?.Invoke(this, textBox);
        textBox.LostFocus += (s, e) => TextBoxLostFocus?.Invoke(this, e);
        textBox.TextChanged += (s, e) => TextBoxTextChanged?.Invoke(this, e);
        textBox.KeyDown += (s, e) => TextBoxKeyDown?.Invoke(this, e);
    }

    private TextBox? _legacyTextBox;
    public TextBox? GetLegacyTextBox() => _legacyTextBox;

    /// <summary>Raised by legacy TextBox-based blocks on focus (e.g. CodeBlockComponent).</summary>
    public event EventHandler<TextBox>? LegacyTextBoxGotFocus;

    protected void WireRichTextEditor(RichTextEditor editor)
    {
        _editor = editor;
        editor.GotFocus += OnEditorGotFocus;
        editor.LostFocus += OnEditorLostFocus;
        editor.TextChanged += OnEditorTextChanged;
        editor.KeyDown += OnEditorKeyDown;

        DataContextChanged += OnDataContextChanged;
        Loaded += OnLoadedSync;
        SyncFromViewModel();
    }

    private void OnLoadedSync(object? sender, RoutedEventArgs e)
    {
        SyncFromViewModel();
    }

    // ── ViewModel synchronisation ────────────────────────────────────────────

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_subscribedVm != null)
        {
            _subscribedVm.PropertyChanged -= OnViewModelPropertyChanged;
            _subscribedVm = null;
        }
        if (ViewModel is { } vm)
        {
            vm.PropertyChanged += OnViewModelPropertyChanged;
            _subscribedVm = vm;
        }
        SyncFromViewModel();
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(BlockViewModel.Spans) or nameof(BlockViewModel.Content))
            SyncFromViewModel();
    }

    private void SyncFromViewModel()
    {
        if (_editor == null || ViewModel == null || _suppressSync) return;
        _suppressSync = true;
        _editor.Spans = ViewModel.Spans;
        _suppressSync = false;
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        Interlocked.Increment(ref s_mountedCount);
        Interlocked.Increment(ref s_lifetimeMountCount);
        SyncFromViewModel();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        Interlocked.Decrement(ref s_mountedCount);
        if (_editor != null)
        {
            _editor.GotFocus -= OnEditorGotFocus;
            _editor.LostFocus -= OnEditorLostFocus;
            _editor.TextChanged -= OnEditorTextChanged;
            _editor.KeyDown -= OnEditorKeyDown;
            _editor = null;
        }
        if (_subscribedVm != null)
        {
            _subscribedVm.PropertyChanged -= OnViewModelPropertyChanged;
            _subscribedVm = null;
        }
        Loaded -= OnLoadedSync;
        DataContextChanged -= OnDataContextChanged;
    }

    // ── Events (forwarded to EditableBlock) ──────────────────────────────────

    public event EventHandler<RichTextEditor>? EditorGotFocus;
    public event EventHandler<TextChangedEventArgs>? EditorTextChanged;
    public event EventHandler<KeyEventArgs>? EditorKeyDown;
    public event EventHandler<RoutedEventArgs>? EditorLostFocus;

    // Legacy names so existing EditableBlock wiring still compiles during transition
    public event EventHandler<RichTextEditor>? TextBoxGotFocus;
    public event EventHandler<TextChangedEventArgs>? TextBoxTextChanged;
    public event EventHandler<KeyEventArgs>? TextBoxKeyDown;
    public event EventHandler<RoutedEventArgs>? TextBoxLostFocus;

    private void OnEditorGotFocus(object? sender, FocusChangedEventArgs e)
    {
        if (_editor == null) return;
        // Do NOT call SyncFromViewModel() here. After the user types, CommitSpansFromEditor
        // normalises the spans into a new list reference (N') while the editor still holds the
        // original reference (N), same content, different object. Calling SyncFromViewModel()
        // on focus would assign N' → fire OnSpansChanged() → InvalidateMeasure() → layout jump.
        // Legitimate external span changes are already handled by OnViewModelPropertyChanged,
        // so there is no scenario where a focus-time sync provides a content benefit.
        EditorGotFocus?.Invoke(this, _editor);
        TextBoxGotFocus?.Invoke(this, _editor);
    }

    private void OnEditorLostFocus(object? sender, RoutedEventArgs e)
    {
        EditorLostFocus?.Invoke(this, e);
        TextBoxLostFocus?.Invoke(this, e);
    }

    private void OnEditorTextChanged(object? sender, TextChangedEventArgs e)
    {
        if (_editor == null || ViewModel == null || _suppressSync) return;
        _suppressSync = true;
        // CommitSpansFromEditor returns true when normalization or autolink mutated the runs further;
        // only then must we push VM → editor (otherwise we'd trigger a redundant layout invalidate + equation rebuild + spellcheck reschedule per keystroke).
        var vmMutated = ViewModel.CommitSpansFromEditor(_editor.Spans);
        _suppressSync = false;
        if (vmMutated)
            SyncFromViewModel();

        EditorTextChanged?.Invoke(this, e);
        TextBoxTextChanged?.Invoke(this, e);
    }

    private void OnEditorKeyDown(object? sender, KeyEventArgs e)
    {
        EditorKeyDown?.Invoke(this, e);
        TextBoxKeyDown?.Invoke(this, e);
    }
}
