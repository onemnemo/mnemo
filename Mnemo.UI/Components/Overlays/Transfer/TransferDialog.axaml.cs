using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using Path = System.IO.Path;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Markup.Xaml;
using Avalonia.Media;
using Avalonia.Platform.Storage;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Controls;

namespace Mnemo.UI.Components.Overlays.Transfer;

/// <summary>
/// Adaptive import/export dialog. Import queues up to <see cref="TransferDialogContext.MaxFiles"/>
/// files with per-file format auto-detection; export offers format radio cards and an optional
/// scope choice. The dialog only collects the user's decision; callers execute the transfer.
/// </summary>
public partial class TransferDialog : UserControl
{
    // Resolved explicitly via FindControl (not bare generated-field access); see TagChipInput/MarkdownView
    // for the same pattern; bare x:Name field access isn't reliable this early in this codebase's setup.
    private readonly AppIcon _directionIcon;
    private readonly SegmentedToggle _modeToggle;
    private readonly TextBlock _titleText;
    private readonly TextBlock _subtitleText;
    private readonly StackPanel _importPanel;
    private readonly Panel _dropzonePanel;
    private readonly Rectangle _dropzoneDash;
    private readonly TextBlock _dropHereText;
    private readonly TextBlock _dropOrText;
    private readonly TextBlock _browseText;
    private readonly ItemsControl _extensionChips;
    private readonly StackPanel _filesPanel;
    private readonly TextBlock _filesLabel;
    private readonly ItemsControl _filesList;
    private readonly Button _addFileButton;
    private readonly Rectangle _addFileDash;
    private readonly TextBlock _addFileLabel;
    private readonly Border _limitNotice;
    private readonly TextBlock _limitNoticeText;
    private readonly TextBlock _rejectNotice;
    private readonly StackPanel _conflictSection;
    private readonly TextBlock _conflictLabel;
    private readonly Button _keepBothButton;
    private readonly Button _skipButton;
    private readonly Button _replaceButton;
    private readonly TextBlock _conflictCaption;
    private readonly StackPanel _exportPanel;
    private readonly TextBlock _formatLabel;
    private readonly UniformGrid _formatCardsPanel;
    private readonly StackPanel _scopeSection;
    private readonly TextBlock _scopeLabel;
    private readonly UniformGrid _scopeSegmentsPanel;
    private readonly TextBlock _fileCountText;
    private readonly TextBlock _summaryText;
    private readonly AppButton _cancelButton;
    private readonly AppButton _confirmButton;
    private readonly TextBlock _confirmLabel;
    private readonly TextBlock _shortcutHint;

    private TransferDialogContext? _context;
    private ILocalizationService? _localization;
    private readonly ObservableCollection<TransferImportFile> _files = new();
    private readonly List<Button> _formatButtons = new();
    private readonly List<Button> _scopeButtons = new();
    private bool _isImportMode = true;
    private ImportConflictPolicy _conflictPolicy = ImportConflictPolicy.KeepBoth;
    private TransferExportFormatOption? _selectedFormat;
    private TransferExportScopeOption? _selectedScope;
    private bool _resultDelivered;

    public Action<TransferDialogResult?>? OnResult { get; set; }

    public TransferDialog()
    {
        InitializeComponent();

        _directionIcon = this.FindControl<AppIcon>("DirectionIcon")!;
        _modeToggle = this.FindControl<SegmentedToggle>("ModeToggle")!;
        _titleText = this.FindControl<TextBlock>("TitleText")!;
        _subtitleText = this.FindControl<TextBlock>("SubtitleText")!;
        _importPanel = this.FindControl<StackPanel>("ImportPanel")!;
        _dropzonePanel = this.FindControl<Panel>("DropzonePanel")!;
        _dropzoneDash = this.FindControl<Rectangle>("DropzoneDash")!;
        _dropHereText = this.FindControl<TextBlock>("DropHereText")!;
        _dropOrText = this.FindControl<TextBlock>("DropOrText")!;
        _browseText = this.FindControl<TextBlock>("BrowseText")!;
        _extensionChips = this.FindControl<ItemsControl>("ExtensionChips")!;
        _filesPanel = this.FindControl<StackPanel>("FilesPanel")!;
        _filesLabel = this.FindControl<TextBlock>("FilesLabel")!;
        _filesList = this.FindControl<ItemsControl>("FilesList")!;
        _addFileButton = this.FindControl<Button>("AddFileButton")!;
        _addFileDash = this.FindControl<Rectangle>("AddFileDash")!;
        _addFileLabel = this.FindControl<TextBlock>("AddFileLabel")!;
        _limitNotice = this.FindControl<Border>("LimitNotice")!;
        _limitNoticeText = this.FindControl<TextBlock>("LimitNoticeText")!;
        _rejectNotice = this.FindControl<TextBlock>("RejectNotice")!;
        _conflictSection = this.FindControl<StackPanel>("ConflictSection")!;
        _conflictLabel = this.FindControl<TextBlock>("ConflictLabel")!;
        _keepBothButton = this.FindControl<Button>("KeepBothButton")!;
        _skipButton = this.FindControl<Button>("SkipButton")!;
        _replaceButton = this.FindControl<Button>("ReplaceButton")!;
        _conflictCaption = this.FindControl<TextBlock>("ConflictCaption")!;
        _exportPanel = this.FindControl<StackPanel>("ExportPanel")!;
        _formatLabel = this.FindControl<TextBlock>("FormatLabel")!;
        _formatCardsPanel = this.FindControl<UniformGrid>("FormatCardsPanel")!;
        _scopeSection = this.FindControl<StackPanel>("ScopeSection")!;
        _scopeLabel = this.FindControl<TextBlock>("ScopeLabel")!;
        _scopeSegmentsPanel = this.FindControl<UniformGrid>("ScopeSegmentsPanel")!;
        _fileCountText = this.FindControl<TextBlock>("FileCountText")!;
        _summaryText = this.FindControl<TextBlock>("SummaryText")!;
        _cancelButton = this.FindControl<AppButton>("CancelButton")!;
        _confirmButton = this.FindControl<AppButton>("ConfirmButton")!;
        _confirmLabel = this.FindControl<TextBlock>("ConfirmLabel")!;
        _shortcutHint = this.FindControl<TextBlock>("ShortcutHint")!;

        DragDrop.SetAllowDrop(this, true);
        AddHandler(DragDrop.DragOverEvent, OnDragOver);
        AddHandler(DragDrop.DragLeaveEvent, OnDragLeave);
        AddHandler(DragDrop.DropEvent, OnDrop);
        Loaded += (_, _) => Focus();
        DetachedFromVisualTree += (_, _) => Deliver(null);
    }

    private void InitializeComponent() => AvaloniaXamlLoader.Load(this);

    /// <summary>
    /// Opens the dialog as a centered overlay and completes with the user's choice, or null when dismissed.
    /// </summary>
    public static async Task<TransferDialogResult?> ShowAsync(IOverlayService overlayService, TransferDialogContext context)
    {
        var dialog = new TransferDialog();
        dialog.Initialize(context);
        var tcs = new TaskCompletionSource<TransferDialogResult?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var overlayId = overlayService.CreateOverlay(dialog, new OverlayOptions
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = true
        }, "TransferDialog");
        dialog.OnResult = result =>
        {
            overlayService.CloseOverlay(overlayId);
            tcs.TrySetResult(result);
        };
        return await tcs.Task.ConfigureAwait(true);
    }

    public void Initialize(TransferDialogContext context)
    {
        _context = context;
        _localization = (Application.Current as App)?.Services?.GetService(typeof(ILocalizationService)) as ILocalizationService;
        _filesList.ItemsSource = _files;

        var isSingleDirection = context.Direction != TransferDialogDirection.Both;
        _directionIcon.IsVisible = isSingleDirection;
        _modeToggle.IsVisible = !isSingleDirection;
        if (!isSingleDirection)
        {
            _modeToggle.LeftText = T("TransferImportTab");
            _modeToggle.RightText = T("TransferExportTab");
            _modeToggle.LeftCommand = new RelayCommand(() => SetMode(import: true));
            _modeToggle.RightCommand = new RelayCommand(() => SetMode(import: false));
        }

        _filesLabel.Text = T("TransferFilesLabel");
        _addFileLabel.Text = T("TransferAddAnotherFile");
        _limitNoticeText.Text = string.Format(T("TransferLimitReachedFormat"), context.MaxFiles);
        _dropHereText.Text = T("TransferDropFileHere");
        _dropOrText.Text = T("TransferDropOr");
        _browseText.Text = T("TransferBrowse");
        _formatLabel.Text = T("TransferFormatLabel");
        _scopeLabel.Text = T("TransferScopeLabel");
        _cancelButton.Content = T("Cancel");
        _shortcutHint.Text = OperatingSystem.IsMacOS() ? "⌘⏎" : "Ctrl ⏎";
        _rejectNotice.IsVisible = false;

        _extensionChips.ItemsSource = context.ImportCapabilities
            .SelectMany(c => c.Extensions)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(e => e, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        _conflictLabel.Text = context.ConflictQuestion;
        _keepBothButton.Content = T("TransferConflictKeepBoth");
        _skipButton.Content = T("TransferConflictSkip");
        _replaceButton.Content = T("TransferConflictReplace");
        UpdateConflictUi();

        BuildFormatCards();
        BuildScopeSegments();

        SetMode(context.Direction switch
        {
            TransferDialogDirection.ImportOnly => true,
            TransferDialogDirection.ExportOnly => false,
            _ => context.StartWithImport
        });
    }

    private string T(string key) => _localization?.T(key, "Common") ?? key;

    // ---------- mode ----------

    private void SetMode(bool import)
    {
        _isImportMode = import;
        _importPanel.IsVisible = import;
        _exportPanel.IsVisible = !import;
        _modeToggle.IsLeftSelected = import;
        _directionIcon.Icon = import ? "Common/download" : "Common/upload";
        _titleText.Text = import ? _context?.ImportTitle : _context?.ExportTitle ?? _context?.ImportTitle;
        var subtitle = import ? _context?.ImportSubtitle : _context?.ExportSubtitle;
        _subtitleText.Text = subtitle;
        _subtitleText.IsVisible = !string.IsNullOrWhiteSpace(subtitle);
        _conflictSection.IsVisible = import && !string.IsNullOrWhiteSpace(_context?.ConflictQuestion);
        _scopeSection.IsVisible = _context?.ExportScopes.Count > 0;
        UpdateImportUi();
        UpdateFooter();
    }

    // ---------- import: file queue ----------

    private void OnDropzonePressed(object? sender, PointerPressedEventArgs e) => _ = BrowseAsync();

    private void OnAddFileClick(object? sender, RoutedEventArgs e) => _ = BrowseAsync();

    private async Task BrowseAsync()
    {
        if (_context == null)
            return;
        var storageProvider = TopLevel.GetTopLevel(this)?.StorageProvider;
        if (storageProvider == null)
            return;

        var patterns = _context.ImportCapabilities
            .SelectMany(c => c.Extensions)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(ext => $"*{ext}")
            .ToArray();
        var files = await storageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            AllowMultiple = _context.MaxFiles - _files.Count > 1,
            Title = _context.ImportTitle,
            FileTypeFilter = [new FilePickerFileType(_context.ImportTitle) { Patterns = patterns }]
        }).ConfigureAwait(true);

        AddFiles(files.Select(f => f.Path.LocalPath));
    }

    private void AddFiles(IEnumerable<string> paths)
    {
        if (_context == null)
            return;

        _rejectNotice.IsVisible = false;
        var supportedExtensions = new HashSet<string>(
            _context.ImportCapabilities.SelectMany(c => c.Extensions),
            StringComparer.OrdinalIgnoreCase);

        foreach (var path in paths)
        {
            if (_files.Count >= _context.MaxFiles)
                break;
            if (_files.Any(f => string.Equals(f.FilePath, path, StringComparison.OrdinalIgnoreCase)))
                continue;

            var fileName = Path.GetFileName(path);
            if (!supportedExtensions.Contains(Path.GetExtension(path)))
            {
                ShowRejectNotice(string.Format(T("TransferUnsupportedFile"), fileName));
                continue;
            }

            long size = 0;
            try
            {
                size = new FileInfo(path).Length;
            }
            catch (IOException)
            {
                // Size is cosmetic; detection below surfaces genuinely unreadable files.
            }

            var file = new TransferImportFile
            {
                FilePath = path,
                FileName = fileName,
                SizeBytes = size,
                DetailLabel = $"{FormatSize(size)} · {T("TransferDetecting")}"
            };
            _files.Add(file);
            _ = DetectFormatAsync(file);
        }

        UpdateImportUi();
        UpdateFooter();
    }

    private async Task DetectFormatAsync(TransferImportFile file)
    {
        if (_context?.Coordinator == null)
            return;

        var preview = await _context.Coordinator.PreviewImportAsync(new ImportExportRequest
        {
            ContentType = _context.ContentType,
            FilePath = file.FilePath
        }).ConfigureAwait(true);

        if (!_files.Contains(file))
            return;

        if (!preview.IsSuccess || preview.Value is not { CanImport: true })
        {
            _files.Remove(file);
            ShowRejectNotice(string.Format(T("TransferUnreadableFile"), file.FileName));
            UpdateImportUi();
            UpdateFooter();
            return;
        }

        file.FormatId = preview.Value.FormatId;
        file.ItemCount = Math.Max(1, preview.Value.DiscoveredCounts.Values.Sum());
        var formatName = ResolveFormatName(preview.Value.FormatId);
        file.DetailLabel = $"{FormatSize(file.SizeBytes)} · {formatName} · {ItemsLabel(file.ItemCount)}";
        UpdateFooter();
    }

    private string ResolveFormatName(string formatId)
    {
        var displayName = _context?.ImportCapabilities
            .FirstOrDefault(c => string.Equals(c.FormatId, formatId, StringComparison.OrdinalIgnoreCase))?
            .DisplayName ?? formatId;
        var parenthesis = displayName.IndexOf(" (", StringComparison.Ordinal);
        return parenthesis > 0 ? displayName[..parenthesis] : displayName;
    }

    private void OnRemoveFileClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control { Tag: TransferImportFile file })
            return;
        _files.Remove(file);
        _rejectNotice.IsVisible = false;
        UpdateImportUi();
        UpdateFooter();
    }

    private void ShowRejectNotice(string message)
    {
        _rejectNotice.Text = message;
        _rejectNotice.IsVisible = true;
    }

    private void UpdateImportUi()
    {
        if (_context == null)
            return;
        var count = _files.Count;
        _dropzonePanel.IsVisible = _isImportMode && count == 0;
        _filesPanel.IsVisible = _isImportMode && count > 0;
        _addFileButton.IsVisible = count < _context.MaxFiles;
        _limitNotice.IsVisible = count >= _context.MaxFiles;
        _fileCountText.Text = string.Format(T("TransferFileCountFormat"), count, _context.MaxFiles);
        var counterBrushKey = count >= _context.MaxFiles ? "ToastAccentWarningBrush" : "TextTertiaryBrush";
        if (this.TryFindResource(counterBrushKey, ActualThemeVariant, out var counterBrush) && counterBrush is IBrush brush)
            _fileCountText.Foreground = brush;
    }

    // ---------- import: drag & drop ----------

    private void OnDragOver(object? sender, DragEventArgs e)
    {
        var accept = _isImportMode && _files.Count < (_context?.MaxFiles ?? 0) && e.DataTransfer.Contains(DataFormat.File);
        e.DragEffects = accept ? DragDropEffects.Copy : DragDropEffects.None;
        _dropzoneDash.Classes.Set("drag-over", accept);
        _addFileDash.Classes.Set("drag-over", accept);
        e.Handled = true;
    }

    private void OnDragLeave(object? sender, DragEventArgs e)
    {
        _dropzoneDash.Classes.Set("drag-over", false);
        _addFileDash.Classes.Set("drag-over", false);
    }

    private async void OnDrop(object? sender, DragEventArgs e)
    {
        _dropzoneDash.Classes.Set("drag-over", false);
        _addFileDash.Classes.Set("drag-over", false);
        if (!_isImportMode || e.DataTransfer is not IAsyncDataTransfer asyncTransfer)
            return;
        if (_files.Count >= (_context?.MaxFiles ?? 0))
        {
            ShowRejectNotice(string.Format(T("TransferLimitReachedFormat"), _context?.MaxFiles ?? 0));
            return;
        }

        e.Handled = true;
        var files = await asyncTransfer.TryGetFilesAsync().ConfigureAwait(true);
        var paths = files?
            .Select(item => item.TryGetLocalPath())
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Cast<string>()
            .ToArray();
        if (paths is { Length: > 0 })
            AddFiles(paths);
    }

    // ---------- import: conflict policy ----------

    private void OnConflictClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string tag } || !Enum.TryParse<ImportConflictPolicy>(tag, out var policy))
            return;
        _conflictPolicy = policy;
        UpdateConflictUi();
    }

    private void UpdateConflictUi()
    {
        _keepBothButton.Classes.Set("selected", _conflictPolicy == ImportConflictPolicy.KeepBoth);
        _skipButton.Classes.Set("selected", _conflictPolicy == ImportConflictPolicy.Skip);
        _replaceButton.Classes.Set("selected", _conflictPolicy == ImportConflictPolicy.Replace);
        _conflictCaption.Text = _conflictPolicy switch
        {
            ImportConflictPolicy.Skip => T("TransferConflictSkipCaption"),
            ImportConflictPolicy.Replace => T("TransferConflictReplaceCaption"),
            _ => T("TransferConflictKeepBothCaption")
        };
    }

    // ---------- export: format cards & scopes ----------

    private void BuildFormatCards()
    {
        if (_context == null)
            return;
        _formatCardsPanel.Children.Clear();
        _formatButtons.Clear();

        for (var i = 0; i < _context.ExportFormats.Count; i++)
        {
            var option = _context.ExportFormats[i];
            var button = new Button
            {
                Classes = { "format-card" },
                Tag = option,
                Margin = new Thickness(0, 0, i < _context.ExportFormats.Count - 1 ? 8 : 0, 0),
                Content = BuildFormatCardContent(option)
            };
            button.Click += OnFormatClick;
            _formatButtons.Add(button);
            _formatCardsPanel.Children.Add(button);
        }

        SelectFormat(_context.ExportFormats.FirstOrDefault());
    }

    private Control BuildFormatCardContent(TransferExportFormatOption option)
    {
        var header = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        var extension = new TextBlock
        {
            Classes = { "mono-hint", "card-ext" },
            Text = option.ExtensionLabel,
            VerticalAlignment = VerticalAlignment.Center
        };
        var check = new Border
        {
            Classes = { "card-check" },
            Width = 16,
            Height = 16,
            CornerRadius = new CornerRadius(8),
            VerticalAlignment = VerticalAlignment.Top,
            Child = new AppIcon
            {
                Icon = "States/done-check",
                Width = 9,
                Height = 9,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            }
        };
        check.Bind(Border.BackgroundProperty, this.GetResourceObservable("AccentBrush"));
        if (check.Child is AppIcon checkIcon)
            checkIcon.Bind(SvgIcon.ColorProperty, this.GetResourceObservable("AccentButtonIconBrush"));
        Grid.SetColumn(check, 1);
        header.Children.Add(extension);
        header.Children.Add(check);

        var name = new TextBlock
        {
            Text = option.DisplayName,
            Margin = new Thickness(0, 6, 0, 0)
        };
        name.Bind(TextBlock.FontSizeProperty, this.GetResourceObservable("FontSize.Body.ExtraSmall"));
        name.Bind(TextBlock.FontFamilyProperty, this.GetResourceObservable("Font.SemiBold"));
        name.Bind(TextBlock.ForegroundProperty, this.GetResourceObservable("TextPrimaryBrush"));

        var panel = new StackPanel();
        panel.Children.Add(header);
        panel.Children.Add(name);
        if (!string.IsNullOrWhiteSpace(option.Caption))
        {
            var caption = new TextBlock
            {
                Text = option.Caption,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 2, 0, 0)
            };
            caption.Bind(TextBlock.FontSizeProperty, this.GetResourceObservable("FontSize.Caption"));
            caption.Bind(TextBlock.ForegroundProperty, this.GetResourceObservable("TextTertiaryBrush"));
            panel.Children.Add(caption);
        }

        return panel;
    }

    private void OnFormatClick(object? sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: TransferExportFormatOption option })
            SelectFormat(option);
    }

    private void SelectFormat(TransferExportFormatOption? option)
    {
        _selectedFormat = option;
        foreach (var button in _formatButtons)
            button.Classes.Set("selected", ReferenceEquals(button.Tag, option));
        UpdateScopeEnablement();
        UpdateFooter();
    }

    private void BuildScopeSegments()
    {
        if (_context == null)
            return;
        _scopeSegmentsPanel.Children.Clear();
        _scopeButtons.Clear();

        foreach (var scope in _context.ExportScopes)
        {
            var content = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                HorizontalAlignment = HorizontalAlignment.Center
            };
            content.Children.Add(new TextBlock { Text = scope.Label, VerticalAlignment = VerticalAlignment.Center });
            if (scope.Count is { } count)
            {
                var countText = new TextBlock
                {
                    Classes = { "mono-hint" },
                    Text = count.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    VerticalAlignment = VerticalAlignment.Center
                };
                content.Children.Add(countText);
            }

            var button = new Button
            {
                Classes = { "segment" },
                Tag = scope,
                Content = content
            };
            button.Click += OnScopeClick;
            _scopeButtons.Add(button);
            _scopeSegmentsPanel.Children.Add(button);
        }

        SelectScope(_context.ExportScopes.FirstOrDefault(s => s.IsEnabled));
    }

    private void OnScopeClick(object? sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: TransferExportScopeOption scope })
            SelectScope(scope);
    }

    private void SelectScope(TransferExportScopeOption? scope)
    {
        _selectedScope = scope;
        foreach (var button in _scopeButtons)
            button.Classes.Set("selected", ReferenceEquals(button.Tag, scope));
        UpdateFooter();
    }

    private void UpdateScopeEnablement()
    {
        foreach (var button in _scopeButtons)
        {
            if (button.Tag is not TransferExportScopeOption scope)
                continue;
            var supported = _selectedFormat?.ScopeIds == null
                || _selectedFormat.ScopeIds.Contains(scope.ScopeId, StringComparer.Ordinal);
            button.IsEnabled = scope.IsEnabled && supported;
        }

        if (_selectedScope != null)
        {
            var current = _scopeButtons.FirstOrDefault(b => ReferenceEquals(b.Tag, _selectedScope));
            if (current is { IsEnabled: false })
                SelectScope(_scopeButtons.FirstOrDefault(b => b.IsEnabled)?.Tag as TransferExportScopeOption);
        }
    }

    // ---------- footer & confirm ----------

    private void UpdateFooter()
    {
        if (_context == null)
            return;

        if (_isImportMode)
        {
            var itemTotal = _files.Sum(f => f.ItemCount);
            var detectionPending = _files.Any(f => f.FormatId == null);
            _confirmButton.IsEnabled = _files.Count > 0 && !detectionPending;
            _confirmLabel.Text = string.Format(T("TransferImportButtonFormat"), ItemsLabel(Math.Max(itemTotal, _files.Count)));
            _summaryText.Text = _files.Count == 0
                ? string.Empty
                : $"{FilesCountLabel(_files.Count)} · {ItemsLabel(itemTotal)}";
        }
        else
        {
            _confirmButton.IsEnabled = _selectedFormat != null;
            _confirmLabel.Text = string.Format(T("TransferExportButtonFormat"), _selectedFormat?.ExtensionLabel ?? string.Empty);
            _summaryText.Text = $"{T("TransferOneFile")} · {T("TransferChooseSaveLocation")}";
        }
    }

    private string ItemsLabel(int count) => count == 1
        ? string.Format(T("TransferOneItemFormat"), _context?.ItemNounSingular)
        : string.Format(T("TransferManyItemsFormat"), count, _context?.ItemNounPlural);

    private string FilesCountLabel(int count) => count == 1
        ? T("TransferOneFile")
        : string.Format(T("TransferManyFilesFormat"), count);

    private static string FormatSize(long bytes) => bytes switch
    {
        < 1024 => $"{bytes} B",
        < 1024 * 1024 => $"{bytes / 1024.0:0} KB",
        _ => $"{bytes / (1024.0 * 1024.0):0.#} MB"
    };

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.Key == Key.Enter && _confirmButton.IsEnabled)
        {
            Confirm();
            e.Handled = true;
            return;
        }

        base.OnKeyDown(e);
    }

    private void OnConfirmClick(object? sender, RoutedEventArgs e) => Confirm();

    private void OnCancelClick(object? sender, RoutedEventArgs e) => Deliver(null);

    private void Confirm()
    {
        if (_context == null)
            return;

        if (_isImportMode)
        {
            if (_files.Count == 0 || _files.Any(f => f.FormatId == null))
                return;
            Deliver(new TransferDialogResult
            {
                IsImport = true,
                Files = _files.ToArray(),
                ConflictPolicy = _conflictPolicy
            });
            return;
        }

        if (_selectedFormat == null)
            return;
        Deliver(new TransferDialogResult
        {
            IsImport = false,
            Format = _selectedFormat,
            Scope = _selectedScope
        });
    }

    private void Deliver(TransferDialogResult? result)
    {
        if (_resultDelivered)
            return;
        _resultDelivered = true;
        OnResult?.Invoke(result);
    }
}
