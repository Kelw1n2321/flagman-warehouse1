namespace Flagman.Api.Domain;

public sealed record ForecastPoint(DateTime At, decimal Usable);

public sealed record ProductForecast(
    int ProductId,
    bool HasData,
    decimal DailyUsage,
    DateTime? DepletionAt,
    double? HoursToDepletion,
    decimal ExpectedLoss,
    IReadOnlyList<ForecastPoint> Series);

public sealed record DishStopForecast(int DishId, bool AlreadyStopped, DateTime? PredictedAt, double? HoursUntil, int? CauseProductId);

public sealed record SupplyRecommendation(
    int ProductId,
    decimal Available,
    decimal DailyUsage,
    double? DaysOfCover,
    decimal ExpectedLoss,
    decimal RecommendedQuantity,
    string Urgency,
    IReadOnlyList<string> Reasons);

/// <summary>
/// Прогноз по среднему расходу. Считаем по часам, расход идёт по FEFO.
/// Если партия испортилась раньше, чем её потратили, она считается потерей.
/// </summary>
public static class Forecasting
{
    public const int HorizonHours = 24 * 7;
    public const int SeriesStepHours = 6;

    /// <param name="consumedInWindow">Сколько продукта израсходовано на блюда за окно (положительное число).</param>
    /// <param name="observedDays">Фактическая длительность окна наблюдения в днях.</param>
    public static ProductForecast ForecastProduct(WarehouseSnapshot s, int productId, decimal consumedInWindow, double observedDays)
    {
        var hasData = observedDays >= 1 && consumedInWindow > 0;
        var daily = hasData ? consumedInWindow / (decimal)observedDays : 0m;
        var hourly = daily / 24m;

        var (series, loss, depletion) = Simulate(s, productId, hourly, HorizonHours);

        return new ProductForecast(productId, hasData, Math.Round(daily, 3), depletion,
            depletion is null ? null : (depletion.Value - s.Now).TotalHours, loss, series);
    }

    /// <summary>Момент, когда остаток хотя бы одного ингредиента станет меньше нормы на одну порцию.</summary>
    public static DishStopForecast ForecastDishStop(WarehouseSnapshot s, Dish dish, IReadOnlyDictionary<int, ProductForecast> forecasts)
    {
        if (!s.DishAvailability[dish.Id].IsAvailable)
            return new DishStopForecast(dish.Id, true, s.Now, 0, s.DishAvailability[dish.Id].Missing.FirstOrDefault()?.ProductId);

        DateTime? earliest = null;
        int? cause = null;
        foreach (var ing in dish.Ingredients)
        {
            if (!forecasts.TryGetValue(ing.ProductId, out var f)) continue;
            var point = f.Series.FirstOrDefault(p => p.Usable < ing.QuantityPerServing);
            if (point is null) continue;
            if (earliest is null || point.At < earliest)
            {
                earliest = point.At;
                cause = ing.ProductId;
            }
        }
        return new DishStopForecast(dish.Id, false, earliest, earliest is null ? null : (earliest.Value - s.Now).TotalHours, cause);
    }

    public static SupplyRecommendation? Recommend(WarehouseSnapshot s, Product p, ProductForecast f, int coverDays)
    {
        var stock = s.Stock[p.Id];
        var reasons = new List<string>();
        double? daysOfCover = f.HasData && f.DailyUsage > 0 ? (double)(stock.Available / f.DailyUsage) : null;
        // Потери в пределах горизонта пополнения (то, что истечёт раньше, чем будет использовано).
        var coverHours = coverDays * 24;
        var lossInCover = f.Series.Count == 0 ? 0 : EstimateLoss(s, p.Id, f, coverHours);

        var target = Math.Max(p.MinStock * 1.5m, f.DailyUsage * coverDays + p.MinStock);
        var effective = stock.Available - lossInCover;
        var needed = target - effective;

        if (stock.Available <= 0) reasons.Add("Пригодного остатка нет.");
        else if (stock.BelowMinimum) reasons.Add($"Остаток {Units.Format(stock.Available, p.Unit)} ниже минимума {Units.Format(p.MinStock, p.Unit)}.");
        if (daysOfCover is { } d && d < coverDays)
            reasons.Add($"Средний расход {Units.Format(f.DailyUsage, p.Unit)}/сут — запаса хватит примерно на {d.ToString("0.#", Units.Ru)} сут.");
        if (lossInCover > 0)
            reasons.Add($"{Units.Format(lossInCover, p.Unit)} истечёт раньше, чем будет израсходовано.");
        if (s.ProductsBlockingDishes.Contains(p.Id))
            reasons.Add("Из-за нехватки продукта блюда стоят в стоп-листе.");

        if (needed <= 0 || reasons.Count == 0) return null;

        var qty = RoundUp(needed, p.Unit);
        var urgency = stock.Available <= 0 || s.ProductsBlockingDishes.Contains(p.Id) ? "critical"
            : daysOfCover is < 1 || stock.BelowMinimum ? "high" : "normal";
        return new SupplyRecommendation(p.Id, stock.Available, f.DailyUsage, daysOfCover, lossInCover, qty, urgency, reasons);
    }

    private static decimal EstimateLoss(WarehouseSnapshot s, int productId, ProductForecast f, int hours) =>
        Simulate(s, productId, f.DailyUsage / 24m, hours).Loss;

    /// <summary>Почасовое моделирование: расход по FEFO, затем выбытие партий, у которых наступил срок.</summary>
    private static (List<ForecastPoint> Series, decimal Loss, DateTime? Depletion) Simulate(
        WarehouseSnapshot s, int productId, decimal hourly, int hours)
    {
        // Копии остатков пригодных партий - прогноз ничего не меняет в снимке.
        var batches = StockEngine.FefoOrder(s.BatchesByProduct[productId].Where(b => StockEngine.IsUsable(b, s.Now)))
            .Select(b => (b.ExpiresAt, Qty: b.QuantityRemaining))
            .ToList();
        var series = new List<ForecastPoint>();
        decimal loss = 0;
        var usable = batches.Sum(b => b.Qty);
        DateTime? depletion = usable <= 0 ? s.Now : null;

        for (var h = 0; h <= hours; h++)
        {
            var t = s.Now.AddHours(h);
            if (h > 0)
            {
                var need = hourly;
                for (var i = 0; i < batches.Count && need > 0; i++)
                {
                    var take = Math.Min(batches[i].Qty, need);
                    batches[i] = batches[i] with { Qty = batches[i].Qty - take };
                    need -= take;
                }
                for (var i = 0; i < batches.Count; i++)
                {
                    if (batches[i].ExpiresAt <= t && batches[i].Qty > 0)
                    {
                        loss += batches[i].Qty;
                        batches[i] = batches[i] with { Qty = 0 };
                    }
                }
                usable = batches.Sum(b => b.Qty);
                if (depletion is null && usable <= 0) depletion = t;
            }
            if (h % SeriesStepHours == 0) series.Add(new ForecastPoint(t, Math.Round(usable, 3)));
        }
        return (series, Math.Round(loss, 3), depletion);
    }

    public static decimal RoundUp(decimal qty, string unit)
    {
        var step = unit switch { "pcs" => 10m, "g" or "ml" => 100m, _ => 0.5m };
        return Math.Ceiling(qty / step) * step;
    }
}
