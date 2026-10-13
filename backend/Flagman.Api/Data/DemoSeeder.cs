using Flagman.Api.Domain;
using Flagman.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Api.Data;

/// <summary>
/// Демонстрационные данные. История не «рисуется» вручную: поставки, заказы и списания за последнюю неделю
/// проигрываются через те же команды <see cref="WarehouseService"/>, поэтому партии, журнал движения,
/// стоп-лист и статистика гарантированно согласованы между собой.
/// </summary>
public static class DemoSeeder
{
    private sealed record P(string Sku, string Name, string Category, string Unit, decimal Min, int? ShelfHours, string Icon);

    private static readonly P[] Products =
    [
        new("CHK", "Куриное филе", "Мясо и птица", "kg", 5, 120, "🍗"),
        new("BEF", "Говядина (вырезка)", "Мясо и птица", "kg", 4, 144, "🥩"),
        new("FSH", "Филе лосося", "Рыба", "kg", 2, 72, "🐟"),
        new("MLK", "Молоко 3,2%", "Молочные продукты", "l", 4, 120, "🥛"),
        new("CRM", "Сливки 33%", "Молочные продукты", "l", 2, 120, "🫙"),
        new("SCR", "Сметана 20%", "Молочные продукты", "kg", 1, 168, "🥣"),
        new("CHS", "Сыр твёрдый", "Молочные продукты", "kg", 1.5m, 336, "🧀"),
        new("BTR", "Сливочное масло", "Молочные продукты", "kg", 1, 240, "🧈"),
        new("EGG", "Яйца С0", "Яйца", "pcs", 60, 336, "🥚"),
        new("TOM", "Помидоры", "Овощи и зелень", "kg", 3, 120, "🍅"),
        new("CUC", "Огурцы", "Овощи и зелень", "kg", 2, 120, "🥒"),
        new("POT", "Картофель", "Овощи и зелень", "kg", 10, 720, "🥔"),
        new("ONI", "Лук репчатый", "Овощи и зелень", "kg", 2, 720, "🧅"),
        new("GRN", "Зелень (укроп, петрушка)", "Овощи и зелень", "kg", 0.3m, 72, "🌿"),
        new("LET", "Салат романо", "Овощи и зелень", "kg", 1, 96, "🥬"),
        new("RIC", "Рис басмати", "Бакалея", "kg", 5, 4320, "🍚"),
        new("FLR", "Мука пшеничная", "Бакалея", "kg", 5, 4320, "🌾"),
        new("PST", "Спагетти", "Бакалея", "kg", 3, 4320, "🍝"),
    ];

    private sealed record D(string Name, string Category, string Icon, string Description, (string Sku, decimal Qty)[] Recipe);

    private static readonly D[] Dishes =
    [
        new("Цезарь с курицей", "Салаты", "🥗", "Романо, куриное филе, пармезан, томаты черри и яйцо пашот.",
            [("CHK", 0.12m), ("LET", 0.08m), ("CHS", 0.025m), ("TOM", 0.04m), ("EGG", 1)]),
        new("Салат из свежих овощей", "Салаты", "🍅", "Томаты, огурцы, красный лук и зелень со сметанной заправкой.",
            [("TOM", 0.12m), ("CUC", 0.1m), ("ONI", 0.02m), ("GRN", 0.01m), ("SCR", 0.04m)]),
        new("Паста карбонара", "Горячее", "🍝", "Спагетти в сливочном соусе с желтком и сыром.",
            [("PST", 0.12m), ("CRM", 0.08m), ("CHS", 0.03m), ("EGG", 1), ("BTR", 0.01m)]),
        new("Курица в сливочном соусе с рисом", "Горячее", "🍛", "Филе в сливках с зеленью, гарнир — басмати.",
            [("CHK", 0.18m), ("CRM", 0.1m), ("RIC", 0.08m), ("BTR", 0.015m), ("GRN", 0.005m)]),
        new("Стейк из говядины с картофелем", "Горячее", "🥩", "Вырезка на гриле, запечённый картофель, масло с зеленью.",
            [("BEF", 0.25m), ("POT", 0.2m), ("BTR", 0.02m), ("GRN", 0.005m)]),
        new("Бефстроганов с пюре", "Горячее", "🍲", "Говядина в сливочно-луковом соусе, картофельное пюре.",
            [("BEF", 0.15m), ("CRM", 0.06m), ("ONI", 0.04m), ("POT", 0.18m), ("MLK", 0.03m), ("BTR", 0.015m)]),
        new("Лосось на гриле с рисом", "Горячее", "🍱", "Филе лосося, рис басмати, сливочное масло с укропом.",
            [("FSH", 0.18m), ("RIC", 0.08m), ("BTR", 0.015m), ("GRN", 0.005m)]),
        new("Сливочная уха", "Супы", "🥘", "Лосось, картофель и лук в сливочном бульоне.",
            [("FSH", 0.1m), ("CRM", 0.08m), ("POT", 0.1m), ("ONI", 0.02m), ("GRN", 0.005m)]),
        new("Блины со сметаной", "Завтраки", "🥞", "Тонкие блины на молоке, подаются со сметаной.",
            [("FLR", 0.08m), ("MLK", 0.15m), ("EGG", 1), ("BTR", 0.01m), ("SCR", 0.05m)]),
        new("Омлет с сыром", "Завтраки", "🍳", "Омлет из трёх яиц на молоке с тёртым сыром.",
            [("EGG", 3), ("MLK", 0.05m), ("CHS", 0.03m), ("BTR", 0.01m)]),
        new("Драники", "Завтраки", "🫓", "Картофельные оладьи с луком, подаются со сметаной.",
            [("POT", 0.25m), ("EGG", 1), ("FLR", 0.03m), ("ONI", 0.03m), ("SCR", 0.04m)]),
        new("Картофельное пюре", "Гарниры", "🍠", "Пюре на молоке со сливочным маслом.",
            [("POT", 0.25m), ("MLK", 0.05m), ("BTR", 0.02m)]),
    ];

    public static async Task EnsureSeededAsync(IServiceProvider sp, CancellationToken ct)
    {
        var db = sp.GetRequiredService<FlagmanDbContext>();
        await db.Database.EnsureCreatedAsync(ct);
        await SchemaPatches.ApplyAsync(db, ct);
        if (await db.Products.AnyAsync(ct)) return;
        await SeedAsync(sp, ct);
    }

    public static async Task SeedAsync(IServiceProvider sp, CancellationToken ct)
    {
        var db = sp.GetRequiredService<FlagmanDbContext>();
        var warehouse = sp.GetRequiredService<WarehouseService>();
        var now = warehouse.UtcNow;

        db.Settings.Add(new WarehouseSettings());
        var products = Products.Select(p => new Product
        {
            Sku = p.Sku, Name = p.Name, Category = p.Category, Unit = p.Unit, MinStock = p.Min, DefaultShelfLifeHours = p.ShelfHours, Icon = p.Icon,
        }).ToList();
        db.Products.AddRange(products);
        await db.SaveChangesAsync(ct);
        var id = products.ToDictionary(p => p.Sku, p => p.Id);

        db.Dishes.AddRange(Dishes.Select(d => new Dish
        {
            Name = d.Name, Category = d.Category, Icon = d.Icon, Description = d.Description,
            Ingredients = d.Recipe.Select(r => new DishIngredient { ProductId = id[r.Sku], QuantityPerServing = r.Qty }).ToList(),
        }));
        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();

        var tz = TimeZones.Resolve("Europe/Moscow");
        DateTime H(double hoursFromNow) => now.AddHours(hoursFromNow);
        SupplyLineInput L(string sku, decimal qty, double? expiresInHours = null) =>
            new(id[sku], qty, expiresInHours is { } e ? H(e) : null, null, null);

        // ── События истории (выполняются строго по времени) ──
        var events = new List<(DateTime At, Func<DateTime, Task> Run)>();

        void Supply(double at, string supplier, params SupplyLineInput[] lines) =>
            events.Add((H(at), t => warehouse.CreateSupplyAsync(new CreateSupplyCommand(null, supplier, null, lines, true), ct, t)));

        Supply(-170, "ООО «Агрокомплекс»",
            L("CHK", 12), L("BEF", 8), L("FSH", 3), L("MLK", 10), L("CRM", 6), L("SCR", 4), L("CHS", 3), L("BTR", 3),
            L("EGG", 180), L("TOM", 6), L("CUC", 4), L("POT", 30), L("ONI", 6), L("GRN", 0.6m), L("LET", 3),
            L("RIC", 10), L("FLR", 10), L("PST", 6));
        Supply(-100, "ООО «Северная ферма»",
            L("CHK", 8, 40), L("CRM", 6.5m, 10), L("MLK", 8, 30), L("TOM", 6, 50), L("LET", 3, 70), L("GRN", 0.5m, 18),
            L("EGG", 120), L("BEF", 6, 44));
        Supply(-50, "ИП Рыбный двор",
            L("FSH", 3.2m, -5), L("MLK", 4, -2), L("CUC", 3, 70), L("SCR", 4));
        Supply(-30, "ООО «Агрокомплекс»",
            L("CHK", 8, 96), L("BEF", 7, 130), L("CRM", 4, 60), L("CHS", 2), L("POT", 20), L("BTR", 2), L("PST", 4), L("RIC", 5), L("ONI", 4));
        Supply(-4, "ООО «Северная ферма»",
            L("CHK", 6.5m, 144), L("TOM", 4, 110), L("MLK", 6, 100), L("LET", 2, 90), L("GRN", 0.4m, 66));

        // Утреннее списание просрочки (кроме сегодняшнего дня — текущая просрочка остаётся видимой).
        var localNow = TimeZones.UtcToLocal(now, tz);
        for (var d = -7; d <= -1; d++)
        {
            var at = TimeZones.LocalToUtc(localNow.Date.AddDays(d).AddHours(8), tz);
            if (at > H(-170)) events.Add((at, t => warehouse.WriteOffExpiredAsync(false, ct, t)));
        }

        // Поток заказов: детерминированный, примерно 20 заказов в день с 11:00 до 23:00.
        var rnd = new Random(20261010);
        var dishIds = await db.Dishes.AsNoTracking().OrderBy(d => d.Id).Select(d => d.Id).ToListAsync(ct);
        for (var d = -7; d <= 0; d++)
        for (var hour = 11; hour < 23; hour++)
        for (var k = 0; k < 2; k++)
        {
            var at = TimeZones.LocalToUtc(localNow.Date.AddDays(d).AddHours(hour).AddMinutes(rnd.Next(0, 30) + k * 30), tz);
            var lines = Enumerable.Range(0, rnd.Next(1, 4)).Select(_ => new OrderLineInput(dishIds[rnd.Next(dishIds.Count)], rnd.Next(1, 3))).ToList();
            if (at <= H(-170) || at >= H(-0.4)) continue;
            events.Add((at, t => warehouse.PlaceOrderAsync(lines, "seed", ct, t)));
        }

        foreach (var (at, run) in events.OrderBy(e => e.At))
        {
            try { await run(at); }
            catch (DomainException) { /* отклонённые операции — часть истории */ }
            db.ChangeTracker.Clear();
        }

        // Инвентаризация: фактические остатки по нескольким позициям (создаёт демонстрационные ситуации).
        await SetAvailableAsync(db, warehouse, id["CUC"], 0.06m, H(-0.3), ct);
        await SetAvailableAsync(db, warehouse, id["EGG"], 34, H(-0.3), ct);
        await SetAvailableAsync(db, warehouse, id["CHK"], 18.5m, H(-0.3), ct);

        // Черновик поставки, которую можно принять в интерфейсе: вернёт блюда из стоп-листа.
        await warehouse.CreateSupplyAsync(new CreateSupplyCommand(null, "ИП Рыбный двор", "Ожидается к 09:00",
            [L("FSH", 4, 70), L("CUC", 3, 110)], false), ct, H(-0.2));

        // Старые предупреждения считаем уже просмотренными сменой.
        var staleBefore = H(-12);
        var stale = await db.Alerts.Where(a => a.Status == AlertStatus.Active && a.CreatedAt < staleBefore).ToListAsync(ct);
        foreach (var a in stale)
        {
            a.Status = AlertStatus.Acknowledged;
            a.AcknowledgedAt = a.CreatedAt.AddHours(1);
        }
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Приводит доступный остаток продукта к фактическому через корректировки партий (с записью в журнал).</summary>
    private static async Task SetAvailableAsync(FlagmanDbContext db, WarehouseService warehouse, int productId, decimal target, DateTime at, CancellationToken ct)
    {
        var usable = (await db.Batches.AsNoTracking().Where(b => b.ProductId == productId && b.State == BatchState.Active).ToListAsync(ct))
            .Where(b => StockEngine.IsUsable(b, at)).ToList();
        var diff = target - usable.Sum(b => b.QuantityRemaining);
        if (diff == 0) return;
        // Излишек относим на самую свежую партию; недостачу снимаем с самых свежих, чтобы сохранить срочные партии.
        foreach (var b in StockEngine.FefoOrder(usable).Reverse())
        {
            if (diff == 0) break;
            var next = diff > 0 ? b.QuantityRemaining + diff : Math.Max(0, b.QuantityRemaining + diff);
            diff -= next - b.QuantityRemaining;
            await warehouse.AdjustBatchAsync(b.Id, next, "Инвентаризация: фактический остаток", ct, at);
            db.ChangeTracker.Clear();
        }
    }
}
