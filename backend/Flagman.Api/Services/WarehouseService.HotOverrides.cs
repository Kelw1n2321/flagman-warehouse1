using System.Globalization;
using Flagman.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Api.Services;

/// <summary>Mode: "pin" - закрепить в горячих предложениях, "hide" - скрыть. UntilLocal - "yyyy-MM-dd" по времени ресторана.</summary>
public sealed record HotOverrideCommand(string? Mode, string? Note, string? UntilLocal);

// Ручные правки горячих предложений.
public sealed partial class WarehouseService
{
    public async Task<IReadOnlyList<HotOfferOverride>> GetHotOverridesAsync(CancellationToken ct) =>
        await db.HotOfferOverrides.AsNoTracking().ToListAsync(ct);

    /// <summary>У блюда одна правка: новая заменяет старую (закрепление и скрытие взаимоисключающие).</summary>
    public Task<HotOfferOverride> SetHotOverrideAsync(int dishId, HotOverrideCommand cmd, string actor, CancellationToken ct, DateTime? at = null) =>
        ExecuteAsync("hot-override.updated", at, async now =>
        {
            var mode = cmd.Mode?.Trim().ToLowerInvariant() switch
            {
                "pin" => HotOverrideMode.Pin,
                "hide" => HotOverrideMode.Hide,
                _ => throw DomainException.Invalid("mode", "Укажите действие: закрепить или скрыть."),
            };
            var dish = await db.Dishes.AsNoTracking().FirstOrDefaultAsync(d => d.Id == dishId, ct) ?? throw DomainException.NotFound("Блюдо");
            if (!dish.IsActive) throw DomainException.Conflict("Блюдо выключено из меню.");
            var note = string.IsNullOrWhiteSpace(cmd.Note) ? null : cmd.Note.Trim();
            if (note?.Length > 80) throw DomainException.Invalid("note", "Пометка - не длиннее 80 символов.");

            DateTime? until = null;
            if (!string.IsNullOrWhiteSpace(cmd.UntilLocal))
            {
                if (!DateTime.TryParseExact(cmd.UntilLocal.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
                    throw DomainException.Invalid("untilLocal", "Неверный формат даты.");
                var tz = TimeZones.Resolve((await GetSettingsAsync(ct)).TimeZone);
                until = TimeZones.LocalToUtc(day.Date.AddDays(1), tz); // до конца выбранного дня
                if (until <= now) throw DomainException.Invalid("untilLocal", "Дата окончания уже прошла.");
            }

            var o = await db.HotOfferOverrides.FirstOrDefaultAsync(x => x.DishId == dishId, ct);
            if (o is null) db.HotOfferOverrides.Add(o = new HotOfferOverride { DishId = dishId });
            o.Mode = mode;
            o.Note = note;
            o.Until = until;
            o.CreatedAt = now;
            o.CreatedBy = actor;
            return o;
        }, ct);

    public Task<bool> ClearHotOverrideAsync(int dishId, CancellationToken ct) =>
        ExecuteAsync("hot-override.updated", null, async _ =>
        {
            var o = await db.HotOfferOverrides.FirstOrDefaultAsync(x => x.DishId == dishId, ct);
            if (o is null) return false;
            db.HotOfferOverrides.Remove(o);
            return true;
        }, ct);
}
