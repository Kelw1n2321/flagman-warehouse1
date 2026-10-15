using Flagman.Api.Data;
using Flagman.Api.Domain;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Tests;

public sealed class SchemaPatchesTests
{
    [Fact]
    public async Task OldDatabase_GetsNewTablesAndColumn_Idempotently()
    {
        await using var connection = new SqliteConnection("DataSource=:memory:");
        await connection.OpenAsync();
        await using var db = new FlagmanDbContext(new DbContextOptionsBuilder<FlagmanDbContext>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        // Делаем базу "как до обновления": без новых таблиц и без колонки заявки у поставок.
        await db.Database.ExecuteSqlRawAsync("""
            DROP TABLE "TrashItems"; DROP TABLE "HotOfferOverrides"; DROP TABLE "SupplierRequestLines"; DROP TABLE "SupplierRequests";
            DROP INDEX "IX_Supplies_SupplierRequestId"; ALTER TABLE "Supplies" DROP COLUMN "SupplierRequestId";
            """);

        await SchemaPatches.ApplyAsync(db, default);
        await SchemaPatches.ApplyAsync(db, default);

        db.Products.Add(new Product { Sku = "CHK", Name = "Курица", Category = "Мясо", Unit = "kg" });
        await db.SaveChangesAsync();
        db.SupplierRequests.Add(new SupplierRequest
        {
            Number = "ЗП-1", SupplierKey = "k", SupplierName = "Ф", CreatedAt = DateTime.UtcNow,
            Lines = [new SupplierRequestLine { ProductId = db.Products.Single().Id, RequestedQuantity = 20, ExpiresAt = DateTime.UtcNow.AddDays(3) }],
        });
        db.Supplies.Add(new Supply { SupplyNumber = "П-1", CreatedAt = DateTime.UtcNow, SupplierRequestId = Guid.NewGuid() });
        await db.SaveChangesAsync();

        Assert.Equal(1, await db.SupplierRequestLines.CountAsync());
        Assert.NotNull((await db.Supplies.SingleAsync()).SupplierRequestId);
        Assert.Equal(0, await db.TrashItems.CountAsync());
        Assert.Equal(0, await db.HotOfferOverrides.CountAsync());
    }
}
