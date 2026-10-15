using Flagman.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Api.Services;

// Корзина списаний: списанное можно вернуть на склад или удалить навсегда.
public sealed partial class WarehouseService
{
    private static string Clip(string text, int max) => text.Length <= max ? text : text[..max];

    private void AddToTrash(ProductBatch batch, decimal quantity, WriteOffKind kind, string? reason, StockMovement movement, DateTime now, string? actor) =>
        db.TrashItems.Add(new TrashItem
        {
            BatchId = batch.Id,
            ProductId = batch.ProductId,
            Quantity = quantity,
            Kind = kind,
            Reason = reason ?? "",
            DeletedAt = now,
            DeletedBy = string.IsNullOrWhiteSpace(actor) ? "Сотрудник" : actor,
            WriteOffMovement = movement,
        });

    /// <summary>Возвращает списанное количество в партию и делает её снова активной.</summary>
    public Task<TrashItem> RestoreTrashItemAsync(int id, string actor, CancellationToken ct, DateTime? at = null) =>
        ExecuteAsync("trash.restored", at, async now =>
        {
            var item = await db.TrashItems.FirstOrDefaultAsync(t => t.Id == id, ct) ?? throw DomainException.NotFound("Запись корзины");
            if (item.RestoredAt is not null) throw DomainException.Conflict("Эта запись уже восстановлена.");
            if (item.PurgedAt is not null) throw DomainException.Conflict("Запись удалена навсегда, восстановить её нельзя.");
            var batch = await db.Batches.FirstOrDefaultAsync(b => b.Id == item.BatchId, ct) ?? throw DomainException.NotFound("Партия");
            var settings = await GetSettingsAsync(ct);
            if (batch.ExpiresAt <= now && settings.AutoWriteOffExpired)
                throw DomainException.Conflict("Партия просрочена и включено автосписание: она сразу снова уйдёт в корзину.");

            batch.QuantityRemaining += item.Quantity;
            batch.State = BatchState.Active;
            batch.Version++;
            var movement = new StockMovement
            {
                ProductId = batch.ProductId, BatchId = batch.Id, Type = MovementType.Restore,
                Quantity = item.Quantity, BatchBalanceAfter = batch.QuantityRemaining, CreatedAt = now,
                Reason = Clip($"Восстановлено из корзины: {item.Reason}", 200),
            };
            db.Movements.Add(movement);
            await db.SaveChangesAsync(ct);
            item.RestoredAt = now;
            item.RestoredBy = actor;
            item.RestoreMovementId = movement.Id;
            return item;
        }, ct);

    /// <summary>Удаляет запись из корзины навсегда. Остатки не меняются, списание остаётся в журнале.</summary>
    public Task<TrashItem> PurgeTrashItemAsync(int id, string actor, CancellationToken ct, DateTime? at = null) =>
        ExecuteAsync("trash.purged", at, async now =>
        {
            var item = await db.TrashItems.FirstOrDefaultAsync(t => t.Id == id, ct) ?? throw DomainException.NotFound("Запись корзины");
            if (item.RestoredAt is not null) throw DomainException.Conflict("Эта запись уже восстановлена.");
            if (item.PurgedAt is not null) throw DomainException.Conflict("Запись уже удалена.");
            item.PurgedAt = now;
            item.PurgedBy = actor;
            return item;
        }, ct);
}
