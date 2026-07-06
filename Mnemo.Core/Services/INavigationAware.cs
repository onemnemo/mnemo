namespace Mnemo.Core.Services;

public interface INavigationAware
{
    void OnNavigatedTo(object? parameter);
    void OnNavigatedFrom() { }
}