using System.Globalization;
using Flagman.Api.Data;
using Flagman.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Api.Services;

public sealed record SupplyLineInput(int ProductId, decimal Quantity, DateTime? ExpiresAt, string? ExpiresAtLocal, int? ShelfLifeHours);
public sealed record CreateSupplyCommand(string? SupplyNumber, string? Supplier, string? Note, IReadOnlyList<SupplyLineInput>? Lines, bool ReceiveNow);
public sealed record OrderLineInput(int DishId, int Servings);

public static class OrderLimits
{
    public const int Title = 80;
    public const int Comment = 500;
}
public sealed record DishIngredientInput(int ProductId, decimal QuantityPerServing);
public sealed record UpdateDishCommand(string? Name, string? Description, string? Icon, string? Category, bool? IsActive, IReadOnlyList<DishIngredientInput>? Ingredients);
public sealed record CreateProductCommand(string? Name, string? Category, string? Unit, decimal MinStock, int? DefaultShelfLifeHours, string? Icon, string? Sku);
public sealed record SettingsCommand(int SoonHours, int CriticalHours, bool AutoWriteOffExpired, string? TimeZone, int ForecastWindowDays, int SupplyCoverDays, bool GeneratorEnabled, int GeneratorIntervalSeconds);

public sealed record OrderOutcome(Order Order, OrderEvaluation Evaluation, IReadOnlyList<(ProductBatch Batch, decimal Quantity)> Consumed);

/// <summary>
/// Все операции, которые меняют склад. Каждая идёт в одной транзакции, так что либо сохраняется всё, либо ничего.
/// </summary>
public sealed class WarehouseService(
    FlagmanDbContext db,
    WriteGate gate,
    TimeProvider clock,
    EventBus bus,
    ILogger<WarehouseService> logger)
{
    public const int MaxServingsPerLine = 200;

    public DateTime UtcNow => clock.GetUtcNow().UtcDateTime;

    public async Task<WarehouseSettings> GetSettingsAsync(CancellationToken ct) =>
        await db.Settings.AsNoTracking().FirstOrDefaultAsync(ct) ?? new WarehouseSettings();

    public async Task<WarehouseSnapshot> LoadSnapshotAsync(DateTime now, CancellationToken ct, bool tracking = false, ExpiryThresholds? thresholds = null)
    {
        var t = thresholds ?? (await GetSettingsAsync(ct)).Thresholds;
        var products = await db.Products.AsNoTracking().ToListAsync(ct);
        var batchQuery = db.Batches.Where(b => b.State == BatchState.Active);
        var batches = tracking ? await batchQuery.ToListAsync(ct) : await batchQuery.AsNoTracking().ToListAsync(ct);
        var dishes = await db.Dishes.AsNoTracking().Include(d => d.Ingredients).ToListAsync(ct);
        return WarehouseSnapshot.Build(products, batches, dishes, t, now);
    }

    // Поставки

    public Task<Supply> CreateSupplyAsync(CreateSupplyCommand cmd, CancellationToken ct, DateTime? at = null) =>
        ExecuteAsync("supply.created", at, async now =>
        {
            var settings = await GetSettingsAsync(ct);
            var tz = TimeZones.Resolve(settings.TimeZone);
            var lines = cmd.Lines ?? [];
            if (lines.Count == 0) throw DomainException.Invalid("lines", "Добавьте хотя бы один продукт в поставку.");
            if (lines.Count > 60) throw DomainException.Invalid("lines", "Слишком много позиций в одной поставке (максимум 60).");

            var productIds = lines.Select(l => l.ProductId).Distinct().ToList();
            var products = await db.Products.Where(p => productIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);

            var supplyLines = new List<SupplyLine>();
            for (var i = 0; i < lines.Count; i++)
            {
                var l = lines[i];
                var field = $"lines[{i}]";
                if (!products.TryGetValue(l.ProductId, out var product) || product.IsArchived)
                    throw DomainException.Invalid($"{field}.productId", "Продукт не найден.");
                if (l.Quantity <= 0 || l.Quantity > 100_000)
                    throw DomainException.Invalid($"{field}.quantity", $"{product.Name}: количество должно быть больше нуля.");
                if (Units.IsDiscrete(product.Unit) && l.Quantity != Math.Floor(l.Quantity))
                    throw DomainException.Invalid($"{field}.quantity", $"{product.Name}: учитывается в штуках — укажите целое число.");
                var expires = ResolveExpiry(l, product, now, tz, field);
                if (expires <= now)
                    throw DomainException.Invalid($"{field}.expiresAt", $"{product.Name}: срок годности партии уже истёк — такую партию нельзя принять.");
                supplyLines.Add(new SupplyLine { ProductId = product.Id, Quantity = l.Quantity, ExpiresAt = expires });
            }

            var number = string.IsNullOrWhiteSpace(cmd.SupplyNumber) ? await NextSupplyNumberAsync(now, tz, ct) : cmd.SupplyNumber.Trim();
            if (number.Length > 40) throw DomainException.Invalid("supplyNumber", "Номер поставки слишком длинный.");
            if (await db.Supplies.AnyAsync(s => s.SupplyNumber == number, ct))
                throw DomainException.Invalid("supplyNumber", $"Поставка с номером {number} уже существует.");

            var supply = new Supply
            {
                SupplyNumber = number,
                Supplier = (cmd.Supplier ?? "").Trim() is { Length: > 0 } sup ? sup[..Math.Min(sup.Length, 120)] : "Без поставщика",
                Note = string.IsNullOrWhiteSpace(cmd.Note) ? null : cmd.Note.Trim()[..Math.Min(cmd.Note.Trim().Length, 500)],
                CreatedAt = now,
                Status = SupplyStatus.Draft,
                Lines = supplyLines,
            };
            db.Supplies.Add(supply);
            await db.SaveChangesAsync(ct);

            if (cmd.ReceiveNow) await ReceiveInternalAsync(supply, now, tz, ct);
            return supply;
        }, ct);

    public Task<Supply> ReceiveSupplyAsync(Guid id, CancellationToken ct, DateTime? at = null) =>
        ExecuteAsync("supply.received", at, async now =>
        {
            var supply = await db.Supplies.Include(s => s.Lines).FirstOrDefaultAsync(s => s.Id == id, ct)
                ?? throw DomainException.NotFound("Поставка");
            var tz = TimeZones.Resolve((await GetSettingsAsync(ct)).TimeZone);
            await ReceiveInternalAsync(supply, now, tz, ct);
            return supply;
        }, ct);

    public Task<Supply> CancelSupplyAsync(Guid id, CancellationToken ct) =>
        ExecuteAsync("supply.cancelled", null, async _ =>
        {
            var supply = await db.Supplies.FirstOrDefaultAsync(s => s.Id == id, ct) ?? throw DomainException.NotFound("Поставка");
            if (supply.Status != SupplyStatus.Draft) throw DomainException.Conflict("Отменить можно только непринятую поставку.");
            supply.Status = SupplyStatus.Cancelled;
            return supply;
        }, ct);

    private async Task ReceiveInternalAsync(Supply supply, DateTime now, TimeZoneInfo tz, CancellationToken ct)
    {
        if (supply.Status != SupplyStatus.Draft)
            throw DomainException.Conflict($"Поставка {supply.SupplyNumber} уже {(supply.Status == SupplyStatus.Received ? "принята" : "отменена")}.");
        var products = await db.Products.ToDictionaryAsync(p => p.Id, ct);
        var expired = supply.Lines.Where(l => l.ExpiresAt <= now).ToList();
        if (expired.Count > 0)
            throw DomainException.Conflict("Нельзя принять партии с истёкшим сроком: " +
                string.Join(", ", expired.Select(l => products[l.ProductId].Name)) + ".");

        var seqByProduct = new Dictionary<int, int>();
        foreach (var line in supply.Lines.OrderBy(l => l.Id))
        {
            var product = products[line.ProductId];
            if (!seqByProduct.TryGetValue(product.Id, out var seq))
                seq = await db.Batches.CountAsync(b => b.ProductId == product.Id, ct);
            seqByProduct[product.Id] = ++seq;

            var batch = new ProductBatch
            {
                Code = $"{product.Sku}-{TimeZones.UtcToLocal(now, tz):ddMM}-{seq:00}",
                ProductId = product.Id,
                SupplyId = supply.Id,
                ReceivedAt = now,
                ExpiresAt = line.ExpiresAt,
                QuantityReceived = line.Quantity,
                QuantityRemaining = line.Quantity,
                State = BatchState.Active,
            };
            db.Batches.Add(batch);
            await db.SaveChangesAsync(ct); // нужен Id партии для журнала
            db.Movements.Add(new StockMovement
            {
                ProductId = product.Id,
                BatchId = batch.Id,
                Type = MovementType.Receipt,
                Quantity = line.Quantity,
                BatchBalanceAfter = line.Quantity,
                CreatedAt = now,
                SupplyId = supply.Id,
                Reason = $"Приёмка поставки {supply.SupplyNumber}",
            });
        }
        supply.Status = SupplyStatus.Received;
        supply.ReceivedAt = now;
    }

    private static DateTime ResolveExpiry(SupplyLineInput l, Product product, DateTime now, TimeZoneInfo tz, string field)
    {
        if (l.ExpiresAt is { } exp)
            return exp.Kind == DateTimeKind.Unspecified ? TimeZones.LocalToUtc(exp, tz) : exp.ToUniversalTime();
        if (!string.IsNullOrWhiteSpace(l.ExpiresAtLocal))
        {
            if (!DateTime.TryParse(l.ExpiresAtLocal, CultureInfo.InvariantCulture, DateTimeStyles.None, out var local))
                throw DomainException.Invalid($"{field}.expiresAtLocal", "Неверный формат даты окончания срока.");
            return TimeZones.LocalToUtc(local, tz);
        }
        var hours = l.ShelfLifeHours ?? product.DefaultShelfLifeHours;
        if (hours is null or <= 0)
            throw DomainException.Invalid($"{field}.expiresAt", $"{product.Name}: укажите срок годности партии.");
        return now.AddHours(hours.Value);
    }

    private async Task<string> NextSupplyNumberAsync(DateTime now, TimeZoneInfo tz, CancellationToken ct)
    {
        var count = await db.Supplies.CountAsync(ct);
        string number;
        do number = $"ПСТ-{TimeZones.UtcToLocal(now, tz):yyMMdd}-{++count:000}";
        while (await db.Supplies.AnyAsync(s => s.SupplyNumber == number, ct));
        return number;
    }

    // Заказы

    public Task<OrderOutcome> PlaceOrderAsync(IReadOnlyList<OrderLineInput>? lines, string source, CancellationToken ct, DateTime? at = null,
        string? title = null, string? comment = null) =>
        ExecuteAsync("order.placed", at, async now =>
        {
            var merged = ValidateOrderLines(lines);
            title = string.IsNullOrWhiteSpace(title) ? null : title.Trim();
            comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();
            if (title?.Length > OrderLimits.Title)
                throw DomainException.Invalid("title", $"Название заказа — не длиннее {OrderLimits.Title} символов.");
            if (comment?.Length > OrderLimits.Comment)
                throw DomainException.Invalid("comment", $"Комментарий — не длиннее {OrderLimits.Comment} символов.");
            var dishIds = merged.Keys.ToList();
            var dishes = await db.Dishes.AsNoTracking().Include(d => d.Ingredients)
                .Where(d => dishIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id, ct);
            foreach (var id in dishIds)
            {
                if (!dishes.TryGetValue(id, out var d)) throw DomainException.Invalid("lines", $"Блюдо #{id} не найдено.");
                if (!d.IsActive) throw DomainException.Invalid("lines", $"Блюдо «{d.Name}» выведено из меню.");
                if (d.Ingredients.Count == 0) throw DomainException.Invalid("lines", $"У блюда «{d.Name}» не задан состав.");
            }

            var snapshot = await LoadSnapshotAsync(now, ct, tracking: true);
            var orderLines = merged.Select(kv => (Dish: dishes[kv.Key], Servings: kv.Value)).ToList();
            var evaluation = StockEngine.EvaluateOrder(orderLines, snapshot.Stock);

            var order = new Order
            {
                Number = await NextOrderNumberAsync(ct),
                Title = title,
                Comment = comment,
                CreatedAt = now,
                Source = source,
                Lines = orderLines.Select(l => new OrderLine { DishId = l.Dish.Id, DishName = l.Dish.Name, Servings = l.Servings }).ToList(),
            };

            var consumed = new List<(ProductBatch, decimal)>();
            if (!evaluation.CanFulfill)
            {
                order.Status = OrderStatus.Rejected;
                order.Shortages = evaluation.Shortages.Select(s =>
                {
                    var p = snapshot.Products[s.ProductId];
                    return new OrderShortage
                    {
                        ProductId = p.Id, ProductName = p.Name, Unit = p.Unit,
                        Required = s.Required, Available = s.Available, Missing = s.Missing, ExpiredExcluded = s.ExpiredExcluded,
                    };
                }).ToList();
                order.RejectionReason = "Недостаточно ингредиентов: " + string.Join("; ", order.Shortages.Select(s =>
                    $"{s.ProductName} — нужно {Units.Format(s.Required, s.Unit)}, доступно {Units.Format(s.Available, s.Unit)}" +
                    (s.ExpiredExcluded > 0 ? $" (ещё {Units.Format(s.ExpiredExcluded, s.Unit)} просрочено и не используется)" : "")));
                db.Orders.Add(order);
                db.Alerts.Add(new Alert
                {
                    Type = AlertType.OrderRejected,
                    Severity = AlertSeverity.Warning,
                    Key = $"order:{order.Id}",
                    OrderId = order.Id,
                    ProductId = order.Shortages.Count == 1 ? order.Shortages[0].ProductId : null,
                    Title = $"Заказ {order.Number} отклонён",
                    Message = order.RejectionReason,
                    CreatedAt = now,
                });
                return new OrderOutcome(order, evaluation, consumed);
            }

            // Сначала строим полный план списания по FEFO, и только потом меняем партии.
            var plans = new List<(int ProductId, IReadOnlyList<BatchAllocation> Plan)>();
            foreach (var req in evaluation.Requirements)
            {
                var plan = StockEngine.PlanFefo(snapshot.BatchesByProduct[req.ProductId], req.Required, now)
                    ?? throw new InvalidOperationException($"FEFO-план не построен для продукта {req.ProductId}.");
                plans.Add((req.ProductId, plan));
            }

            order.Status = OrderStatus.Completed;
            db.Orders.Add(order);
            foreach (var (productId, plan) in plans)
            foreach (var alloc in plan)
            {
                var b = alloc.Batch;
                b.QuantityRemaining -= alloc.Quantity;
                if (b.QuantityRemaining < 0) throw new InvalidOperationException("Отрицательный остаток партии.");
                if (b.QuantityRemaining == 0) b.State = BatchState.Depleted;
                b.Version++;
                consumed.Add((b, alloc.Quantity));
                db.Movements.Add(new StockMovement
                {
                    ProductId = productId,
                    BatchId = b.Id,
                    Type = MovementType.Consumption,
                    Quantity = -alloc.Quantity,
                    BatchBalanceAfter = b.QuantityRemaining,
                    CreatedAt = now,
                    OrderId = order.Id,
                    Reason = $"Заказ {order.Number}",
                });
            }
            return new OrderOutcome(order, evaluation, consumed);
        }, ct);

    /// <summary>Проверка заказа без списания (для кнопки "Проверить").</summary>
    public async Task<(OrderEvaluation Evaluation, WarehouseSnapshot Snapshot)> CheckOrderAsync(IReadOnlyList<OrderLineInput>? lines, CancellationToken ct)
    {
        var merged = ValidateOrderLines(lines);
        var ids = merged.Keys.ToList();
        var dishes = await db.Dishes.AsNoTracking().Include(d => d.Ingredients).Where(d => ids.Contains(d.Id)).ToDictionaryAsync(d => d.Id, ct);
        if (dishes.Count != ids.Count) throw DomainException.Invalid("lines", "Одно из блюд не найдено.");
        var snapshot = await LoadSnapshotAsync(UtcNow, ct);
        return (StockEngine.EvaluateOrder(merged.Select(kv => (dishes[kv.Key], kv.Value)), snapshot.Stock), snapshot);
    }

    private static Dictionary<int, int> ValidateOrderLines(IReadOnlyList<OrderLineInput>? lines)
    {
        if (lines is null || lines.Count == 0) throw DomainException.Invalid("lines", "Заказ должен содержать хотя бы одно блюдо.");
        var merged = new Dictionary<int, int>();
        foreach (var l in lines)
        {
            if (l.Servings is <= 0 or > MaxServingsPerLine)
                throw DomainException.Invalid("lines", $"Количество порций должно быть от 1 до {MaxServingsPerLine}.");
            merged[l.DishId] = merged.GetValueOrDefault(l.DishId) + l.Servings;
        }
        return merged;
    }

    private async Task<string> NextOrderNumberAsync(CancellationToken ct)
    {
        var count = await db.Orders.CountAsync(ct);
        return $"ЗК-{count + 1:00000}";
    }

    // Партии: корректировки и списания

    public Task<ProductBatch> AdjustBatchAsync(int batchId, decimal newQuantity, string? reason, CancellationToken ct, DateTime? at = null) =>
        ExecuteAsync("batch.adjusted", at, async now =>
        {
            var b = await db.Batches.Include(x => x.Product).FirstOrDefaultAsync(x => x.Id == batchId, ct) ?? throw DomainException.NotFound("Партия");
            if (b.State != BatchState.Active) throw DomainException.Conflict("Корректировать можно только активную партию.");
            if (newQuantity < 0) throw DomainException.Invalid("quantity", "Остаток не может быть отрицательным.");
            if (Units.IsDiscrete(b.Product!.Unit) && newQuantity != Math.Floor(newQuantity))
                throw DomainException.Invalid("quantity", "Продукт учитывается в штуках — укажите целое число.");
            if (string.IsNullOrWhiteSpace(reason)) throw DomainException.Invalid("reason", "Укажите причину корректировки.");
            var delta = newQuantity - b.QuantityRemaining;
            if (delta == 0) throw DomainException.Invalid("quantity", "Новый остаток совпадает с текущим.");
            b.QuantityRemaining = newQuantity;
            if (newQuantity == 0) b.State = BatchState.Depleted;
            b.Version++;
            db.Movements.Add(new StockMovement
            {
                ProductId = b.ProductId, BatchId = b.Id,
                Type = delta > 0 ? MovementType.AdjustmentPlus : MovementType.AdjustmentMinus,
                Quantity = delta, BatchBalanceAfter = newQuantity, CreatedAt = now,
                Reason = reason.Trim()[..Math.Min(reason.Trim().Length, 200)],
            });
            return b;
        }, ct);

    public Task<ProductBatch> WriteOffBatchAsync(int batchId, decimal? quantity, string? reason, CancellationToken ct) =>
        ExecuteAsync("batch.written-off", null, async now =>
        {
            var b = await db.Batches.FirstOrDefaultAsync(x => x.Id == batchId, ct) ?? throw DomainException.NotFound("Партия");
            if (b.State != BatchState.Active || b.QuantityRemaining <= 0) throw DomainException.Conflict("В партии нет остатка для списания.");
            var qty = quantity ?? b.QuantityRemaining;
            if (qty <= 0 || qty > b.QuantityRemaining)
                throw DomainException.Invalid("quantity", "Нельзя списать больше, чем осталось в партии.");
            var expired = b.ExpiresAt <= now;
            b.QuantityRemaining -= qty;
            if (b.QuantityRemaining == 0) b.State = expired ? BatchState.WrittenOff : BatchState.Depleted;
            b.Version++;
            db.Movements.Add(new StockMovement
            {
                ProductId = b.ProductId, BatchId = b.Id,
                Type = expired ? MovementType.ExpiredWriteOff : MovementType.SpoilageWriteOff,
                Quantity = -qty, BatchBalanceAfter = b.QuantityRemaining, CreatedAt = now,
                Reason = string.IsNullOrWhiteSpace(reason) ? (expired ? "Списание просрочки" : "Порча") : reason.Trim(),
            });
            return b;
        }, ct);

    /// <summary>Списывает все просроченные остатки. Возвращает число списанных партий.</summary>
    public Task<int> WriteOffExpiredAsync(bool automatic, CancellationToken ct, DateTime? at = null) =>
        ExecuteAsync("batch.expired-written-off", at, now => WriteOffExpiredInternalAsync(automatic, now, ct), ct);

    private async Task<int> WriteOffExpiredInternalAsync(bool automatic, DateTime now, CancellationToken ct)
    {
        var expired = await db.Batches.Include(b => b.Product)
            .Where(b => b.State == BatchState.Active && b.QuantityRemaining > 0 && b.ExpiresAt <= now)
            .ToListAsync(ct);
        if (expired.Count == 0) return 0;
        var summary = string.Join(", ", expired.Select(b => $"{b.Product!.Name} {Units.Format(b.QuantityRemaining, b.Product.Unit)} ({b.Code})"));
        foreach (var b in expired)
        {
            db.Movements.Add(new StockMovement
            {
                ProductId = b.ProductId, BatchId = b.Id, Type = MovementType.ExpiredWriteOff,
                Quantity = -b.QuantityRemaining, BatchBalanceAfter = 0, CreatedAt = now,
                Reason = automatic ? "Автоматическое списание просрочки" : "Списание просрочки",
            });
            b.QuantityRemaining = 0;
            b.State = BatchState.WrittenOff;
            b.Version++;
        }
        db.Alerts.Add(new Alert
        {
            Type = AlertType.ExpiredWrittenOff,
            Severity = AlertSeverity.Info,
            Key = $"writeoff:{now.Ticks}",
            Title = $"Списано просроченных партий: {expired.Count}",
            Message = summary,
            CreatedAt = now,
            Status = automatic ? AlertStatus.Active : AlertStatus.Acknowledged,
            AcknowledgedAt = automatic ? null : now,
        });
        return expired.Count;
    }

    // Справочники

    public Task<Dish> UpdateDishAsync(int id, UpdateDishCommand cmd, CancellationToken ct) =>
        ExecuteAsync("dish.updated", null, async _ =>
        {
            var dish = await db.Dishes.Include(d => d.Ingredients).FirstOrDefaultAsync(d => d.Id == id, ct) ?? throw DomainException.NotFound("Блюдо");
            await ApplyDishAsync(dish, cmd, ct);
            return dish;
        }, ct);

    public Task<Dish> CreateDishAsync(UpdateDishCommand cmd, CancellationToken ct) =>
        ExecuteAsync("dish.created", null, async _ =>
        {
            if (string.IsNullOrWhiteSpace(cmd.Name)) throw DomainException.Invalid("name", "Укажите название блюда.");
            var dish = new Dish { Name = cmd.Name.Trim() };
            await ApplyDishAsync(dish, cmd, ct);
            db.Dishes.Add(dish);
            return dish;
        }, ct);

    private async Task ApplyDishAsync(Dish dish, UpdateDishCommand cmd, CancellationToken ct)
    {
        if (cmd.Name is not null)
        {
            if (string.IsNullOrWhiteSpace(cmd.Name) || cmd.Name.Length > 80) throw DomainException.Invalid("name", "Название: от 1 до 80 символов.");
            dish.Name = cmd.Name.Trim();
        }
        if (cmd.Description is not null) dish.Description = cmd.Description.Trim()[..Math.Min(cmd.Description.Trim().Length, 400)];
        if (!string.IsNullOrWhiteSpace(cmd.Icon)) dish.Icon = cmd.Icon.Trim()[..Math.Min(cmd.Icon.Trim().Length, 16)];
        if (cmd.Category is not null) dish.Category = cmd.Category.Trim();
        if (cmd.IsActive is { } active) dish.IsActive = active;
        if (cmd.Ingredients is not null)
        {
            if (cmd.Ingredients.Count == 0) throw DomainException.Invalid("ingredients", "Состав блюда не может быть пустым.");
            if (cmd.Ingredients.Select(i => i.ProductId).Distinct().Count() != cmd.Ingredients.Count)
                throw DomainException.Invalid("ingredients", "Продукт указан в составе дважды.");
            var ids = cmd.Ingredients.Select(i => i.ProductId).ToList();
            var products = await db.Products.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
            foreach (var ing in cmd.Ingredients)
            {
                if (!products.TryGetValue(ing.ProductId, out var p)) throw DomainException.Invalid("ingredients", $"Продукт #{ing.ProductId} не найден.");
                if (ing.QuantityPerServing <= 0 || ing.QuantityPerServing > 1000)
                    throw DomainException.Invalid("ingredients", $"{p.Name}: норма на порцию должна быть больше нуля.");
                if (Units.IsDiscrete(p.Unit) && ing.QuantityPerServing != Math.Floor(ing.QuantityPerServing))
                    throw DomainException.Invalid("ingredients", $"{p.Name}: учитывается в штуках — норма должна быть целой.");
            }
            dish.Ingredients.Clear();
            foreach (var ing in cmd.Ingredients)
                dish.Ingredients.Add(new DishIngredient { DishId = dish.Id, ProductId = ing.ProductId, QuantityPerServing = ing.QuantityPerServing });
        }
    }

    public Task<Product> CreateProductAsync(CreateProductCommand cmd, CancellationToken ct) =>
        ExecuteAsync("product.created", null, async _ =>
        {
            if (string.IsNullOrWhiteSpace(cmd.Name) || cmd.Name.Trim().Length > 120) throw DomainException.Invalid("name", "Укажите название продукта.");
            if (string.IsNullOrWhiteSpace(cmd.Category)) throw DomainException.Invalid("category", "Укажите категорию.");
            if (cmd.Unit is null || !Units.All.Contains(cmd.Unit)) throw DomainException.Invalid("unit", "Единица измерения: kg, g, l, ml или pcs.");
            if (cmd.MinStock < 0) throw DomainException.Invalid("minStock", "Минимальный остаток не может быть отрицательным.");
            if (cmd.DefaultShelfLifeHours is <= 0) throw DomainException.Invalid("defaultShelfLifeHours", "Срок хранения должен быть больше нуля.");
            var sku = string.IsNullOrWhiteSpace(cmd.Sku) ? $"PRD{await db.Products.CountAsync(ct) + 1:000}" : cmd.Sku.Trim().ToUpperInvariant();
            if (await db.Products.AnyAsync(p => p.Sku == sku, ct)) throw DomainException.Invalid("sku", $"Артикул {sku} уже занят.");
            var product = new Product
            {
                Sku = sku, Name = cmd.Name.Trim(), Category = cmd.Category.Trim(), Unit = cmd.Unit,
                MinStock = cmd.MinStock, DefaultShelfLifeHours = cmd.DefaultShelfLifeHours, Icon = string.IsNullOrWhiteSpace(cmd.Icon) ? "📦" : cmd.Icon.Trim(),
            };
            db.Products.Add(product);
            return product;
        }, ct);

    public Task<Product> UpdateMinStockAsync(int productId, decimal minStock, CancellationToken ct) =>
        ExecuteAsync("product.updated", null, async _ =>
        {
            if (minStock < 0) throw DomainException.Invalid("minStock", "Минимальный остаток не может быть отрицательным.");
            var p = await db.Products.FirstOrDefaultAsync(x => x.Id == productId, ct) ?? throw DomainException.NotFound("Продукт");
            p.MinStock = minStock;
            return p;
        }, ct);

    public Task<WarehouseSettings> UpdateSettingsAsync(SettingsCommand cmd, CancellationToken ct) =>
        ExecuteAsync("settings.updated", null, async _ =>
        {
            if (cmd.CriticalHours < 1 || cmd.CriticalHours > 24 * 14) throw DomainException.Invalid("criticalHours", "Критический порог: от 1 часа до 14 дней.");
            if (cmd.SoonHours <= cmd.CriticalHours || cmd.SoonHours > 24 * 30) throw DomainException.Invalid("soonHours", "Порог «скоро истекает» должен быть больше критического (до 30 дней).");
            if (cmd.ForecastWindowDays is < 1 or > 90) throw DomainException.Invalid("forecastWindowDays", "Окно прогноза: 1–90 дней.");
            if (cmd.SupplyCoverDays is < 1 or > 30) throw DomainException.Invalid("supplyCoverDays", "Запас поставки: 1–30 дней.");
            if (cmd.GeneratorIntervalSeconds is < 5 or > 3600) throw DomainException.Invalid("generatorIntervalSeconds", "Интервал генератора: 5–3600 секунд.");
            var tz = string.IsNullOrWhiteSpace(cmd.TimeZone) ? "Europe/Moscow" : cmd.TimeZone.Trim();
            if (!TimeZones.IsValid(tz)) throw DomainException.Invalid("timeZone", $"Неизвестный часовой пояс: {tz}.");
            var s = await db.Settings.FirstOrDefaultAsync(ct);
            if (s is null) db.Settings.Add(s = new WarehouseSettings());
            s.SoonHours = cmd.SoonHours;
            s.CriticalHours = cmd.CriticalHours;
            s.AutoWriteOffExpired = cmd.AutoWriteOffExpired;
            s.TimeZone = tz;
            s.ForecastWindowDays = cmd.ForecastWindowDays;
            s.SupplyCoverDays = cmd.SupplyCoverDays;
            s.GeneratorEnabled = cmd.GeneratorEnabled;
            s.GeneratorIntervalSeconds = cmd.GeneratorIntervalSeconds;
            return s;
        }, ct);

    // Предупреждения

    public Task<int> AcknowledgeAlertsAsync(IReadOnlyCollection<int>? ids, CancellationToken ct) =>
        ExecuteAsync("alerts.acknowledged", null, async now =>
        {
            var q = db.Alerts.Where(a => a.Status == AlertStatus.Active);
            if (ids is { Count: > 0 }) q = q.Where(a => ids.Contains(a.Id));
            var list = await q.ToListAsync(ct);
            foreach (var a in list)
            {
                a.Status = AlertStatus.Acknowledged;
                a.AcknowledgedAt = now;
            }
            return list.Count;
        }, ct);

    /// <summary>
    /// Периодическая задача: автосписание просрочки (если включено) и сверка предупреждений/стоп-листа
    /// с текущим временем - партии переходят между состояниями сами по себе, без действий пользователя.
    /// </summary>
    public async Task<bool> TickAsync(CancellationToken ct)
    {
        using var _ = await gate.AcquireAsync(ct);
        var now = UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var settings = await GetSettingsAsync(ct);
        var writtenOff = settings.AutoWriteOffExpired ? await WriteOffExpiredInternalAsync(true, now, ct) : 0;
        await db.SaveChangesAsync(ct);
        var changes = await AlertReconciler.ReconcileAsync(db, await LoadSnapshotAsync(now, ct, thresholds: settings.Thresholds), ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        if (writtenOff + changes == 0) return false;
        bus.Publish(writtenOff > 0 ? "batch.expired-written-off" : "monitor.tick", now);
        return true;
    }

    /// <summary>Единая обёртка команды: блокировка, транзакция, сверка предупреждений, уведомление клиентов.</summary>
    private async Task<T> ExecuteAsync<T>(string reason, DateTime? at, Func<DateTime, Task<T>> body, CancellationToken ct)
    {
        using var _ = await gate.AcquireAsync(ct);
        var now = at ?? UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            var result = await body(now);
            await db.SaveChangesAsync(ct);
            await AlertReconciler.ReconcileAsync(db, await LoadSnapshotAsync(now, ct), ct);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            if (at is null) bus.Publish(reason, now);
            return result;
        }
        catch (DbUpdateConcurrencyException ex)
        {
            db.ChangeTracker.Clear();
            logger.LogWarning(ex, "Конфликт версий при {Reason}", reason);
            throw DomainException.Conflict("Остатки изменились во время операции. Повторите действие.");
        }
        catch
        {
            // Откат транзакции происходит при Dispose; трекер очищаем, чтобы не сохранить "полуизменения".
            db.ChangeTracker.Clear();
            throw;
        }
    }
}
