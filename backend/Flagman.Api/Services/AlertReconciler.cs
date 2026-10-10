using Flagman.Api.Data;
using Flagman.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Api.Services;

/// <summary>
/// Приводит предупреждения и историю стоп-листа в соответствие с текущим срезом склада.
/// Условные предупреждения (сроки, остатки, стоп-лист) имеют ключ условия: пока условие выполняется —
/// существует ровно одно незакрытое предупреждение; когда исчезает — предупреждение закрывается автоматически.
/// </summary>
public static class AlertReconciler
{
    private static readonly AlertType[] ConditionTypes =
    [
        AlertType.ExpiringSoon, AlertType.ExpiryCritical, AlertType.Expired,
        AlertType.LowStock, AlertType.OutOfStock, AlertType.DishStopped,
    ];

    private sealed record Condition(AlertType Type, AlertSeverity Severity, string Title, string Message,
        int? ProductId = null, int? BatchId = null, int? DishId = null);

    public static Dictionary<string, Alert> BuildConditions(WarehouseSnapshot s)
    {
        var result = new Dictionary<string, Condition>();

        foreach (var b in s.ActiveBatches.Where(b => b.QuantityRemaining > 0))
        {
            var p = s.Products[b.ProductId];
            var qty = Units.Format(b.QuantityRemaining, p.Unit);
            var left = HotOfferCalculator.FormatHours(StockEngine.HoursLeft(b.ExpiresAt, s.Now));
            switch (s.StateOf(b))
            {
                case ExpiryState.Soon:
                    result[$"batch:{b.Id}:soon"] = new(AlertType.ExpiringSoon, AlertSeverity.Info,
                        $"{p.Name}: скоро истекает срок", $"Партия {b.Code}, {qty} — осталось {left}.", p.Id, b.Id);
                    break;
                case ExpiryState.Critical:
                    result[$"batch:{b.Id}:critical"] = new(AlertType.ExpiryCritical, AlertSeverity.Warning,
                        $"{p.Name}: критический срок", $"Партия {b.Code}, {qty} — осталось {left}. Используйте в первую очередь.", p.Id, b.Id);
                    break;
                case ExpiryState.Expired:
                    result[$"batch:{b.Id}:expired"] = new(AlertType.Expired, AlertSeverity.Critical,
                        $"{p.Name}: партия просрочена", $"Партия {b.Code}, {qty} исключена из доступного остатка и ждёт списания.", p.Id, b.Id);
                    break;
            }
        }

        foreach (var (id, st) in s.Stock)
        {
            var p = s.Products[id];
            if (p.IsArchived) continue;
            var used = s.DishUsageCount.ContainsKey(id);
            if (st.Available <= 0 && (used || p.MinStock > 0))
                result[$"product:{id}:out"] = new(AlertType.OutOfStock, AlertSeverity.Critical,
                    $"{p.Name}: нет в наличии", st.Expired > 0
                        ? $"Пригодного остатка нет; {Units.Format(st.Expired, p.Unit)} просрочено."
                        : "Пригодного остатка нет. Требуется поставка.", id);
            else if (st.BelowMinimum)
                result[$"product:{id}:low"] = new(AlertType.LowStock, AlertSeverity.Warning,
                    $"{p.Name}: малый остаток", $"Доступно {Units.Format(st.Available, p.Unit)} при минимуме {Units.Format(p.MinStock, p.Unit)}.", id);
        }

        foreach (var d in s.StopList)
        {
            var missing = s.DishAvailability[d.Id].Missing
                .Select(m => $"{s.Products[m.ProductId].Name} (нужно {Units.Format(m.Required, s.Products[m.ProductId].Unit)}, есть {Units.Format(m.Available, s.Products[m.ProductId].Unit)})");
            result[$"dish:{d.Id}:stop"] = new(AlertType.DishStopped, AlertSeverity.Critical,
                $"«{d.Name}» в стоп-листе", "Не хватает: " + string.Join(", ", missing) + ".", DishId: d.Id);
        }

        return result.ToDictionary(kv => kv.Key, kv => new Alert
        {
            Key = kv.Key,
            Type = kv.Value.Type,
            Severity = kv.Value.Severity,
            Title = kv.Value.Title,
            Message = kv.Value.Message,
            ProductId = kv.Value.ProductId,
            BatchId = kv.Value.BatchId,
            DishId = kv.Value.DishId,
            CreatedAt = s.Now,
        });
    }

    /// <returns>Количество созданных и закрытых записей (0 — ничего не изменилось).</returns>
    public static async Task<int> ReconcileAsync(FlagmanDbContext db, WarehouseSnapshot s, CancellationToken ct)
    {
        var changes = 0;
        var conditions = BuildConditions(s);
        var open = await db.Alerts
            .Where(a => a.Status != AlertStatus.Resolved && ConditionTypes.Contains(a.Type))
            .ToListAsync(ct);

        foreach (var alert in open)
        {
            if (conditions.Remove(alert.Key, out var current))
            {
                alert.Message = current.Message; // актуализируем текст (остаток, оставшееся время)
                continue;
            }
            alert.Status = AlertStatus.Resolved;
            alert.ResolvedAt = s.Now;
            changes++;
        }
        foreach (var fresh in conditions.Values)
        {
            db.Alerts.Add(fresh);
            changes++;
        }

        // История стоп-листа: открываем интервал при попадании блюда, закрываем при возврате.
        var stopped = s.StopList.ToDictionary(d => d.Id);
        var openEntries = await db.StopListEntries.Where(e => e.EndedAt == null).ToListAsync(ct);
        foreach (var e in openEntries)
        {
            if (stopped.Remove(e.DishId)) continue;
            e.EndedAt = s.Now;
            changes++;
        }
        foreach (var d in stopped.Values)
        {
            var reason = string.Join(", ", s.DishAvailability[d.Id].Missing.Select(m => s.Products[m.ProductId].Name));
            db.StopListEntries.Add(new StopListEntry { DishId = d.Id, StartedAt = s.Now, Reason = reason });
            changes++;
        }
        return changes;
    }
}
