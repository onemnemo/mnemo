using System;
using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.UI.Controls;

namespace Mnemo.UI.Modules.Flashcards.Views;

/// <summary>
/// Study split button + cascading flyout: primary segment starts Review immediately, the
/// chevron segment opens a mode picker (Review / Cram ▸ Due·All / Test). One shared component for
/// the deck view header and the library row hover; set <see cref="Compact"/> for the
/// 28px row variant. Counts bind straight from the owning ViewModel's already-loaded header/row
/// counts; this control never fetches anything itself.
/// </summary>
public partial class FlashcardStudySplitButton : UserControl
{
    public static readonly StyledProperty<string?> DeckIdProperty =
        AvaloniaProperty.Register<FlashcardStudySplitButton, string?>(nameof(DeckId));

    /// <summary>New + Learning + Due for the deck (Cram's "Due cards" scope); also decides the 0-due pre-highlight.</summary>
    public static readonly StyledProperty<int> DueCountProperty =
        AvaloniaProperty.Register<FlashcardStudySplitButton, int>(nameof(DueCount));

    /// <summary>Non-suspended cards in the deck (Cram's "All cards" scope).</summary>
    public static readonly StyledProperty<int> AllCountProperty =
        AvaloniaProperty.Register<FlashcardStudySplitButton, int>(nameof(AllCount));

    /// <summary>28px compact rendering for the library row hover affordance.</summary>
    public static readonly StyledProperty<bool> CompactProperty =
        AvaloniaProperty.Register<FlashcardStudySplitButton, bool>(nameof(Compact));

    /// <summary>True when nothing is due; the flyout pre-highlight moves from Review to Cram (spec: "leads with Cram").</summary>
    public static readonly DirectProperty<FlashcardStudySplitButton, bool> IsCaughtUpProperty =
        AvaloniaProperty.RegisterDirect<FlashcardStudySplitButton, bool>(nameof(IsCaughtUp), o => o.IsCaughtUp);

    private bool _isCaughtUp;

    public string? DeckId
    {
        get => GetValue(DeckIdProperty);
        set => SetValue(DeckIdProperty, value);
    }

    public int DueCount
    {
        get => GetValue(DueCountProperty);
        set => SetValue(DueCountProperty, value);
    }

    public int AllCount
    {
        get => GetValue(AllCountProperty);
        set => SetValue(AllCountProperty, value);
    }

    public bool Compact
    {
        get => GetValue(CompactProperty);
        set => SetValue(CompactProperty, value);
    }

    public bool IsCaughtUp
    {
        get => _isCaughtUp;
        private set => SetAndRaise(IsCaughtUpProperty, ref _isCaughtUp, value);
    }

    static FlashcardStudySplitButton()
    {
        DueCountProperty.Changed.AddClassHandler<FlashcardStudySplitButton>((ctrl, e) =>
            ctrl.IsCaughtUp = (int)(e.NewValue ?? 0) <= 0);
    }

    private IServiceProvider? Services => (Application.Current as App)?.Services;

    public FlashcardStudySplitButton()
    {
        InitializeComponent();
    }

    // --- Primary segment: always starts Review (0-due lands on the session's "all caught up" state) ---

    private void OnPrimaryClick(object? sender, RoutedEventArgs e) => StartReview();

    // --- Flyout open: push live counts + the 0-due pre-highlight into the popup imperatively.
    // Cross-popup bindings into MenuItems don't resolve (established gotcha), so this is the only
    // sync point; it runs each time the flyout opens, reading straight off already-loaded VM counts. ---

    private void OnFlyoutOpening(object? sender, EventArgs e)
    {
        var caughtUp = IsCaughtUp;
        ReviewMenuItem.Classes.Set("default", !caughtUp);
        CramMenuItem.Classes.Set("default", caughtUp);

        CramDueMenuItem.SetValue(MenuItemGestureHint.GestureHintProperty, DueCount.ToString(CultureInfo.CurrentCulture));
        CramAllMenuItem.SetValue(MenuItemGestureHint.GestureHintProperty, AllCount.ToString(CultureInfo.CurrentCulture));
    }

    // --- Flyout items (Click, not Command; cross-popup #root compiled bindings don't resolve here) ---

    private void OnReviewClick(object? sender, RoutedEventArgs e) => StartReview();

    private void OnCramDueClick(object? sender, RoutedEventArgs e) => StartCram(FlashcardSessionScope.Due);

    private void OnCramAllClick(object? sender, RoutedEventArgs e) => StartCram(FlashcardSessionScope.All);

    private void OnTestClick(object? sender, RoutedEventArgs e) => StartTest();

    private void StartReview()
    {
        if (string.IsNullOrWhiteSpace(DeckId) || Services?.GetService<INavigationService>() is not { } nav)
            return;
        nav.NavigateTo("flashcard-session", new FlashcardSessionNavigationParameter(DeckId, FlashcardSessionMode.Review));
    }

    private void StartCram(FlashcardSessionScope scope)
    {
        if (string.IsNullOrWhiteSpace(DeckId) || Services?.GetService<INavigationService>() is not { } nav)
            return;
        nav.NavigateTo("flashcard-session", new FlashcardSessionNavigationParameter(DeckId, FlashcardSessionMode.Cram, scope));
    }

    private void StartTest()
    {
        if (string.IsNullOrWhiteSpace(DeckId) || Services?.GetService<INavigationService>() is not { } nav)
            return;
        nav.NavigateTo("flashcard-test", new FlashcardSessionNavigationParameter(DeckId, FlashcardSessionMode.Test));
    }
}
