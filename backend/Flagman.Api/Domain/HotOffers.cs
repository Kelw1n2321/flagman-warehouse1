namespace Flagman.Api.Domain;

public sealed record HotOfferIngredient(
    int ProductId,
    decimal AtRiskQuantity,
    double HoursLeft,
    string EarliestBatchCode,
    ExpiryState State,
    decimal PerServing,
    int ServingsToClear,
    int UsableServings,
    decimal RescuedQuantity,
    double Urgency,
    double Volume,
    double Coverage,
    double Exclusivity,
    int OtherDishCount,
    double Contribution,
    IReadOnlyList<string> Explanation);

public sealed record HotOffer(
    int DishId,
    double Score,
    string Level,
    int MaxServings,
    int RecommendedServings,
    int? LimitingProductId,
    string Summary,
    IReadOnlyList<HotOfferIngredient> Ingredients);

public sealed record BlockedOffer(int DishId, IReadOnlyList<int> AtRiskProductIds, IReadOnlyList<int> MissingProductIds);

public sealed record HotOffersResult(IReadOnlyList<HotOffer> Offers, IReadOnlyList<BlockedOffer> Blocked);

/// <summary>
/// Горячие предложения: какие блюда продавать в первую очередь.
/// Для каждого продукта с истекающим сроком считаем баллы:
///   баллы = 100 * U * (0.35 + 0.65 * C) * (0.5 + 0.5 * V) * E
///   U - срочность, от 0.4 до 1 по мере приближения срока
///   C - какую часть продукта блюдо может израсходовать
///   V - сколько порций нужно, чтобы израсходовать продукт (максимум на 20 порциях)
///   E - 1/sqrt(N), N - сколько блюд используют этот продукт
/// Баллы блюда складываются по всем продуктам.
/// </summary>
public static class HotOfferCalculator
{
    public const int VolumeSaturationServings = 20;
    public const double HighThreshold = 45;
    public const double MediumThreshold = 20;

    public static HotOffersResult Calculate(WarehouseSnapshot s)
    {
        var soon = s.Thresholds.SoonHours;
        // Пригодные к использованию партии со сроком в окне "скоро истекает" и ближе.
        var atRisk = s.ActiveBatches
            .Where(b => StockEngine.IsUsable(b, s.Now) && s.StateOf(b) is ExpiryState.Soon or ExpiryState.Critical)
            .GroupBy(b => b.ProductId)
            .ToDictionary(g => g.Key, g => StockEngine.FefoOrder(g).ToList());

        // Сколько блюд, которые реально можно приготовить, используют продукт.
        var cookableUsers = s.Dishes
            .Where(d => s.DishAvailability[d.Id].IsAvailable)
            .SelectMany(d => d.Ingredients.Select(i => i.ProductId).Distinct())
            .GroupBy(id => id)
            .ToDictionary(g => g.Key, g => g.Count());

        var offers = new List<HotOffer>();
        var blocked = new List<BlockedOffer>();

        foreach (var dish in s.Dishes)
        {
            var riskyIngredients = dish.Ingredients
                .Where(i => i.QuantityPerServing > 0 && atRisk.ContainsKey(i.ProductId))
                .ToList();
            if (riskyIngredients.Count == 0) continue;

            var availability = s.DishAvailability[dish.Id];
            if (!availability.IsAvailable)
            {
                blocked.Add(new BlockedOffer(dish.Id,
                    riskyIngredients.Select(i => i.ProductId).ToList(),
                    availability.Missing.Select(m => m.ProductId).ToList()));
                continue;
            }

            var maxServings = availability.MaxServings;
            var parts = new List<HotOfferIngredient>();
            foreach (var ing in riskyIngredients)
            {
                var batches = atRisk[ing.ProductId];
                var product = s.Products[ing.ProductId];
                var qty = batches.Sum(b => b.QuantityRemaining);
                var earliest = batches[0];
                var hoursLeft = StockEngine.HoursLeft(earliest.ExpiresAt, s.Now);
                var state = s.StateOf(earliest);

                var servingsToClear = (int)Math.Ceiling(qty / ing.QuantityPerServing);
                var usable = Math.Min(maxServings, servingsToClear);
                var rescued = Math.Min(usable * ing.QuantityPerServing, qty);

                var urgency = 0.4 + 0.6 * Math.Clamp(1 - hoursLeft / soon, 0, 1);
                var coverage = qty == 0 ? 0 : (double)(rescued / qty);
                var volume = Math.Min(1.0, Math.Log(1 + servingsToClear) / Math.Log(1 + VolumeSaturationServings));
                var users = Math.Max(1, cookableUsers.GetValueOrDefault(ing.ProductId, 1));
                var exclusivity = 1 / Math.Sqrt(users);
                var contribution = 100 * urgency * (0.35 + 0.65 * coverage) * (0.5 + 0.5 * volume) * exclusivity;

                var u = product.Unit;
                var explanation = new List<string>
                {
                    $"{product.Name}: {Units.Format(qty, u)} с истекающим сроком, ближайшая партия {earliest.Code} — через {FormatHours(hoursLeft)}" +
                        (state == ExpiryState.Critical ? " (критический срок)." : "."),
                    $"Одна порция расходует {Units.Format(ing.QuantityPerServing, u)}: чтобы полностью использовать остаток, нужно {servingsToClear} порц." +
                        (usable < servingsToClear
                            ? $" Сейчас можно приготовить {maxServings} порц. — это спасёт {Units.Format(rescued, u)} ({coverage:P0})."
                            : $" Доступно {maxServings} порц. — блюдо может реализовать весь объём."),
                    users > 1
                        ? $"Продукт входит ещё в {users - 1} доступн. блюд(а) — нагрузка распределяется, вклад снижен."
                        : "Других доступных блюд с этим продуктом нет — это основной способ его реализовать.",
                };

                parts.Add(new HotOfferIngredient(ing.ProductId, qty, hoursLeft, earliest.Code, state, ing.QuantityPerServing,
                    servingsToClear, usable, rescued, urgency, volume, coverage, exclusivity, users - 1,
                    Math.Round(contribution, 1), explanation));
            }

            var score = Math.Round(parts.Sum(p => p.Contribution), 1);
            var top = parts.MaxBy(p => p.Contribution)!;
            var topProduct = s.Products[top.ProductId];
            var recommended = parts.Max(p => p.UsableServings);
            var summary = (parts.Count > 1
                    ? $"Расходует сразу {parts.Count} продукта с истекающим сроком. Главный — «{topProduct.Name}»: "
                    : $"Расходует «{topProduct.Name}»: ")
                + $"{Units.Format(top.AtRiskQuantity, topProduct.Unit)} в зоне риска, ближайшая партия истекает через {FormatHours(top.HoursLeft)}; "
                + $"{top.UsableServings} порц. спасут {Units.Format(top.RescuedQuantity, topProduct.Unit)}.";

            offers.Add(new HotOffer(dish.Id, score, LevelOf(score), maxServings, recommended,
                availability.LimitingProductId, summary,
                parts.OrderByDescending(p => p.Contribution).ToList()));
        }

        return new HotOffersResult(offers.OrderByDescending(o => o.Score).ThenBy(o => o.DishId).ToList(), blocked);
    }

    public static string LevelOf(double score) =>
        score >= HighThreshold ? "high" : score >= MediumThreshold ? "medium" : "low";

    public static string FormatHours(double hours)
    {
        if (hours < 1) return $"{Math.Max(0, (int)Math.Round(hours * 60))} мин";
        if (hours < 48) return $"{(int)Math.Round(hours)} ч";
        var days = (int)(hours / 24);
        var rest = (int)Math.Round(hours - days * 24);
        return rest == 0 ? $"{days} д" : $"{days} д {rest} ч";
    }
}
