using Flagman.Api.Data;
using Flagman.Api.Domain;
using Flagman.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Flagman.Tests;

public sealed class FixedClock(DateTime utc) : TimeProvider
{
    public DateTime Now { get; set; } = utc;
    public override DateTimeOffset GetUtcNow() => new(Now, TimeSpan.Zero);
}

/// <summary>Настоящий WarehouseService поверх SQLite в памяти с управляемыми часами.</summary>
public sealed class TestHost : IAsyncDisposable
{
    public static readonly DateTime T0 = new(2026, 10, 10, 9, 0, 0, DateTimeKind.Utc);

    private readonly SqliteConnection _connection = new("DataSource=:memory:");
    private readonly ServiceProvider _root;
    public FixedClock Clock { get; } = new(T0);

    public TestHost()
    {
        _connection.Open();
        var services = new ServiceCollection();
        services.AddLogging(b => b.SetMinimumLevel(LogLevel.Warning));
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        services.AddDbContext<FlagmanDbContext>(o => o.UseSqlite(_connection));
        services.AddSingleton<TimeProvider>(Clock);
        services.AddSingleton<WriteGate>();
        services.AddSingleton<EventBus>();
        services.AddScoped<WarehouseService>();
        services.AddScoped<QueryService>();
        _root = services.BuildServiceProvider();
        using var scope = _root.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<FlagmanDbContext>();
        db.Database.EnsureCreated();
        db.Settings.Add(new WarehouseSettings());
        db.SaveChanges();
    }

    public AsyncServiceScope Scope() => _root.CreateAsyncScope();

    public async Task<T> With<T>(Func<WarehouseService, FlagmanDbContext, Task<T>> action)
    {
        await using var scope = Scope();
        return await action(scope.ServiceProvider.GetRequiredService<WarehouseService>(), scope.ServiceProvider.GetRequiredService<FlagmanDbContext>());
    }

    public async Task<T> Query<T>(Func<QueryService, Task<T>> action)
    {
        await using var scope = Scope();
        return await action(scope.ServiceProvider.GetRequiredService<QueryService>());
    }

    public async Task<int> AddProductAsync(string sku, string unit = "kg", decimal min = 0, int? shelf = 72)
    {
        return await With(async (_, db) =>
        {
            var p = new Product { Sku = sku, Name = sku, Category = "Тест", Unit = unit, MinStock = min, DefaultShelfLifeHours = shelf };
            db.Products.Add(p);
            await db.SaveChangesAsync();
            return p.Id;
        });
    }

    public async Task<int> AddDishAsync(string name, params (int ProductId, decimal Qty)[] recipe)
    {
        return await With(async (_, db) =>
        {
            var d = new Dish { Name = name, Ingredients = recipe.Select(r => new DishIngredient { ProductId = r.ProductId, QuantityPerServing = r.Qty }).ToList() };
            db.Dishes.Add(d);
            await db.SaveChangesAsync();
            return d.Id;
        });
    }

    /// <summary>Принимает поставку: каждая пара (продукт, количество, часы до окончания срока) - отдельная партия.</summary>
    public Task<Supply> ReceiveAsync(params (int ProductId, decimal Qty, double ExpiresInHours)[] lines) =>
        With((w, _) => w.CreateSupplyAsync(new CreateSupplyCommand(null, "Тест", null,
            lines.Select(l => new SupplyLineInput(l.ProductId, l.Qty, Clock.Now.AddHours(l.ExpiresInHours), null, null)).ToList(), true), default));

    public Task<WarehouseSnapshot> SnapshotAsync() => With((w, _) => w.LoadSnapshotAsync(Clock.Now, default));

    public Task<List<ProductBatch>> BatchesAsync(int productId) =>
        With((_, db) => db.Batches.AsNoTracking().Where(b => b.ProductId == productId).OrderBy(b => b.Id).ToListAsync());

    public async ValueTask DisposeAsync()
    {
        await _root.DisposeAsync();
        await _connection.DisposeAsync();
    }
}
