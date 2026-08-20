using System;
using System.Collections.ObjectModel;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Markup.Xaml;

namespace Mnemo.UI.Controls;

/// <summary>
/// Small reusable tag-entry control: chips + an inner text box. Tags are exchanged with the
/// hosting view model as a comma-separated <see cref="TagsText"/> string so the existing
/// string-based VM bindings (e.g. <c>EditorTags</c>) remain stable. The control itself owns the
/// split/trim/commit logic so callers do not need per-consumer keyboard handlers.
/// </summary>
public partial class TagChipInput : UserControl
{
    public static readonly StyledProperty<string> TagsTextProperty =
        AvaloniaProperty.Register<TagChipInput, string>(nameof(TagsText), defaultBindingMode: Avalonia.Data.BindingMode.TwoWay);

    public static readonly StyledProperty<string> PlaceholderProperty =
        AvaloniaProperty.Register<TagChipInput, string>(nameof(Placeholder), string.Empty);

    /// <summary>
    /// Optional suggestion source. The flyout opens only when both the entry has text AND there are
    /// matching suggestions, so decks with no existing tags (or a fresh deck) never see an empty popup.
    /// </summary>
    public static readonly StyledProperty<System.Collections.IEnumerable?> SuggestionsProperty =
        AvaloniaProperty.Register<TagChipInput, System.Collections.IEnumerable?>(nameof(Suggestions));

    public string TagsText
    {
        get => GetValue(TagsTextProperty);
        set => SetValue(TagsTextProperty, value);
    }

    public string Placeholder
    {
        get => GetValue(PlaceholderProperty);
        set => SetValue(PlaceholderProperty, value);
    }

    public System.Collections.IEnumerable? Suggestions
    {
        get => GetValue(SuggestionsProperty);
        set => SetValue(SuggestionsProperty, value);
    }

    private readonly ObservableCollection<string> _tags = new();
    private bool _isUpdatingFromProperty;

    public TagChipInput()
    {
        InitializeComponent();
        var list = this.FindControl<ItemsControl>("PART_ChipList");
        if (list != null)
            list.ItemsSource = _tags;
    }

    private void InitializeComponent() => AvaloniaXamlLoader.Load(this);

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == TagsTextProperty)
            SyncTagsFromText((string?)change.NewValue ?? string.Empty);
    }

    private void SyncTagsFromText(string value)
    {
        if (_isUpdatingFromProperty)
            return;

        _isUpdatingFromProperty = true;
        _tags.Clear();
        foreach (var tag in ParseTags(value))
            _tags.Add(tag);
        _isUpdatingFromProperty = false;
    }

    private static string[] ParseTags(string raw) =>
        raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(s => s.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

    private void CommitTagsToProperty()
    {
        _isUpdatingFromProperty = true;
        TagsText = string.Join(", ", _tags);
        _isUpdatingFromProperty = false;
    }

    private void CommitEntryTextIfAny()
    {
        var entry = this.FindControl<TextBox>("PART_Entry");
        if (entry == null)
            return;

        var pending = entry.Text?.Trim();
        if (string.IsNullOrEmpty(pending))
            return;

        AddTag(pending);
        entry.Text = string.Empty;
    }

    private void AddTag(string tag)
    {
        if (_tags.Any(t => string.Equals(t, tag, StringComparison.OrdinalIgnoreCase)))
            return;
        _tags.Add(tag);
        CommitTagsToProperty();
    }

    private void RemoveTag(string tag)
    {
        var existing = _tags.FirstOrDefault(t => string.Equals(t, tag, StringComparison.OrdinalIgnoreCase));
        if (existing == null)
            return;
        _tags.Remove(existing);
        CommitTagsToProperty();
    }

    private void OnRemoveTagClick(object? sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string tag })
            RemoveTag(tag);
    }

    private void OnEntryKeyDown(object? sender, KeyEventArgs e)
    {
        if (sender is not TextBox tb)
            return;

        if (e.Key == Key.Enter)
        {
            CommitEntryTextIfAny();
            e.Handled = true;
            return;
        }

        if (e.Key == Key.OemComma)
        {
            CommitEntryTextIfAny();
            e.Handled = true;
            return;
        }

        if (e.Key == Key.Back && string.IsNullOrEmpty(tb.Text) && _tags.Count > 0)
        {
            var last = _tags[^1];
            _tags.RemoveAt(_tags.Count - 1);
            CommitTagsToProperty();
            e.Handled = true;
        }
    }

    private void OnEntryLostFocus(object? sender, RoutedEventArgs e) => CommitEntryTextIfAny();
}
