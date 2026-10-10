using Flagman.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Api.Services;

/// <summary>
/// Монитор сроков: партии переходят «норма → скоро → критично → просрочено» с течением времени,
/// поэтому предупреждения, стоп-лист и автосписание пересчитываются периодически, а не только по действиям.
/// </summary>
public sealed class ExpiryMonitor(IServiceScopeFactory scopes, ILogger<ExpiryMonitor> logger, IConfiguration config) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var period = TimeSpan.FromSeconds(config.GetValue("Monitor:IntervalSeconds", 30));
        using var timer = new PeriodicTimer(period);
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<WarehouseService>().TickAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                logger.LogError(ex, "Ошибка мониторинга сроков");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}

/// <summary>
/// Генератор внешних событий (по ТЗ — эмуляция потока заказов и поставок). Выключен по умолчанию,
/// включается в настройках. Создаёт настоящие заказы и поставки через те же команды, что и интерфейс.
/// </summary>
public sealed class EventGenerator(IServiceScopeFactory scopes, ILogger<EventGenerator> logger) : BackgroundService
{
    private readonly Random _random = new();
    private int _tick;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var delay = TimeSpan.FromSeconds(10);
            try
            {
                using var scope = scopes.CreateScope();
                var warehouse = scope.ServiceProvider.GetRequiredService<WarehouseService>();
                var settings = await warehouse.GetSettingsAsync(stoppingToken);
                delay = TimeSpan.FromSeconds(settings.GeneratorIntervalSeconds);
                if (settings.GeneratorEnabled) await GenerateAsync(scope.ServiceProvider, warehouse, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (DomainException ex)
            {
                logger.LogInformation("Генератор: {Message}", ex.Message);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Ошибка генератора событий");
            }
            await Task.Delay(delay, stoppingToken);
        }
    }

    private async Task GenerateAsync(IServiceProvider sp, WarehouseService warehouse, CancellationToken ct)
    {
        _tick++;
        if (_tick % 6 == 0)
        {
            // Периодически «приходит» поставка по рекомендациям системы.
            var recs = await sp.GetRequiredService<QueryService>().GetSupplyRecommendationsAsync(ct);
            var top = recs.Take(3).ToList();
            if (top.Count > 0)
            {
                await warehouse.CreateSupplyAsync(new CreateSupplyCommand(null, "Генератор событий", "Автоматическая поставка по рекомендациям",
                    top.Select(r => new SupplyLineInput(r.ProductId, r.RecommendedQuantity, null, null, r.DefaultShelfLifeHours ?? 120)).ToList(),
                    ReceiveNow: true), ct);
                return;
            }
        }

        var db = sp.GetRequiredService<FlagmanDbContext>();
        var dishes = await db.Dishes.AsNoTracking().Where(d => d.IsActive).Select(d => d.Id).ToListAsync(ct);
        if (dishes.Count == 0) return;
        var lines = Enumerable.Range(0, _random.Next(1, 4))
            .Select(_ => new OrderLineInput(dishes[_random.Next(dishes.Count)], _random.Next(1, 3)))
            .ToList();
        await warehouse.PlaceOrderAsync(lines, "generator", ct);
    }
}
