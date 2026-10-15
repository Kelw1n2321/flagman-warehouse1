using System.Globalization;
using Flagman.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Api.Services;

/// <summary>ExpiresOn - дата окончания срока "yyyy-MM-dd" по времени ресторана (годно до конца этого дня).</summary>
public sealed record SupplierRequestLineInput(int ProductId, decimal Quantity, string? ExpiresOn);
public sealed record SupplierRequestCommand(IReadOnlyList<SupplierRequestLineInput>? Lines, string? Comment);
public sealed record AcceptLineInput(int LineId, decimal Quantity);
/// <summary>Lines - сколько фактически принято по каждой строке. Если не передать, принимается всё заявленное.</summary>
public sealed record AcceptSupplierRequestCommand(IReadOnlyList<AcceptLineInput>? Lines);
public sealed record RejectSupplierRequestCommand(string? Reason);

// Заявки поставщиков: поставщик отправляет, менеджер принимает (можно меньше заявленного) или отклоняет.
public sealed partial class WarehouseService
{
    public Task<SupplierRequest> CreateSupplierRequestAsync(SupplierRequestCommand cmd, string supplierKey, string supplierName,
        CancellationToken ct, DateTime? at = null) =>
        ExecuteAsync("supplier-request.created", at, async now =>
        {
            var tz = TimeZones.Resolve((await GetSettingsAsync(ct)).TimeZone);
            var lines = cmd.Lines ?? [];
            if (lines.Count == 0) throw DomainException.Invalid("lines", "Добавьте хотя бы один товар.");
            if (lines.Count > 60) throw DomainException.Invalid("lines", "Слишком много позиций в одной заявке (максимум 60).");
            var comment = string.IsNullOrWhiteSpace(cmd.Comment) ? null : cmd.Comment.Trim();
            if (comment?.Length > 500) throw DomainException.Invalid("comment", "Комментарий - не длиннее 500 символов.");

            var ids = lines.Select(l => l.ProductId).Distinct().ToList();
            var products = await db.Products.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
            var result = new List<SupplierRequestLine>();
            for (var i = 0; i < lines.Count; i++)
            {
                var l = lines[i];
                var field = $"lines[{i}]";
                if (!products.TryGetValue(l.ProductId, out var p) || p.IsArchived)
                    throw DomainException.Invalid($"{field}.productId", "Товар не найден.");
                if (l.Quantity <= 0 || l.Quantity > 100_000)
                    throw DomainException.Invalid($"{field}.quantity", $"{p.Name}: количество должно быть больше нуля.");
                if (Units.IsDiscrete(p.Unit) && l.Quantity != Math.Floor(l.Quantity))
                    throw DomainException.Invalid($"{field}.quantity", $"{p.Name}: учитывается в штуках, укажите целое число.");
                DateTime expires;
                if (string.IsNullOrWhiteSpace(l.ExpiresOn))
                {
                    if (p.DefaultShelfLifeHours is not { } h) throw DomainException.Invalid($"{field}.expiresOn", $"{p.Name}: укажите срок годности.");
                    expires = now.AddHours(h);
                }
                else if (DateTime.TryParseExact(l.ExpiresOn.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
                    expires = TimeZones.LocalToUtc(day.Date.AddDays(1), tz);
                else
                    throw DomainException.Invalid($"{field}.expiresOn", "Неверный формат даты.");
                if (expires <= now)
                    throw DomainException.Invalid($"{field}.expiresOn", $"{p.Name}: срок годности уже истёк.");
                result.Add(new SupplierRequestLine { ProductId = p.Id, RequestedQuantity = l.Quantity, ExpiresAt = expires });
            }

            var request = new SupplierRequest
            {
                Number = await NextRequestNumberAsync(now, tz, ct),
                SupplierKey = supplierKey,
                SupplierName = Clip(supplierName, 120),
                Comment = comment,
                CreatedAt = now,
                Status = SupplierRequestStatus.Sent,
                Lines = result,
            };
            db.SupplierRequests.Add(request);
            return request;
        }, ct);

    /// <summary>Принимает заявку: по каждой строке фактическое количество (0 - не приехало). Создаёт принятую поставку и партии.</summary>
    public Task<Supply> AcceptSupplierRequestAsync(Guid id, AcceptSupplierRequestCommand cmd, string actor, CancellationToken ct, DateTime? at = null) =>
        ExecuteAsync("supplier-request.accepted", at, async now =>
        {
            var request = await db.SupplierRequests.Include(r => r.Lines).ThenInclude(l => l.Product)
                .FirstOrDefaultAsync(r => r.Id == id, ct) ?? throw DomainException.NotFound("Заявка");
            if (request.Status != SupplierRequestStatus.Sent) throw DomainException.Conflict("Заявка уже обработана.");

            var given = (cmd.Lines ?? []).ToDictionary(l => l.LineId, l => l.Quantity);
            if (given.Keys.Any(k => request.Lines.All(l => l.Id != k)))
                throw DomainException.Invalid("lines", "В заявке нет такой позиции.");
            foreach (var line in request.Lines)
            {
                var qty = cmd.Lines is null ? line.RequestedQuantity
                    : given.TryGetValue(line.Id, out var q) ? q
                    : throw DomainException.Invalid("lines", "Укажите принятое количество для каждой позиции.");
                var name = line.Product!.Name;
                if (qty < 0) throw DomainException.Invalid("lines", $"{name}: количество не может быть отрицательным.");
                if (qty > line.RequestedQuantity)
                    throw DomainException.Invalid("lines", $"{name}: нельзя принять больше, чем заявлено ({Units.Format(line.RequestedQuantity, line.Product.Unit)}).");
                if (Units.IsDiscrete(line.Product.Unit) && qty != Math.Floor(qty))
                    throw DomainException.Invalid("lines", $"{name}: учитывается в штуках, укажите целое число.");
                line.AcceptedQuantity = qty;
            }
            if (request.Lines.All(l => l.AcceptedQuantity == 0))
                throw DomainException.Invalid("lines", "Ничего не принято. Если товар не приехал, отклоните заявку.");

            var tz = TimeZones.Resolve((await GetSettingsAsync(ct)).TimeZone);
            var supply = new Supply
            {
                SupplyNumber = await NextSupplyNumberAsync(now, tz, ct),
                Supplier = request.SupplierName,
                Note = $"По заявке {request.Number}",
                CreatedAt = now,
                Status = SupplyStatus.Draft,
                SupplierRequestId = request.Id,
                Lines = request.Lines.Where(l => l.AcceptedQuantity > 0)
                    .Select(l => new SupplyLine { ProductId = l.ProductId, Quantity = l.AcceptedQuantity!.Value, ExpiresAt = l.ExpiresAt }).ToList(),
            };
            db.Supplies.Add(supply);
            await db.SaveChangesAsync(ct);
            await ReceiveInternalAsync(supply, now, tz, ct);

            request.Status = SupplierRequestStatus.Accepted;
            request.DecidedAt = now;
            request.DecidedBy = Clip(actor, 120);
            return supply;
        }, ct);

    public Task<SupplierRequest> RejectSupplierRequestAsync(Guid id, string? reason, string actor, CancellationToken ct, DateTime? at = null) =>
        ExecuteAsync("supplier-request.rejected", at, async now =>
        {
            var text = reason?.Trim() ?? "";
            if (text.Length is < 3 or > 300) throw DomainException.Invalid("reason", "Укажите причину отказа (от 3 до 300 символов).");
            var request = await db.SupplierRequests.FirstOrDefaultAsync(r => r.Id == id, ct) ?? throw DomainException.NotFound("Заявка");
            if (request.Status != SupplierRequestStatus.Sent) throw DomainException.Conflict("Заявка уже обработана.");
            request.Status = SupplierRequestStatus.Rejected;
            request.RejectionReason = text;
            request.DecidedAt = now;
            request.DecidedBy = Clip(actor, 120);
            return request;
        }, ct);

    private async Task<string> NextRequestNumberAsync(DateTime now, TimeZoneInfo tz, CancellationToken ct)
    {
        var count = await db.SupplierRequests.CountAsync(ct);
        string number;
        do number = $"ЗП-{TimeZones.UtcToLocal(now, tz):yyMMdd}-{++count:000}";
        while (await db.SupplierRequests.AnyAsync(r => r.Number == number, ct));
        return number;
    }
}
