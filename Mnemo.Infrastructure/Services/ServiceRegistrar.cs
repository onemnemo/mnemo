using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services;

/// <summary>
/// The narrow registration surface modules see, over the real service collection. Modules take
/// this rather than <see cref="IServiceCollection"/> so a module cannot reach past registering
/// its own services, and so both composition roots can hand them the same thing.
/// </summary>
public class ServiceRegistrar : IServiceRegistrar
{
    private readonly IServiceCollection _services;

    public ServiceRegistrar(IServiceCollection services)
    {
        _services = services;
    }

    public void AddSingleton<TService>() where TService : class
    {
        _services.AddSingleton<TService>();
    }

    public void AddSingleton<TService, TImplementation>() 
        where TService : class 
        where TImplementation : class, TService
    {
        _services.AddSingleton<TService, TImplementation>();
    }

    public void AddTransient<TService>() where TService : class
    {
        _services.AddTransient<TService>();
    }

    public void AddTransient<TService, TImplementation>() 
        where TService : class 
        where TImplementation : class, TService
    {
        _services.AddTransient<TService, TImplementation>();
    }

    public void AddTransient<TService>(Func<IServiceProvider, TService> factory) where TService : class
    {
        _services.AddTransient<TService>(factory);
    }
}

