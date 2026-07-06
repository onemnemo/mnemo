using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;

namespace Mnemo.UI.Modules.Flashcards.ViewModels;

public partial class FlashcardFolderItemViewModel : ObservableObject
{
    public FlashcardFolderItemViewModel(string id, string name, string? parentId, int order, int depth)
    {
        Id = id;
        Name = name;
        ParentId = parentId;
        Order = order;
        Depth = depth;
    }

    public string Id { get; }

    [ObservableProperty]
    private string _name;

    public string? ParentId { get; private set; }

    public int Order { get; private set; }

    public int Depth { get; }

    public ObservableCollection<FlashcardFolderItemViewModel> Children { get; } = new();

    [ObservableProperty]
    private bool _isExpanded = true;

    /// <summary>Number of decks nested anywhere beneath this folder.</summary>
    [ObservableProperty]
    private int _deckCount;

    /// <summary>Localized "n decks" label.</summary>
    [ObservableProperty]
    private string _deckCountLabel = string.Empty;

    /// <summary>Aggregated new-card count across all descendant decks.</summary>
    [ObservableProperty]
    private int _newCount;

    /// <summary>Aggregated due learning-card count across all descendant decks.</summary>
    [ObservableProperty]
    private int _learnCount;

    /// <summary>Aggregated due review-card count across all descendant decks.</summary>
    [ObservableProperty]
    private int _reviewDueCount;

    public bool HasNew => NewCount > 0;

    public bool HasLearn => LearnCount > 0;

    public bool HasDue => ReviewDueCount > 0;

    partial void OnNewCountChanged(int value) => OnPropertyChanged(nameof(HasNew));

    partial void OnLearnCountChanged(int value) => OnPropertyChanged(nameof(HasLearn));

    partial void OnReviewDueCountChanged(int value) => OnPropertyChanged(nameof(HasDue));

    public void UpdatePlacement(string? parentId, int order)
    {
        ParentId = parentId;
        Order = order;
    }
}
