namespace Flagman.Api.Domain;

public sealed record BatchAllocation(ProductBatch Batch, decimal Quantity);

public enum ProductRisk { Ok = 0, ExpiringSoon = 1, LowStock = 2, Critical = 3, OutOfStock = 4, Expired = 5 }

/// <summary>Расчётное состояние продукта на момент <c>now</c>. Всё выводится из партий.</summary>
public sealed record ProductStock(
    int ProductId,
    decimal Total,
    decimal Available,
    decimal Expired,
    decimal ExpiringSoon,
    decimal ExpiringCritical,
    int ActiveBatchCount,
    int ExpiredBatchCount,
    DateTime? EarliestExpiry,
    ExpiryState? EarliestState,
    bool BelowMinimum,
    ProductRisk Risk)
{
    /// <summary>Количество с истекающим сроком (скоро + критично), пригодное к использованию.</summary>
    public decimal AtRisk => ExpiringSoon + ExpiringCritical;
}

public sealed record IngredientCheck(
    int ProductId,
    decimal Required,
    decimal Available,
    decimal Missing,
    decimal ExpiredExcluded);

public sealed record DishAvailability(
    int DishId,
    int MaxServings,
    int? LimitingProductId,
    IReadOnlyList<IngredientCheck> Ingredients)
{
    public bool IsAvailable => MaxServings > 0;
    /// <summary>Ингредиенты, которых не хватает даже на одну порцию.</summary>
    public IEnumerable<IngredientCheck> Missing => Ingredients.Where(i => i.Missing > 0);
}

public sealed record OrderEvaluation(IReadOnlyList<IngredientCheck> Requirements)
{
    public bool CanFulfill => Requirements.All(r => r.Missing == 0);
    public IEnumerable<IngredientCheck> Shortages => Requirements.Where(r => r.Missing > 0);
}

/// <summary>Чистые функции складского учёта: сроки, FEFO, доступность блюд и проверка заказов.</summary>
public static class StockEngine
{
    public static double HoursLeft(DateTime expiresAt, DateTime now) => (expiresAt - now).TotalHours;

    public static ExpiryState GetExpiryState(DateTime expiresAt, DateTime now, ExpiryThresholds t)
    {
        // Граница включительная: в момент ExpiresAt партия уже просрочена.
        if (expiresAt <= now) return ExpiryState.Expired;
        var hours = HoursLeft(expiresAt, now);
        if (hours <= t.CriticalHours) return ExpiryState.Critical;
        if (hours <= t.SoonHours) return ExpiryState.Soon;
        return ExpiryState.Normal;
    }

    public static bool IsUsable(ProductBatch b, DateTime now) =>
        b.State == BatchState.Active && b.QuantityRemaining > 0 && b.ExpiresAt > now;

    public static bool IsExpiredInStock(ProductBatch b, DateTime now) =>
        b.State == BatchState.Active && b.QuantityRemaining > 0 && b.ExpiresAt <= now;

    /// <summary>FEFO: сначала партия с самым ранним сроком, при равенстве - более ранняя приёмка.</summary>
    public static IOrderedEnumerable<ProductBatch> FefoOrder(IEnumerable<ProductBatch> batches) =>
        batches.OrderBy(b => b.ExpiresAt).ThenBy(b => b.ReceivedAt).ThenBy(b => b.Id);

    /// <summary>
    /// Планирует списание <paramref name="quantity"/> по FEFO только из пригодных партий.
    /// Ничего не изменяет. Возвращает null, если пригодного остатка недостаточно.
    /// </summary>
    public static IReadOnlyList<BatchAllocation>? PlanFefo(IEnumerable<ProductBatch> batches, decimal quantity, DateTime now)
    {
        if (quantity < 0) throw new ArgumentOutOfRangeException(nameof(quantity));
        var plan = new List<BatchAllocation>();
        var left = quantity;
        foreach (var batch in FefoOrder(batches.Where(b => IsUsable(b, now))))
        {
            if (left <= 0) break;
            var take = Math.Min(batch.QuantityRemaining, left);
            plan.Add(new BatchAllocation(batch, take));
            left -= take;
        }
        return left > 0 ? null : plan;
    }

    public static ProductStock Summarize(Product product, IEnumerable<ProductBatch> batches, DateTime now, ExpiryThresholds t)
    {
        decimal total = 0, available = 0, expired = 0, soon = 0, critical = 0;
        int activeCount = 0, expiredCount = 0;
        DateTime? earliest = null;

        foreach (var b in batches)
        {
            if (b.ProductId != product.Id || b.State != BatchState.Active || b.QuantityRemaining <= 0) continue;
            activeCount++;
            total += b.QuantityRemaining;
            switch (GetExpiryState(b.ExpiresAt, now, t))
            {
                case ExpiryState.Expired:
                    expired += b.QuantityRemaining;
                    expiredCount++;
                    continue; // просроченное не входит в доступный остаток
                case ExpiryState.Critical:
                    critical += b.QuantityRemaining;
                    break;
                case ExpiryState.Soon:
                    soon += b.QuantityRemaining;
                    break;
            }
            available += b.QuantityRemaining;
            if (earliest is null || b.ExpiresAt < earliest) earliest = b.ExpiresAt;
        }

        var below = available < product.MinStock;
        var risk =
            expired > 0 ? ProductRisk.Expired :
            available <= 0 ? ProductRisk.OutOfStock :
            critical > 0 ? ProductRisk.Critical :
            below ? ProductRisk.LowStock :
            soon > 0 ? ProductRisk.ExpiringSoon :
            ProductRisk.Ok;

        return new ProductStock(product.Id, total, available, expired, soon, critical, activeCount, expiredCount,
            earliest, earliest is null ? null : GetExpiryState(earliest.Value, now, t), below, risk);
    }

    public static DishAvailability EvaluateDish(Dish dish, IReadOnlyDictionary<int, ProductStock> stock)
    {
        var checks = new List<IngredientCheck>();
        var max = int.MaxValue;
        int? limiting = null;
        foreach (var ing in dish.Ingredients.Where(i => i.QuantityPerServing > 0))
        {
            var s = stock.GetValueOrDefault(ing.ProductId);
            var available = s?.Available ?? 0;
            var servings = (int)Math.Floor(available / ing.QuantityPerServing);
            if (servings < max)
            {
                max = servings;
                limiting = ing.ProductId;
            }
            checks.Add(new IngredientCheck(ing.ProductId, ing.QuantityPerServing, available,
                Math.Max(0, ing.QuantityPerServing - available), s?.Expired ?? 0));
        }
        if (checks.Count == 0) max = 0; // блюдо без рецептуры приготовить нельзя
        return new DishAvailability(dish.Id, max, limiting, checks);
    }

    /// <summary>Суммирует потребность заказа по ингредиентам (одно и то же сырьё в разных блюдах складывается).</summary>
    public static Dictionary<int, decimal> AggregateRequirements(IEnumerable<(Dish Dish, int Servings)> lines)
    {
        var need = new Dictionary<int, decimal>();
        foreach (var (dish, servings) in lines)
        foreach (var ing in dish.Ingredients)
            need[ing.ProductId] = need.GetValueOrDefault(ing.ProductId) + ing.QuantityPerServing * servings;
        return need;
    }

    public static OrderEvaluation EvaluateOrder(IEnumerable<(Dish Dish, int Servings)> lines, IReadOnlyDictionary<int, ProductStock> stock)
    {
        var reqs = AggregateRequirements(lines)
            .Select(kv =>
            {
                var s = stock.GetValueOrDefault(kv.Key);
                var available = s?.Available ?? 0;
                return new IngredientCheck(kv.Key, kv.Value, available, Math.Max(0, kv.Value - available), s?.Expired ?? 0);
            })
            .ToList();
        return new OrderEvaluation(reqs);
    }
}
