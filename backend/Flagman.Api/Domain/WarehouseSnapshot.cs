namespace Flagman.Api.Domain;

/// <summary>
/// Согласованный срез склада на момент <see cref="Now"/>: остатки, доступность блюд и стоп-лист
/// рассчитываются из одного набора партий, поэтому никогда не расходятся между собой.
/// </summary>
public sealed class WarehouseSnapshot
{
    public required DateTime Now { get; init; }
    public required ExpiryThresholds Thresholds { get; init; }
    public required IReadOnlyDictionary<int, Product> Products { get; init; }
    public required IReadOnlyList<ProductBatch> ActiveBatches { get; init; }
    public required ILookup<int, ProductBatch> BatchesByProduct { get; init; }
    public required IReadOnlyDictionary<int, ProductStock> Stock { get; init; }
    public required IReadOnlyList<Dish> Dishes { get; init; }
    public required IReadOnlyDictionary<int, DishAvailability> DishAvailability { get; init; }
    /// <summary>Продукты, которых не хватает хотя бы на одну порцию какого-либо активного блюда.</summary>
    public required IReadOnlySet<int> ProductsBlockingDishes { get; init; }
    /// <summary>Сколько активных блюд использует продукт.</summary>
    public required IReadOnlyDictionary<int, int> DishUsageCount { get; init; }

    public IEnumerable<Dish> StopList => Dishes.Where(d => !DishAvailability[d.Id].IsAvailable);

    public static WarehouseSnapshot Build(
        IEnumerable<Product> products,
        IEnumerable<ProductBatch> batches,
        IEnumerable<Dish> dishes,
        ExpiryThresholds thresholds,
        DateTime now)
    {
        var productMap = products.ToDictionary(p => p.Id);
        var active = batches.Where(b => b.State == BatchState.Active).ToList();
        var byProduct = active.ToLookup(b => b.ProductId);
        var stock = productMap.Values.ToDictionary(p => p.Id, p => StockEngine.Summarize(p, byProduct[p.Id], now, thresholds));
        var activeDishes = dishes.Where(d => d.IsActive).OrderBy(d => d.Name).ToList();
        var availability = activeDishes.ToDictionary(d => d.Id, d => StockEngine.EvaluateDish(d, stock));
        var blocking = availability.Values.SelectMany(a => a.Missing).Select(m => m.ProductId).ToHashSet();
        var usage = activeDishes.SelectMany(d => d.Ingredients.Select(i => i.ProductId).Distinct())
            .GroupBy(id => id).ToDictionary(g => g.Key, g => g.Count());

        return new WarehouseSnapshot
        {
            Now = now,
            Thresholds = thresholds,
            Products = productMap,
            ActiveBatches = active,
            BatchesByProduct = byProduct,
            Stock = stock,
            Dishes = activeDishes,
            DishAvailability = availability,
            ProductsBlockingDishes = blocking,
            DishUsageCount = usage,
        };
    }

    public ExpiryState StateOf(ProductBatch b) => StockEngine.GetExpiryState(b.ExpiresAt, Now, Thresholds);
}
