using Flagman.Api.Domain;
using Flagman.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Tests;

public sealed class WarehouseServiceTests : IAsyncLifetime
{
    private readonly TestHost _host = new();

    public Task InitializeAsync() => Task.CompletedTask;
    public async Task DisposeAsync() => await _host.DisposeAsync();

    private Task<OrderOutcome> Order(params (int DishId, int Servings)[] lines) =>
        _host.With((w, _) => w.PlaceOrderAsync(lines.Select(l => new OrderLineInput(l.DishId, l.Servings)).ToList(), "test", default));

    [Fact]
    public async Task Supply_RegistersSeparateBatchesForSameProduct_WithOwnExpiry()
    {
        var milk = await _host.AddProductAsync("MLK", "l");

        await _host.ReceiveAsync((milk, 2, 20), (milk, 3, 90));

        var batches = await _host.BatchesAsync(milk);
        Assert.Equal(2, batches.Count);
        Assert.Equal([TestHost.T0.AddHours(20), TestHost.T0.AddHours(90)], batches.Select(b => b.ExpiresAt));
        Assert.Equal(5m, (await _host.SnapshotAsync()).Stock[milk].Available);
        var receipts = await _host.With((_, db) => db.Movements.CountAsync(m => m.Type == MovementType.Receipt));
        Assert.Equal(2, receipts);
    }

    [Fact]
    public async Task Supply_RejectsAlreadyExpiredBatch()
    {
        var milk = await _host.AddProductAsync("MLK", "l");

        var ex = await Assert.ThrowsAsync<DomainException>(() => _host.ReceiveAsync((milk, 1, -1)));

        Assert.Equal(400, ex.Status);
        Assert.Empty(await _host.BatchesAsync(milk));
    }

    [Fact]
    public async Task Supply_InterpretsLocalExpiryInRestaurantTimeZone()
    {
        var milk = await _host.AddProductAsync("MLK", "l");

        // 12.10.2026 18:00 по Москве (UTC+3) = 15:00 UTC.
        await _host.With((w, _) => w.CreateSupplyAsync(new CreateSupplyCommand(null, null, null,
            [new SupplyLineInput(milk, 1, null, "2026-10-12T18:00", null)], true), default));

        Assert.Equal(new DateTime(2026, 10, 12, 15, 0, 0, DateTimeKind.Utc), (await _host.BatchesAsync(milk)).Single().ExpiresAt);
    }

    [Fact]
    public async Task Order_ConsumesByFefo_AndLogsEveryBatchMovement()
    {
        var chicken = await _host.AddProductAsync("CHK");
        var dish = await _host.AddDishAsync("Курица", (chicken, 0.5m));
        await _host.ReceiveAsync((chicken, 1, 100), (chicken, 0.7m, 20), (chicken, 2, 60));

        var outcome = await Order((dish, 3)); // нужно 1,5 кг

        Assert.Equal(OrderStatus.Completed, outcome.Order.Status);
        var batches = await _host.BatchesAsync(chicken);
        Assert.Equal(1m, batches[0].QuantityRemaining);                 // самая поздняя - не тронута
        Assert.Equal(0m, batches[1].QuantityRemaining);                 // ранняя - израсходована полностью
        Assert.Equal(BatchState.Depleted, batches[1].State);
        Assert.Equal(1.2m, batches[2].QuantityRemaining);               // остаток 0,8 взят из следующей по сроку
        var moves = await _host.With((_, db) => db.Movements.Where(m => m.OrderId == outcome.Order.Id).ToListAsync());
        Assert.Equal(-1.5m, moves.Sum(m => m.Quantity));
        Assert.Equal(2, moves.Count);
    }

    [Fact]
    public async Task Order_RejectedWithReason_LeavesStockUntouched()
    {
        var pasta = await _host.AddProductAsync("PST");
        var cream = await _host.AddProductAsync("CRM", "l");
        var dish = await _host.AddDishAsync("Карбонара", (pasta, 0.12m), (cream, 0.1m));
        await _host.ReceiveAsync((pasta, 5, 500), (cream, 0.25m, 50), (cream, 1, -0.5 + 1)); // вторая партия истечёт через 30 мин
        _host.Clock.Now = _host.Clock.Now.AddHours(1); // теперь 1 л сливок просрочен

        var outcome = await Order((dish, 3));

        Assert.Equal(OrderStatus.Rejected, outcome.Order.Status);
        var shortage = Assert.Single(outcome.Order.Shortages);
        Assert.Equal(cream, shortage.ProductId);
        Assert.Equal(0.05m, shortage.Missing);
        Assert.Equal(1m, shortage.ExpiredExcluded);
        Assert.Contains("Недостаточно ингредиентов", outcome.Order.RejectionReason);
        Assert.Equal(5m, (await _host.BatchesAsync(pasta)).Single().QuantityRemaining); // макароны не списаны частично
        Assert.Equal(0, await _host.With((_, db) => db.Movements.CountAsync(m => m.Type == MovementType.Consumption)));
    }

    [Fact]
    public async Task Order_StoresTrimmedTitleAndComment()
    {
        var rice = await _host.AddProductAsync("RIC");
        var dish = await _host.AddDishAsync("Рис", (rice, 0.1m));
        await _host.ReceiveAsync((rice, 1, 100));

        var outcome = await _host.With((w, _) => w.PlaceOrderAsync([new OrderLineInput(dish, 1)], "test", default, title: "  Стол 5 ", comment: "   "));

        Assert.Equal("Стол 5", outcome.Order.Title);
        Assert.Null(outcome.Order.Comment); // пустой комментарий не сохраняется
    }

    [Fact]
    public async Task Order_RejectsTooLongTitle_WithoutTouchingStock()
    {
        var rice = await _host.AddProductAsync("RIC");
        var dish = await _host.AddDishAsync("Рис", (rice, 0.1m));
        await _host.ReceiveAsync((rice, 1, 100));

        var ex = await Assert.ThrowsAsync<DomainException>(() =>
            _host.With((w, _) => w.PlaceOrderAsync([new OrderLineInput(dish, 1)], "test", default, title: new string('x', OrderLimits.Title + 1))));

        Assert.Equal(400, ex.Status);
        Assert.Equal(1m, (await _host.BatchesAsync(rice)).Single().QuantityRemaining);
    }

    [Fact]
    public async Task StopList_UpdatesAfterConsumption_AndClearsAfterSupply()
    {
        var fish = await _host.AddProductAsync("FSH");
        var dish = await _host.AddDishAsync("Лосось", (fish, 0.2m));
        await _host.ReceiveAsync((fish, 0.5m, 48));

        await Order((dish, 2));                                         // остаётся 0,1 кг < 0,2
        Assert.Contains((await _host.SnapshotAsync()).StopList, d => d.Id == dish);
        var open = await _host.With((_, db) => db.StopListEntries.SingleAsync(e => e.DishId == dish && e.EndedAt == null));

        await _host.ReceiveAsync((fish, 1, 48));

        Assert.DoesNotContain((await _host.SnapshotAsync()).StopList, d => d.Id == dish);
        var closed = await _host.With((_, db) => db.StopListEntries.SingleAsync(e => e.Id == open.Id));
        Assert.NotNull(closed.EndedAt);
        var alert = await _host.With((_, db) => db.Alerts.SingleAsync(a => a.Key == $"dish:{dish}:stop"));
        Assert.Equal(AlertStatus.Resolved, alert.Status);
    }

    [Fact]
    public async Task StopList_IncludesDish_WhenOnlyExpiredStockRemains_AndWriteOffLogsIt()
    {
        var greens = await _host.AddProductAsync("GRN");
        var dish = await _host.AddDishAsync("Салат", (greens, 0.01m));
        await _host.ReceiveAsync((greens, 0.3m, 2));
        _host.Clock.Now = _host.Clock.Now.AddHours(3);
        await _host.With((w, _) => w.TickAsync(default));

        Assert.Contains((await _host.SnapshotAsync()).StopList, d => d.Id == dish);

        var count = await _host.With((w, _) => w.WriteOffExpiredAsync(false, default));
        Assert.Equal(1, count);
        var batch = (await _host.BatchesAsync(greens)).Single();
        Assert.Equal(BatchState.WrittenOff, batch.State);
        Assert.Equal(0m, batch.QuantityRemaining);
        var move = await _host.With((_, db) => db.Movements.SingleAsync(m => m.Type == MovementType.ExpiredWriteOff));
        Assert.Equal(-0.3m, move.Quantity);
    }

    [Fact]
    public async Task RecipeChange_RecalculatesStopList()
    {
        var eggs = await _host.AddProductAsync("EGG", "pcs");
        var dish = await _host.AddDishAsync("Омлет", (eggs, 3));
        await _host.ReceiveAsync((eggs, 2, 200));
        Assert.Contains((await _host.SnapshotAsync()).StopList, d => d.Id == dish);

        await _host.With((w, _) => w.UpdateDishAsync(dish, new UpdateDishCommand(null, null, null, null, null, [new DishIngredientInput(eggs, 2)]), default));

        Assert.DoesNotContain((await _host.SnapshotAsync()).StopList, d => d.Id == dish);
    }

    [Fact]
    public async Task ConcurrentOrders_NeverOversell()
    {
        var steak = await _host.AddProductAsync("BEF");
        var dish = await _host.AddDishAsync("Стейк", (steak, 1));
        await _host.ReceiveAsync((steak, 5, 100));

        var results = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => Order((dish, 1))));

        Assert.Equal(5, results.Count(r => r.Order.Status == OrderStatus.Completed));
        Assert.Equal(7, results.Count(r => r.Order.Status == OrderStatus.Rejected));
        Assert.All(await _host.BatchesAsync(steak), b => Assert.True(b.QuantityRemaining >= 0));
    }

    [Fact]
    public async Task Adjustment_CannotGoNegative_AndRequiresReason()
    {
        var oil = await _host.AddProductAsync("BTR");
        await _host.ReceiveAsync((oil, 1, 100));
        var batch = (await _host.BatchesAsync(oil)).Single();

        await Assert.ThrowsAsync<DomainException>(() => _host.With((w, _) => w.AdjustBatchAsync(batch.Id, -1, "x", default)));
        await Assert.ThrowsAsync<DomainException>(() => _host.With((w, _) => w.AdjustBatchAsync(batch.Id, 0.5m, " ", default)));
        await Assert.ThrowsAsync<DomainException>(() => _host.With((w, _) => w.WriteOffBatchAsync(batch.Id, 2, null, default)));

        await _host.With((w, _) => w.AdjustBatchAsync(batch.Id, 0.8m, "Инвентаризация", default));
        Assert.Equal(0.8m, (await _host.BatchesAsync(oil)).Single().QuantityRemaining);
    }

    [Fact]
    public async Task HotOffers_PrioritizeDishUsingMoreUrgentIngredient_AndExplainWhy()
    {
        var cream = await _host.AddProductAsync("CRM", "l");
        var milk = await _host.AddProductAsync("MLK", "l");
        var rice = await _host.AddProductAsync("RIC");
        var creamDish = await _host.AddDishAsync("Со сливками", (cream, 0.1m), (rice, 0.1m));
        var milkDish = await _host.AddDishAsync("С молоком", (milk, 0.1m), (rice, 0.1m));
        var plain = await _host.AddDishAsync("Рис", (rice, 0.1m));
        await _host.ReceiveAsync((cream, 1, 6), (milk, 1, 60), (rice, 10, 1000));

        var result = HotOfferCalculator.Calculate(await _host.SnapshotAsync());

        Assert.Equal([creamDish, milkDish], result.Offers.Select(o => o.DishId));
        Assert.DoesNotContain(result.Offers, o => o.DishId == plain);
        var top = result.Offers[0];
        Assert.Equal(10, top.RecommendedServings);
        Assert.NotEmpty(top.Ingredients[0].Explanation);
        Assert.Equal(ExpiryState.Critical, top.Ingredients[0].State);
    }

    [Fact]
    public async Task HotOffers_ListBlockedDish_WhenAnotherIngredientIsMissing()
    {
        var cream = await _host.AddProductAsync("CRM", "l");
        var fish = await _host.AddProductAsync("FSH");
        var soup = await _host.AddDishAsync("Уха", (cream, 0.1m), (fish, 0.1m));
        await _host.ReceiveAsync((cream, 1, 6));

        var result = HotOfferCalculator.Calculate(await _host.SnapshotAsync());

        Assert.Empty(result.Offers);
        var blocked = Assert.Single(result.Blocked);
        Assert.Equal(soup, blocked.DishId);
        Assert.Equal([fish], blocked.MissingProductIds);
    }

    [Fact]
    public async Task Forecast_PredictsDepletionAndExpiryLoss()
    {
        var milk = await _host.AddProductAsync("MLK", "l");
        await _host.ReceiveAsync((milk, 2, 10), (milk, 5, 200));
        var snapshot = await _host.SnapshotAsync();

        // Расход 2,4 л/сут = 0,1 л/ч: за 10 ч из первой партии уйдёт 1 л, ещё 1 л истечёт.
        var f = Forecasting.ForecastProduct(snapshot, milk, consumedInWindow: 16.8m, observedDays: 7);

        Assert.True(f.HasData);
        Assert.Equal(1m, f.ExpectedLoss);
        Assert.NotNull(f.DepletionAt);
        Assert.InRange(f.HoursToDepletion!.Value, 59, 61); // 10 ч + 5 л / 0,1 л/ч
    }

    [Fact]
    public async Task Journal_TypeFilter_FindsOlderOperations_BeyondRecentOnes()
    {
        var flour = await _host.AddProductAsync("FLR");
        await _host.ReceiveAsync((flour, 10, 500));
        var dish = await _host.AddDishAsync("Блины", (flour, 0.1m));
        for (var i = 0; i < 3; i++) await Order((dish, 1));

        // Приёмка - самая старая операция; при лимите 1 она всё равно должна найтись по типу.
        var receipts = await _host.Query(q => q.GetMovementsAsync(null, "receipt", 1, default));
        Assert.Equal("receipt", receipts.Single().Type);
    }
}
