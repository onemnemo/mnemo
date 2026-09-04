using System.Threading.Tasks;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

/// <summary>
/// Defines a provider for persistent data storage.
/// </summary>
public interface IStorageProvider
{
    /// <summary>
    /// Saves data to storage asynchronously.
    /// </summary>
    /// <typeparam name="T">The type of data to save.</typeparam>
    /// <param name="key">The unique key identifying the data.</param>
    /// <param name="data">The data to save.</param>
    /// <returns>A result indicating success or failure.</returns>
    Task<Result> SaveAsync<T>(string key, T data);

    /// <summary>
    /// Loads data from storage asynchronously.
    /// </summary>
    /// <typeparam name="T">The type of data to load.</typeparam>
    /// <param name="key">The unique key identifying the data.</param>
    /// <returns>
    /// A result containing the loaded data if successful. A key that is not stored comes back as
    /// a failure carrying no exception; every other failure attaches the exception that caused
    /// it. SettingsService.ExistsAsync tells "nothing is stored" apart from "the store could not
    /// answer" on exactly that distinction, so an implementation must keep it.
    /// </returns>
    Task<Result<T?>> LoadAsync<T>(string key);

    /// <summary>
    /// Deletes data from storage asynchronously.
    /// </summary>
    /// <param name="key">The unique key identifying the data to delete.</param>
    /// <returns>A result indicating success or failure.</returns>
    Task<Result> DeleteAsync(string key);
}

