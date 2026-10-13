using Flagman.Api.Api;
using Flagman.Api.Data;
using Flagman.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Api.Services;

/// <summary>Чтение и проекции для UI. Всё рассчитывается из одного <see cref="WarehouseSnapshot"/>.</summary>
public sealed class QueryService(FlagmanDbContext db, WarehouseService warehouse, EventBus bus, IConfiguration config)
{
    private DateTime Now => warehouse.UtcNow;

    public static string RiskName(ProductRisk r) => r switch
    {
        ProductRisk.Ok => "ok",
        ProductRisk.ExpiringSoon => "expiring",
        ProductRisk.LowStock => "low",
        ProductRisk.Critical => "critical",
        ProductRisk.OutOfStock => "out",
        ProductRisk.Expired => "expired",
        _ => "ok",
    };

    public static string ExpiryName(ExpiryState s) => s switch
    {
        ExpiryState.Normal => "normal",
        ExpiryState.Soon => "soon",
        ExpiryState.Critical => "critical",
        _ => "expired",
    };

    private static string StateName(BatchState s) => s switch
    {
        BatchState.Active => "active",
        BatchState.Depleted => "depleted",
        _ => "writtenOff",
    };

    private static string MovementName(MovementType t) => t switch
    {
        MovementType.Receipt => "receipt",
        MovementType.Consumption => "consumption",
        MovementType.ExpiredWriteOff => "expiredWriteOff",
        MovementType.SpoilageWriteOff => "spoilageWriteOff",
        MovementType.AdjustmentPlus => "adjustmentPlus",
        _ => "adjustmentMinus",
    };

    // ───────────── Продукты ─────────────

    public static ProductDto ToDto(WarehouseSnapshot s, Product p)
    {
        var st = s.Stock[p.Id];
        var blocked = s.Dishes.Where(d => s.DishAvailability[d.Id].Missing.Any(m => m.ProductId == p.Id)).Select(d => d.Name).ToList();
        var level = (int)st.Risk + (blocked.Count > 0 ? 2 : 0);
        return new ProductDto(p.Id, p.Sku, p.Name, p.Category, p.Unit, p.Icon, p.MinStock, p.DefaultShelfLifeHours,
            st.Total, st.Available, st.Expired, st.ExpiringSoon, st.ExpiringCritical, st.ActiveBatchCount, st.ExpiredBatchCount,
            st.EarliestExpiry, st.EarliestState is { } e ? ExpiryName(e) : null, st.BelowMinimum, RiskName(st.Risk), level,
            s.DishUsageCount.GetValueOrDefault(p.Id), blocked);
    }

    public async Task<IReadOnlyList<ProductDto>> GetStockAsync(string? search, string? category, string? filter, string? sort, CancellationToken ct)
    {
        var s = await warehouse.LoadSnapshotAsync(Now, ct);
        IEnumerable<ProductDto> items = s.Products.Values.Where(p => !p.IsArchived).Select(p => ToDto(s, p));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var q = search.Trim();
            items = items.Where(p => p.Name.Contains(q, StringComparison.OrdinalIgnoreCase) || p.Sku.Contains(q, StringComparison.OrdinalIgnoreCase)
                                     || p.Id.ToString() == q);
        }
        if (!string.IsNullOrWhiteSpace(category)) items = items.Where(p => p.Category == category);
        items = filter switch
        {
            "in-stock" => items.Where(p => p.Available > 0),
            "low" => items.Where(p => p.BelowMinimum),
            "expiring" => items.Where(p => p.ExpiringSoon + p.ExpiringCritical > 0),
            "expired" => items.Where(p => p.Expired > 0),
            "insufficient" => items.Where(p => p.BlockedDishes.Count > 0),
            _ => items,
        };
        items = sort switch
        {
            "quantity" => items.OrderBy(p => p.MinStock > 0 ? p.Available / p.MinStock : p.Available),
            "expiry" => items.OrderBy(p => p.EarliestExpiry ?? DateTime.MaxValue),
            "risk" => items.OrderByDescending(p => p.RiskLevel).ThenBy(p => p.EarliestExpiry ?? DateTime.MaxValue),
            _ => items.OrderBy(p => p.Name),
        };
        return items.ToList();
    }

    public async Task<ProductDetailDto?> GetProductAsync(int id, CancellationToken ct)
    {
        var s = await warehouse.LoadSnapshotAsync(Now, ct);
        if (!s.Products.TryGetValue(id, out var product)) return null;

        var batches = await db.Batches.AsNoTracking().Include(b => b.Supply).Where(b => b.ProductId == id).ToListAsync(ct);
        var ranks = FefoRanks(s);
        var batchDtos = batches
            .OrderBy(b => b.State == BatchState.Active ? 0 : 1).ThenBy(b => b.ExpiresAt)
            .Select(b => ToBatchDto(s, b, product, b.Supply!.SupplyNumber, ranks)).ToList();

        var movements = await db.Movements.AsNoTracking().Where(m => m.ProductId == id)
            .OrderByDescending(m => m.CreatedAt).ThenByDescending(m => m.Id).Take(150).ToListAsync(ct);

        var supplyIds = batches.Select(b => b.SupplyId).Distinct().ToList();
        var supplies = await db.Supplies.AsNoTracking().Include(x => x.Lines).Where(x => supplyIds.Contains(x.Id))
            .OrderByDescending(x => x.CreatedAt).ToListAsync(ct);

        var dishes = s.Dishes.Where(d => d.Ingredients.Any(i => i.ProductId == id))
            .Select(d => new DishIngredientUseDto(d.Id, d.Name, d.Icon, d.Ingredients.First(i => i.ProductId == id).QuantityPerServing,
                s.DishAvailability[d.Id].MaxServings, s.DishAvailability[d.Id].IsAvailable)).ToList();

        var forecast = await ForecastAsync(s, [id], ct);
        var f = forecast[id];

        return new ProductDetailDto(ToDto(s, product), batchDtos, await MapMovementsAsync(movements, s, ct),
            supplies.Select(x => ToSupplyDto(x, s.Products, null)).ToList(), dishes,
            new ProductForecastDto(f.HasData, f.DailyUsage, f.DepletionAt, f.HoursToDepletion, f.ExpectedLoss,
                f.Series.Select(p => new ForecastPointDto(p.At, p.Usable)).ToList()));
    }

    private async Task<IReadOnlyList<MovementDto>> MapMovementsAsync(List<StockMovement> movements, WarehouseSnapshot s, CancellationToken ct)
    {
        var batchIds = movements.Where(m => m.BatchId != null).Select(m => m.BatchId!.Value).Distinct().ToList();
        var codes = await db.Batches.AsNoTracking().Where(b => batchIds.Contains(b.Id)).ToDictionaryAsync(b => b.Id, b => b.Code, ct);
        var supplyIds = movements.Where(m => m.SupplyId != null).Select(m => m.SupplyId!.Value).Distinct().ToList();
        var supplyNumbers = await db.Supplies.AsNoTracking().Where(x => supplyIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.SupplyNumber, ct);
        var orderIds = movements.Where(m => m.OrderId != null).Select(m => m.OrderId!.Value).Distinct().ToList();
        var orderNumbers = await db.Orders.AsNoTracking().Where(x => orderIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.Number, ct);
        return movements.Select(m =>
        {
            var p = s.Products[m.ProductId];
            return new MovementDto(m.Id, m.ProductId, p.Name, p.Unit, m.BatchId, m.BatchId is { } b ? codes.GetValueOrDefault(b) : null,
                MovementName(m.Type), m.Quantity, m.BatchBalanceAfter, m.CreatedAt,
                m.SupplyId, m.SupplyId is { } sid ? supplyNumbers.GetValueOrDefault(sid) : null,
                m.OrderId, m.OrderId is { } oid ? orderNumbers.GetValueOrDefault(oid) : null, m.Reason);
        }).ToList();
    }

    public async Task<IReadOnlyList<MovementDto>> GetMovementsAsync(int? productId, string? type, int limit, CancellationToken ct)
    {
        var s = await warehouse.LoadSnapshotAsync(Now, ct);
        var q = db.Movements.AsNoTracking().AsQueryable();
        if (productId is { } pid) q = q.Where(m => m.ProductId == pid);
        var list = await q.OrderByDescending(m => m.CreatedAt).ThenByDescending(m => m.Id).Take(Math.Clamp(limit, 1, 500) * 2).ToListAsync(ct);
        if (!string.IsNullOrEmpty(type)) list = list.Where(m => MovementName(m.Type) == type).ToList();
        return await MapMovementsAsync(list.Take(Math.Clamp(limit, 1, 500)).ToList(), s, ct);
    }

    // ───────────── Партии ─────────────

    private static Dictionary<int, int> FefoRanks(WarehouseSnapshot s)
    {
        var ranks = new Dictionary<int, int>();
        foreach (var g in s.ActiveBatches.Where(b => StockEngine.IsUsable(b, s.Now)).GroupBy(b => b.ProductId))
        {
            var i = 1;
            foreach (var b in StockEngine.FefoOrder(g)) ranks[b.Id] = i++;
        }
        return ranks;
    }

    private static BatchDto ToBatchDto(WarehouseSnapshot s, ProductBatch b, Product p, string supplyNumber, IReadOnlyDictionary<int, int> ranks) =>
        new(b.Id, b.Code, p.Id, p.Name, p.Unit, p.Icon, p.Category, b.SupplyId, supplyNumber, b.ReceivedAt, b.ExpiresAt,
            b.QuantityReceived, b.QuantityRemaining, StateName(b.State), ExpiryName(s.StateOf(b)),
            Math.Round(StockEngine.HoursLeft(b.ExpiresAt, s.Now), 2), ranks.TryGetValue(b.Id, out var r) ? r : null);

    public async Task<IReadOnlyList<BatchDto>> GetBatchesAsync(string? expiry, int? productId, string? category, bool includeClosed, string? search, CancellationToken ct)
    {
        var s = await warehouse.LoadSnapshotAsync(Now, ct);
        var q = db.Batches.AsNoTracking().Include(b => b.Supply).AsQueryable();
        if (!includeClosed) q = q.Where(b => b.State == BatchState.Active && b.QuantityRemaining > 0);
        if (productId is { } pid) q = q.Where(b => b.ProductId == pid);
        var list = await q.ToListAsync(ct);
        var ranks = FefoRanks(s);
        IEnumerable<BatchDto> items = list.Select(b => ToBatchDto(s, b, s.Products[b.ProductId], b.Supply!.SupplyNumber, ranks));
        if (!string.IsNullOrWhiteSpace(category)) items = items.Where(b => b.Category == category);
        if (!string.IsNullOrWhiteSpace(expiry)) items = items.Where(b => b.State == "active" && b.Expiry == expiry);
        if (!string.IsNullOrWhiteSpace(search))
            items = items.Where(b => b.ProductName.Contains(search, StringComparison.OrdinalIgnoreCase)
                                     || b.Code.Contains(search, StringComparison.OrdinalIgnoreCase)
                                     || b.SupplyNumber.Contains(search, StringComparison.OrdinalIgnoreCase));
        return items.OrderBy(b => b.ExpiresAt).ToList();
    }

    // ───────────── Поставки ─────────────

    private static SupplyDto ToSupplyDto(Supply x, IReadOnlyDictionary<int, Product> products, IReadOnlyList<SupplyLineDto>? lines) =>
        new(x.Id, x.SupplyNumber, x.Supplier, x.CreatedAt, x.ReceivedAt,
            x.Status switch { SupplyStatus.Draft => "draft", SupplyStatus.Received => "received", _ => "cancelled" },
            x.Note, x.Lines.Count, x.Lines.Select(l => products[l.ProductId].Name).Distinct().ToList(),
            x.Lines.Count == 0 ? null : x.Lines.Min(l => l.ExpiresAt), lines);

    public async Task<IReadOnlyList<SupplyDto>> GetSuppliesAsync(string? search, string? status, CancellationToken ct)
    {
        var products = await db.Products.AsNoTracking().ToDictionaryAsync(p => p.Id, ct);
        var list = await db.Supplies.AsNoTracking().Include(x => x.Lines).ToListAsync(ct);
        IEnumerable<SupplyDto> items = list.Select(x => ToSupplyDto(x, products, null));
        if (!string.IsNullOrWhiteSpace(status)) items = items.Where(x => x.Status == status);
        if (!string.IsNullOrWhiteSpace(search))
            items = items.Where(x => x.SupplyNumber.Contains(search, StringComparison.OrdinalIgnoreCase)
                                     || x.Supplier.Contains(search, StringComparison.OrdinalIgnoreCase)
                                     || x.ProductNames.Any(n => n.Contains(search, StringComparison.OrdinalIgnoreCase)));
        return items.OrderByDescending(x => x.CreatedAt).ToList();
    }

    public async Task<SupplyDto?> GetSupplyAsync(Guid id, CancellationToken ct)
    {
        var s = await warehouse.LoadSnapshotAsync(Now, ct);
        var x = await db.Supplies.AsNoTracking().Include(v => v.Lines).FirstOrDefaultAsync(v => v.Id == id, ct);
        if (x is null) return null;
        var batches = await db.Batches.AsNoTracking().Where(b => b.SupplyId == id).OrderBy(b => b.Id).ToListAsync(ct);
        var ranks = FefoRanks(s);
        // Строки и партии сопоставляются в порядке создания (каждая строка → одна партия).
        var used = new HashSet<int>();
        var lines = x.Lines.OrderBy(l => l.Id).Select(l =>
        {
            var p = s.Products[l.ProductId];
            var batch = batches.FirstOrDefault(b => b.ProductId == l.ProductId && b.QuantityReceived == l.Quantity && b.ExpiresAt == l.ExpiresAt && used.Add(b.Id));
            return new SupplyLineDto(l.Id, p.Id, p.Name, p.Unit, p.Icon, l.Quantity, l.ExpiresAt,
                Math.Round(StockEngine.HoursLeft(l.ExpiresAt, s.Now), 2), ExpiryName(StockEngine.GetExpiryState(l.ExpiresAt, s.Now, s.Thresholds)),
                batch is null ? null : ToBatchDto(s, batch, p, x.SupplyNumber, ranks));
        }).ToList();
        return ToSupplyDto(x, s.Products, lines);
    }

    public async Task<IReadOnlyList<RecommendationDto>> GetSupplyRecommendationsAsync(CancellationToken ct)
    {
        var settings = await warehouse.GetSettingsAsync(ct);
        var s = await warehouse.LoadSnapshotAsync(Now, ct, thresholds: settings.Thresholds);
        var forecasts = await ForecastAsync(s, s.Products.Keys, ct);
        var urgencyOrder = new Dictionary<string, int> { ["critical"] = 0, ["high"] = 1, ["normal"] = 2 };
        return s.Products.Values.Where(p => !p.IsArchived)
            .Select(p => (p, r: Forecasting.Recommend(s, p, forecasts[p.Id], settings.SupplyCoverDays)))
            .Where(x => x.r is not null)
            .Select(x => new RecommendationDto(x.p.Id, x.p.Name, x.p.Unit, x.p.Icon, x.p.Category, x.r!.Available, x.p.MinStock,
                x.r.DailyUsage, x.r.DaysOfCover is { } d ? Math.Round(d, 2) : null, x.r.ExpectedLoss, x.r.RecommendedQuantity, x.r.Urgency,
                x.r.Reasons, x.p.DefaultShelfLifeHours))
            .OrderBy(r => urgencyOrder[r.Urgency]).ThenBy(r => r.DaysOfCover ?? double.MaxValue)
            .ToList();
    }

    // ───────────── Блюда, заказы ─────────────

    public async Task<IReadOnlyList<DishDto>> GetDishesAsync(bool includeInactive, CancellationToken ct)
    {
        var s = await warehouse.LoadSnapshotAsync(Now, ct);
        var all = await db.Dishes.AsNoTracking().Include(d => d.Ingredients).OrderBy(d => d.Name).ToListAsync(ct);
        var openStops = await db.StopListEntries.AsNoTracking().Where(e => e.EndedAt == null).ToDictionaryAsync(e => e.DishId, e => e.StartedAt, ct);
        var hot = HotOfferCalculator.Calculate(s).Offers.ToDictionary(o => o.DishId, o => o.Level);
        var atRisk = s.Stock.Where(kv => kv.Value.AtRisk > 0).Select(kv => kv.Key).ToHashSet();
        return all.Where(d => includeInactive || d.IsActive).Select(d =>
        {
            var a = d.IsActive ? s.DishAvailability[d.Id] : StockEngine.EvaluateDish(d, s.Stock);
            var ingredients = d.Ingredients.Select(i =>
            {
                var p = s.Products[i.ProductId];
                var st = s.Stock[p.Id];
                return new DishIngredientDto(p.Id, p.Name, p.Unit, p.Icon, i.QuantityPerServing, st.Available,
                    (int)Math.Floor(st.Available / i.QuantityPerServing), Math.Max(0, i.QuantityPerServing - st.Available), st.Expired, atRisk.Contains(p.Id));
            }).OrderBy(i => i.ServingsPossible).ToList();
            return new DishDto(d.Id, d.Name, d.Description, d.Category, d.Icon, d.IsActive, a.MaxServings, a.IsAvailable,
                a.LimitingProductId, a.LimitingProductId is { } lp ? s.Products[lp].Name : null, ingredients,
                openStops.TryGetValue(d.Id, out var since) ? since : null, hot.GetValueOrDefault(d.Id));
        }).ToList();
    }

    public async Task<OrderDto?> GetOrderAsync(Guid id, CancellationToken ct)
    {
        var o = await db.Orders.AsNoTracking().Include(x => x.Lines).Include(x => x.Shortages).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (o is null) return null;
        var icons = await db.Dishes.AsNoTracking().ToDictionaryAsync(d => d.Id, d => d.Icon, ct);
        var products = await db.Products.AsNoTracking().ToDictionaryAsync(p => p.Id, ct);
        var moves = await db.Movements.AsNoTracking().Where(m => m.OrderId == id).ToListAsync(ct);
        var batchIds = moves.Select(m => m.BatchId).OfType<int>().ToList();
        var batches = await db.Batches.AsNoTracking().Where(b => batchIds.Contains(b.Id)).ToDictionaryAsync(b => b.Id, ct);
        var consumption = moves.Select(m =>
        {
            var b = m.BatchId is { } bid ? batches.GetValueOrDefault(bid) : null;
            return new ConsumptionDto(m.ProductId, products[m.ProductId].Name, products[m.ProductId].Unit, b?.Code, b?.ExpiresAt, -m.Quantity);
        }).OrderBy(c => c.ProductName).ThenBy(c => c.BatchExpiresAt).ToList();
        return ToOrderDto(o, icons, consumption);
    }

    public static OrderDto ToOrderDto(Order o, IReadOnlyDictionary<int, string> icons, IReadOnlyList<ConsumptionDto>? consumption) =>
        new(o.Id, o.Number, o.CreatedAt, o.Status == OrderStatus.Completed ? "completed" : "rejected", o.RejectionReason, o.Source,
            o.Lines.Select(l => new OrderLineDto(l.DishId, l.DishName, icons.GetValueOrDefault(l.DishId, "🍽️"), l.Servings)).ToList(),
            o.Shortages.Select(s => new ShortageDto(s.ProductId, s.ProductName, s.Unit, s.Required, s.Available, s.Missing, s.ExpiredExcluded)).ToList(),
            consumption, o.Title, o.Comment);

    public async Task<IReadOnlyList<OrderDto>> GetOrdersAsync(string? status, string? search, int limit, CancellationToken ct)
    {
        var icons = await db.Dishes.AsNoTracking().ToDictionaryAsync(d => d.Id, d => d.Icon, ct);
        var q = db.Orders.AsNoTracking().Include(x => x.Lines).Include(x => x.Shortages).AsQueryable();
        if (status == "completed") q = q.Where(o => o.Status == OrderStatus.Completed);
        if (status == "rejected") q = q.Where(o => o.Status == OrderStatus.Rejected);
        var list = await q.OrderByDescending(o => o.CreatedAt).Take(Math.Clamp(limit, 1, 500)).AsSplitQuery().ToListAsync(ct);
        IEnumerable<Order> items = list;
        if (!string.IsNullOrWhiteSpace(search))
            items = items.Where(o => o.Number.Contains(search, StringComparison.OrdinalIgnoreCase)
                                     || (o.Title?.Contains(search, StringComparison.OrdinalIgnoreCase) ?? false)
                                     || o.Lines.Any(l => l.DishName.Contains(search, StringComparison.OrdinalIgnoreCase)));
        return items.Select(o => ToOrderDto(o, icons, null)).ToList();
    }

    public OrderCheckDto ToCheckDto(OrderEvaluation e, WarehouseSnapshot s)
    {
        var reqs = e.Requirements.Select(r =>
        {
            var p = s.Products[r.ProductId];
            var plan = r.Missing > 0 ? null : StockEngine.PlanFefo(s.BatchesByProduct[r.ProductId], r.Required, s.Now);
            return new RequirementDto(p.Id, p.Name, p.Unit, r.Required, r.Available, r.Missing, r.ExpiredExcluded,
                plan?.Select(a => new ConsumptionDto(p.Id, p.Name, p.Unit, a.Batch.Code, a.Batch.ExpiresAt, a.Quantity)).ToList() ?? []);
        }).OrderByDescending(r => r.Missing).ThenBy(r => r.ProductName).ToList();
        var reason = e.CanFulfill ? null : "Недостаточно: " + string.Join("; ", reqs.Where(r => r.Missing > 0)
            .Select(r => $"{r.ProductName} — не хватает {Units.Format(r.Missing, r.Unit)}"));
        return new OrderCheckDto(e.CanFulfill, reqs, reason);
    }

    // ───────────── Стоп-лист и горячие предложения ─────────────

    public async Task<StopListDto> GetStopListAsync(CancellationToken ct)
    {
        var s = await warehouse.LoadSnapshotAsync(Now, ct);
        var openStops = await db.StopListEntries.AsNoTracking().Where(e => e.EndedAt == null).ToDictionaryAsync(e => e.DishId, e => e.StartedAt, ct);
        var items = s.StopList.Select(d => new StopItemDto(d.Id, d.Name, d.Icon, d.Category, openStops.TryGetValue(d.Id, out var since) ? since : null,
            s.DishAvailability[d.Id].Missing.Select(m =>
            {
                var p = s.Products[m.ProductId];
                return new StopMissingDto(p.Id, p.Name, p.Unit, p.Icon, m.Required, m.Available, m.Missing, m.ExpiredExcluded);
            }).ToList())).ToList();

        var forecasts = await ForecastAsync(s, s.Products.Keys, ct);
        var predictions = s.Dishes.Where(d => s.DishAvailability[d.Id].IsAvailable)
            .Select(d => Forecasting.ForecastDishStop(s, d, forecasts))
            .Where(f => f.PredictedAt is not null && f.CauseProductId is not null)
            .OrderBy(f => f.HoursUntil)
            .Select(f =>
            {
                var d = s.Dishes.First(x => x.Id == f.DishId);
                return new StopForecastDto(d.Id, d.Name, d.Icon, s.DishAvailability[d.Id].MaxServings, Math.Round(f.HoursUntil!.Value, 1),
                    f.PredictedAt!.Value, f.CauseProductId!.Value, s.Products[f.CauseProductId.Value].Name);
            }).ToList();

        var since24 = s.Now.AddHours(-24);
        var dishMap = await db.Dishes.AsNoTracking().ToDictionaryAsync(d => d.Id, ct);
        var returned = (await db.StopListEntries.AsNoTracking().Where(e => e.EndedAt != null).ToListAsync(ct))
            .Where(e => e.EndedAt >= since24 && !openStops.ContainsKey(e.DishId))
            .OrderByDescending(e => e.EndedAt)
            .DistinctBy(e => e.DishId)
            .Select(e => new StopReturnDto(e.DishId, dishMap[e.DishId].Name, dishMap[e.DishId].Icon, e.StartedAt, e.EndedAt!.Value))
            .ToList();

        return new StopListDto(items, predictions, returned, s.Dishes.Count);
    }

    public async Task<HotOffersDto> GetHotOffersAsync(CancellationToken ct)
    {
        var s = await warehouse.LoadSnapshotAsync(Now, ct);
        var result = HotOfferCalculator.Calculate(s);
        var dishes = s.Dishes.ToDictionary(d => d.Id);
        return new HotOffersDto(
            result.Offers.Select(o =>
            {
                var d = dishes[o.DishId];
                return new HotOfferDto(d.Id, d.Name, d.Icon, d.Description, o.Score, o.Level, o.MaxServings, o.RecommendedServings,
                    o.LimitingProductId is { } lp ? s.Products[lp].Name : null, o.Summary,
                    o.Ingredients.Select(i =>
                    {
                        var p = s.Products[i.ProductId];
                        return new HotIngredientDto(p.Id, p.Name, p.Unit, p.Icon, i.AtRiskQuantity, Math.Round(i.HoursLeft, 1), i.EarliestBatchCode,
                            ExpiryName(i.State), i.PerServing, i.ServingsToClear, i.UsableServings, i.RescuedQuantity,
                            Math.Round(i.Urgency, 2), Math.Round(i.Volume, 2), Math.Round(i.Coverage, 2), Math.Round(i.Exclusivity, 2),
                            i.OtherDishCount, i.Contribution, i.Explanation);
                    }).ToList());
            }).ToList(),
            result.Blocked.Select(b => new BlockedOfferDto(b.DishId, dishes[b.DishId].Name, dishes[b.DishId].Icon,
                b.AtRiskProductIds.Select(id => s.Products[id].Name).ToList(),
                b.MissingProductIds.Select(id => s.Products[id].Name).ToList())).ToList(),
            "вклад ингредиента = 100 × срочность × (0,35 + 0,65 × покрытие) × (0,5 + 0,5 × объём) × эксклюзивность; приоритет блюда = сумма вкладов");
    }

    // ───────────── Предупреждения ─────────────

    public async Task<IReadOnlyList<AlertDto>> GetAlertsAsync(string? status, int limit, CancellationToken ct)
    {
        var q = db.Alerts.AsNoTracking().AsQueryable();
        q = status switch
        {
            "active" => q.Where(a => a.Status == AlertStatus.Active),
            "open" => q.Where(a => a.Status != AlertStatus.Resolved),
            "acknowledged" => q.Where(a => a.Status == AlertStatus.Acknowledged),
            "resolved" => q.Where(a => a.Status == AlertStatus.Resolved),
            _ => q,
        };
        var list = await q.OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.Id).Take(Math.Clamp(limit, 1, 1000)).ToListAsync(ct);
        return list.OrderByDescending(a => a.Status == AlertStatus.Active).ThenByDescending(a => a.Severity).ThenByDescending(a => a.CreatedAt)
            .Select(a => new AlertDto(a.Id, a.Type.ToString(), a.Severity.ToString().ToLowerInvariant(), a.Title, a.Message, a.CreatedAt,
                a.Status.ToString().ToLowerInvariant(), a.AcknowledgedAt, a.ResolvedAt, a.ProductId, a.BatchId, a.DishId, a.OrderId))
            .ToList();
    }

    // ───────────── Сводка и настройки ─────────────

    public SettingsDto ToSettingsDto(WarehouseSettings s) =>
        new(s.SoonHours, s.CriticalHours, s.AutoWriteOffExpired, s.TimeZone, s.ForecastWindowDays, s.SupplyCoverDays,
            s.GeneratorEnabled, s.GeneratorIntervalSeconds, config["Database:Provider"] ?? "sqlite");

    public async Task<SummaryDto> GetSummaryAsync(CancellationToken ct)
    {
        var settings = await warehouse.GetSettingsAsync(ct);
        var s = await warehouse.LoadSnapshotAsync(Now, ct, thresholds: settings.Thresholds);
        var tz = TimeZones.Resolve(settings.TimeZone);
        var localMidnight = TimeZones.LocalToUtc(TimeZones.UtcToLocal(s.Now, tz).Date, tz);
        var today = await db.Orders.AsNoTracking().Where(o => o.CreatedAt >= localMidnight).Select(o => o.Status).ToListAsync(ct);
        var alerts = await db.Alerts.AsNoTracking().Where(a => a.Status == AlertStatus.Active).Select(a => a.Severity).ToListAsync(ct);
        var usable = s.ActiveBatches.Where(b => b.QuantityRemaining > 0).ToList();
        return new SummaryDto(
            s.Now, settings.TimeZone, bus.Version,
            s.Products.Count, s.Stock.Values.Count(x => x.Available > 0), usable.Count,
            s.Products.Values.Count(p => s.Stock[p.Id].Risk != ProductRisk.Ok || s.ProductsBlockingDishes.Contains(p.Id)),
            usable.Count(b => s.StateOf(b) is ExpiryState.Soon), usable.Count(b => s.StateOf(b) is ExpiryState.Critical),
            usable.Count(b => s.StateOf(b) is ExpiryState.Expired),
            s.StopList.Count(), s.Dishes.Count,
            alerts.Count, alerts.Count(a => a == AlertSeverity.Critical),
            today.Count(x => x == OrderStatus.Completed), today.Count(x => x == OrderStatus.Rejected),
            HotOfferCalculator.Calculate(s).Offers.Count,
            s.Products.Values.Select(p => p.Category).Distinct().Order().ToList(),
            ToSettingsDto(settings));
    }

    // ───────────── Прогноз и статистика ─────────────

    private async Task<Dictionary<int, ProductForecast>> ForecastAsync(WarehouseSnapshot s, IEnumerable<int> productIds, CancellationToken ct)
    {
        var settings = await warehouse.GetSettingsAsync(ct);
        var windowStart = s.Now.AddDays(-settings.ForecastWindowDays);
        var ids = productIds.ToList();
        var consumed = (await db.Movements.AsNoTracking()
                .Where(m => m.Type == MovementType.Consumption && ids.Contains(m.ProductId))
                .Select(m => new { m.ProductId, m.Quantity, m.CreatedAt })
                .ToListAsync(ct))
            .Where(m => m.CreatedAt >= windowStart && m.CreatedAt <= s.Now)
            .GroupBy(m => m.ProductId)
            .ToDictionary(g => g.Key, g => -g.Sum(x => x.Quantity));
        var first = await db.Movements.AsNoTracking().OrderBy(m => m.Id).Select(m => (DateTime?)m.CreatedAt).FirstOrDefaultAsync(ct);
        var observedDays = first is null ? 0 : Math.Min(settings.ForecastWindowDays, (s.Now - first.Value).TotalDays);
        return ids.ToDictionary(id => id, id => Forecasting.ForecastProduct(s, id, consumed.GetValueOrDefault(id), observedDays));
    }

    public async Task<StatsDto> GetStatsAsync(int days, string? category, CancellationToken ct)
    {
        days = Math.Clamp(days, 1, 90);
        var settings = await warehouse.GetSettingsAsync(ct);
        var s = await warehouse.LoadSnapshotAsync(Now, ct, thresholds: settings.Thresholds);
        var tz = TimeZones.Resolve(settings.TimeZone);
        var localToday = TimeZones.UtcToLocal(s.Now, tz).Date;
        var from = TimeZones.LocalToUtc(localToday.AddDays(-(days - 1)), tz);
        bool InCategory(int productId) => string.IsNullOrWhiteSpace(category) || s.Products[productId].Category == category;
        var products = s.Products.Values.Where(p => !p.IsArchived && InCategory(p.Id)).ToList();

        var movements = (await db.Movements.AsNoTracking().ToListAsync(ct))
            .Where(m => m.CreatedAt >= from && m.CreatedAt <= s.Now && InCategory(m.ProductId)).ToList();
        var orders = (await db.Orders.AsNoTracking().Include(o => o.Shortages).Include(o => o.Lines).AsSplitQuery().ToListAsync(ct))
            .Where(o => o.CreatedAt >= from).ToList();
        var dishes = await db.Dishes.AsNoTracking().Include(d => d.Ingredients).ToListAsync(ct);
        // Заказ относится к категории, если хотя бы одно блюдо использует продукт этой категории.
        bool OrderInCategory(Order o) => string.IsNullOrWhiteSpace(category) ||
            o.Lines.Any(l => dishes.FirstOrDefault(d => d.Id == l.DishId)?.Ingredients.Any(i => InCategory(i.ProductId)) == true);
        orders = orders.Where(OrderInCategory).ToList();

        string Day(DateTime utc) => TimeZones.UtcToLocal(utc, tz).ToString("yyyy-MM-dd");
        var daily = Enumerable.Range(0, days).Select(i => localToday.AddDays(-(days - 1) + i).ToString("yyyy-MM-dd")).Select(d =>
        {
            var dm = movements.Where(m => Day(m.CreatedAt) == d).ToList();
            var dOrders = orders.Where(o => Day(o.CreatedAt) == d).ToList();
            return new DayPointDto(d,
                dm.Count(m => m.Type == MovementType.Receipt),
                dm.Where(m => m.Type == MovementType.Receipt).Select(m => m.SupplyId).Distinct().Count(),
                dOrders.Count(o => o.Status == OrderStatus.Completed),
                dOrders.Count(o => o.Status == OrderStatus.Rejected),
                dm.Count(m => m.Type is MovementType.ExpiredWriteOff or MovementType.SpoilageWriteOff),
                dm.Count(m => m.Type == MovementType.Consumption));
        }).ToList();

        var flows = products.Select(p =>
        {
            var pm = movements.Where(m => m.ProductId == p.Id).ToList();
            var received = pm.Where(m => m.Type == MovementType.Receipt).Sum(m => m.Quantity);
            var expired = -pm.Where(m => m.Type == MovementType.ExpiredWriteOff).Sum(m => m.Quantity);
            var spoiled = -pm.Where(m => m.Type == MovementType.SpoilageWriteOff).Sum(m => m.Quantity);
            var consumed = -pm.Where(m => m.Type == MovementType.Consumption).Sum(m => m.Quantity);
            var adjusted = pm.Where(m => m.Type is MovementType.AdjustmentPlus or MovementType.AdjustmentMinus).Sum(m => m.Quantity);
            var basis = consumed + expired + spoiled;
            return new ProductFlowDto(p.Id, p.Name, p.Unit, p.Icon, p.Category, received, consumed, expired, spoiled, adjusted,
                basis == 0 ? 0 : Math.Round((double)((expired + spoiled) / basis), 3));
        }).Where(f => f.Received + f.Consumed + f.ExpiredWrittenOff + f.SpoilageWrittenOff != 0)
          .OrderByDescending(f => f.WasteRatio).ThenBy(f => f.Name).ToList();

        var rejected = orders.Where(o => o.Status == OrderStatus.Rejected).ToList();
        var deficits = products.Select(p =>
        {
            var shortages = rejected.SelectMany(o => o.Shortages).Where(x => x.ProductId == p.Id).ToList();
            var blockedNow = s.Dishes.Count(d => s.DishAvailability[d.Id].Missing.Any(m => m.ProductId == p.Id));
            var below = s.Stock[p.Id].BelowMinimum;
            var score = shortages.Count * 3 + blockedNow * 5 + (below ? 2 : 0);
            return new DeficitDto(p.Id, p.Name, p.Unit, p.Icon, shortages.Count, shortages.Sum(x => x.Missing), blockedNow, below, score);
        }).Where(d => d.Score > 0).OrderByDescending(d => d.Score).ThenBy(d => d.Name).Take(10).ToList();

        var entries = (await db.StopListEntries.AsNoTracking().ToListAsync(ct))
            .Where(e => (e.EndedAt ?? s.Now) >= from).ToList();
        var stopFrequency = entries.GroupBy(e => e.DishId).Select(g =>
        {
            var d = dishes.First(x => x.Id == g.Key);
            var hours = g.Sum(e => ((e.EndedAt ?? s.Now) - (e.StartedAt < from ? from : e.StartedAt)).TotalHours);
            return new StopFrequencyDto(d.Id, d.Name, d.Icon, g.Count(), Math.Round(hours, 1), g.Any(e => e.EndedAt == null));
        }).Where(x => string.IsNullOrWhiteSpace(category) || dishes.First(d => d.Id == x.DishId).Ingredients.Any(i => InCategory(i.ProductId)))
          .OrderByDescending(x => x.Entries).ThenByDescending(x => x.TotalHours).ToList();

        var forecasts = await ForecastAsync(s, products.Select(p => p.Id), ct);
        var depletion = products.Select(p => (p, f: forecasts[p.Id]))
            .Where(x => x.f.HasData)
            .Select(x => new DepletionForecastDto(x.p.Id, x.p.Name, x.p.Unit, x.p.Icon, s.Stock[x.p.Id].Available, x.f.DailyUsage,
                x.f.HoursToDepletion is { } h ? Math.Round(h, 1) : null, x.f.DepletionAt, x.f.ExpectedLoss,
                x.f.Series.Select(pt => new ForecastPointDto(pt.At, pt.Usable)).ToList()))
            .OrderBy(x => x.HoursToDepletion ?? double.MaxValue).ToList();
        var allForecasts = await ForecastAsync(s, s.Products.Keys, ct);
        var stopForecast = s.Dishes.Where(d => s.DishAvailability[d.Id].IsAvailable)
            .Select(d => Forecasting.ForecastDishStop(s, d, allForecasts))
            .Where(f => f.PredictedAt is not null && f.CauseProductId is not null && InCategory(f.CauseProductId.Value))
            .OrderBy(f => f.HoursUntil)
            .Select(f =>
            {
                var d = s.Dishes.First(x => x.Id == f.DishId);
                return new StopForecastDto(d.Id, d.Name, d.Icon, s.DishAvailability[d.Id].MaxServings, Math.Round(f.HoursUntil!.Value, 1),
                    f.PredictedAt!.Value, f.CauseProductId!.Value, s.Products[f.CauseProductId.Value].Name);
            }).ToList();

        var usableBatches = s.ActiveBatches.Where(b => b.QuantityRemaining > 0 && InCategory(b.ProductId)).ToList();
        var totals = new StatsTotalsDto(
            products.Count,
            products.Count(p => s.Stock[p.Id].Available > 0),
            usableBatches.Count,
            products.Count(p => s.Stock[p.Id].AtRisk > 0),
            usableBatches.Count(b => s.StateOf(b) is ExpiryState.Soon or ExpiryState.Critical),
            products.Count(p => s.Stock[p.Id].Expired > 0),
            usableBatches.Count(b => s.StateOf(b) == ExpiryState.Expired),
            orders.Count(o => o.Status == OrderStatus.Completed),
            rejected.Count,
            movements.Where(m => m.Type == MovementType.Receipt).Select(m => m.SupplyId).Distinct().Count(),
            movements.Count(m => m.Type == MovementType.Receipt),
            movements.Count(m => m.Type is MovementType.ExpiredWriteOff or MovementType.SpoilageWriteOff));

        return new StatsDto(days, category, totals, daily, flows, deficits, stopFrequency, depletion, stopForecast,
            depletion.Count > 0);
    }
}
