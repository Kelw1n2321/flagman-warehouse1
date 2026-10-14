using Flagman.Api.Domain;

namespace Flagman.Tests;

public sealed class StockEngineTests
{
    private static readonly DateTime Now = new(2026, 10, 10, 12, 0, 0, DateTimeKind.Utc);
    private static readonly ExpiryThresholds T = new(72, 24);
    private static readonly Product Chicken = new() { Id = 1, Sku = "CHK", Name = "Курица", Category = "Мясо", Unit = "kg", MinStock = 5 };

    private static ProductBatch Batch(int id, decimal qty, double expiresInHours, double receivedHoursAgo = 10) => new()
    {
        Id = id, Code = $"B{id}", ProductId = 1, QuantityReceived = qty, QuantityRemaining = qty,
        ExpiresAt = Now.AddHours(expiresInHours), ReceivedAt = Now.AddHours(-receivedHoursAgo), State = BatchState.Active,
    };

    [Theory]
    [InlineData(0, ExpiryState.Expired)]          // ровно в момент окончания - уже просрочено
    [InlineData(-0.01, ExpiryState.Expired)]
    [InlineData(0.01, ExpiryState.Critical)]
    [InlineData(24, ExpiryState.Critical)]        // граница критического порога включительно
    [InlineData(24.01, ExpiryState.Soon)]
    [InlineData(72, ExpiryState.Soon)]
    [InlineData(72.01, ExpiryState.Normal)]
    public void GetExpiryState_RespectsThresholdBoundaries(double hoursLeft, ExpiryState expected) =>
        Assert.Equal(expected, StockEngine.GetExpiryState(Now.AddHours(hoursLeft), Now, T));

    [Fact]
    public void PlanFefo_TakesEarliestExpiringBatchFirst_AndSkipsExpired()
    {
        var batches = new[] { Batch(1, 5, 100), Batch(2, 2, 10), Batch(3, 4, -1), Batch(4, 3, 30) };

        var plan = StockEngine.PlanFefo(batches, 4, Now)!;

        Assert.Equal([2, 4], plan.Select(p => p.Batch.Id));
        Assert.Equal([2m, 2m], plan.Select(p => p.Quantity));
    }

    [Fact]
    public void PlanFefo_ReturnsNull_WhenOnlyExpiredStockWouldCover()
    {
        var batches = new[] { Batch(1, 1, 5), Batch(2, 10, -2) };

        Assert.Null(StockEngine.PlanFefo(batches, 3, Now));
    }

    [Fact]
    public void PlanFefo_BreaksExpiryTiesByReceiptTime()
    {
        var batches = new[] { Batch(1, 1, 50, receivedHoursAgo: 1), Batch(2, 1, 50, receivedHoursAgo: 20) };

        Assert.Equal(2, StockEngine.PlanFefo(batches, 1, Now)![0].Batch.Id);
    }

    [Fact]
    public void Summarize_ExcludesExpiredFromAvailable_AndCountsSeparately()
    {
        var s = StockEngine.Summarize(Chicken, [Batch(1, 4, 10), Batch(2, 8, 100), Batch(3, 1.5m, -3)], Now, T);

        Assert.Equal(13.5m, s.Total);
        Assert.Equal(12m, s.Available);
        Assert.Equal(1.5m, s.Expired);
        Assert.Equal(4m, s.ExpiringCritical);
        Assert.Equal(ProductRisk.Expired, s.Risk);
        Assert.Equal(Now.AddHours(10), s.EarliestExpiry);
    }

    [Fact]
    public void EvaluateDish_ComputesMaxServingsAndLimitingIngredient()
    {
        var stock = new Dictionary<int, ProductStock>
        {
            [1] = StockEngine.Summarize(Chicken, [Batch(1, 1, 50)], Now, T),
        };
        var cream = new Product { Id = 2, Sku = "CRM", Name = "Сливки", Category = "Молочные", Unit = "l" };
        stock[2] = StockEngine.Summarize(cream, [new ProductBatch { Id = 9, Code = "C", ProductId = 2, QuantityRemaining = 0.25m, ExpiresAt = Now.AddDays(2), State = BatchState.Active }], Now, T);
        var dish = new Dish { Id = 1, Name = "Курица в сливках", Ingredients = [new() { ProductId = 1, QuantityPerServing = 0.18m }, new() { ProductId = 2, QuantityPerServing = 0.1m }] };

        var a = StockEngine.EvaluateDish(dish, stock);

        Assert.Equal(2, a.MaxServings);           // сливки: 0,25 / 0,1 = 2 порции; курица: 5 порций
        Assert.Equal(2, a.LimitingProductId);
    }

    [Fact]
    public void EvaluateOrder_AggregatesSharedIngredientAcrossDishes()
    {
        var stock = new Dictionary<int, ProductStock> { [1] = StockEngine.Summarize(Chicken, [Batch(1, 0.5m, 50)], Now, T) };
        var a = new Dish { Id = 1, Name = "A", Ingredients = [new() { ProductId = 1, QuantityPerServing = 0.3m }] };
        var b = new Dish { Id = 2, Name = "B", Ingredients = [new() { ProductId = 1, QuantityPerServing = 0.3m }] };

        var e = StockEngine.EvaluateOrder([(a, 1), (b, 1)], stock);

        Assert.False(e.CanFulfill);                // по отдельности каждое блюдо помещается, вместе - нет
        Assert.Equal(0.1m, e.Shortages.Single().Missing);
    }
}
