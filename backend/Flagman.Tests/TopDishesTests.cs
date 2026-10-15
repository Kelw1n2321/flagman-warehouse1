using Flagman.Api.Services;

namespace Flagman.Tests;

public sealed class TopDishesTests : IAsyncLifetime
{
    private readonly TestHost _host = new();

    public Task InitializeAsync() => Task.CompletedTask;
    public async Task DisposeAsync() => await _host.DisposeAsync();

    private Task<OrderOutcome> Order(params (int DishId, int Servings)[] lines) =>
        _host.With((w, _) => w.PlaceOrderAsync(lines.Select(l => new OrderLineInput(l.DishId, l.Servings)).ToList(), "test", default));

    [Fact]
    public async Task RanksByServings_IgnoresRejectedOrders_AndComparesWithPreviousPeriod()
    {
        var flour = await _host.AddProductAsync("FLR");
        var fish = await _host.AddProductAsync("FSH");
        await _host.ReceiveAsync((flour, 100, 2000), (fish, 0.3m, 2000));
        var pancakes = await _host.AddDishAsync("Блины", (flour, 0.1m));
        var salmon = await _host.AddDishAsync("Лосось", (fish, 0.2m));
        var omelet = await _host.AddDishAsync("Омлет", (flour, 0.05m));

        // Прошлая неделя: блины 2 порции.
        await Order((pancakes, 2));
        _host.Clock.Now = _host.Clock.Now.AddDays(7);

        // Эта неделя: блины 3 + 3, лосось 1, второй заказ лосося отклонён (рыбы не хватает).
        await Order((pancakes, 3), (salmon, 1));
        await Order((pancakes, 3));
        var rejected = await Order((salmon, 5));
        Assert.Equal(Flagman.Api.Domain.OrderStatus.Rejected, rejected.Order.Status);

        var top = await _host.Query(q => q.GetTopDishesAsync(7, null, default));
        Assert.Equal([pancakes, salmon, omelet], top.Items.Select(i => i.DishId));
        var first = top.Items[0];
        Assert.Equal((1, 6, 2), (first.Rank, first.Servings, first.Orders));
        Assert.Equal(2, first.PrevServings);
        Assert.Equal(200, first.TrendPercent);
        Assert.Equal(6.0 / 7, first.Share, 3);
        Assert.Equal(7, top.TotalServings);
        Assert.Equal(2, top.TotalOrders);
        Assert.Equal(7, top.Items[0].Daily.Count);
        Assert.Equal(6, top.Items[0].Daily.Sum());
        Assert.Null(top.Items[1].TrendPercent);          // лосось на прошлой неделе не продавался
        Assert.Equal(0, top.Items[2].Servings);          // омлет в рейтинге, но без продаж
    }

    [Fact]
    public async Task FiltersByCategory()
    {
        var flour = await _host.AddProductAsync("FLR");
        await _host.ReceiveAsync((flour, 100, 2000));
        var a = await _host.AddDishAsync("Блины", (flour, 0.1m));
        await _host.With(async (_, db) =>
        {
            (await db.Dishes.FindAsync(a))!.Category = "Завтраки";
            return await db.SaveChangesAsync();
        });
        await _host.AddDishAsync("Хлеб", (flour, 0.1m));

        var top = await _host.Query(q => q.GetTopDishesAsync(7, "Завтраки", default));
        Assert.Equal([a], top.Items.Select(i => i.DishId));
        Assert.Contains("Завтраки", top.Categories);
    }
}
