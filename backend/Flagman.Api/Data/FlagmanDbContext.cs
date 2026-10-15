using Flagman.Api.Domain;
using Flagman.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Flagman.Api.Data;

public sealed class FlagmanDbContext(DbContextOptions<FlagmanDbContext> options) : DbContext(options)
{
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Supply> Supplies => Set<Supply>();
    public DbSet<SupplyLine> SupplyLines => Set<SupplyLine>();
    public DbSet<ProductBatch> Batches => Set<ProductBatch>();
    public DbSet<Dish> Dishes => Set<Dish>();
    public DbSet<DishIngredient> DishIngredients => Set<DishIngredient>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderLine> OrderLines => Set<OrderLine>();
    public DbSet<OrderShortage> OrderShortages => Set<OrderShortage>();
    public DbSet<StockMovement> Movements => Set<StockMovement>();
    public DbSet<Alert> Alerts => Set<Alert>();
    public DbSet<StopListEntry> StopListEntries => Set<StopListEntry>();
    public DbSet<WarehouseSettings> Settings => Set<WarehouseSettings>();
    public DbSet<SupplierRequest> SupplierRequests => Set<SupplierRequest>();
    public DbSet<SupplierRequestLine> SupplierRequestLines => Set<SupplierRequestLine>();
    public DbSet<HotOfferOverride> HotOfferOverrides => Set<HotOfferOverride>();
    public DbSet<TrashItem> TrashItems => Set<TrashItem>();

    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        // Все моменты времени хранятся в UTC; SQLite теряет Kind - восстанавливаем его при чтении.
        builder.Properties<DateTime>().HaveConversion<UtcConverter>();
        builder.Properties<DateTime?>().HaveConversion<NullableUtcConverter>();
        builder.Properties<decimal>().HavePrecision(14, 4);
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Product>(e =>
        {
            e.HasIndex(p => p.Sku).IsUnique();
            e.Property(p => p.Name).HasMaxLength(120);
            e.Property(p => p.Category).HasMaxLength(60);
            e.Property(p => p.Unit).HasMaxLength(8);
        });

        b.Entity<Supply>(e =>
        {
            e.HasIndex(s => s.SupplyNumber).IsUnique();
            e.HasMany(s => s.Lines).WithOne().HasForeignKey(l => l.SupplyId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(s => s.Batches).WithOne(x => x.Supply).HasForeignKey(x => x.SupplyId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Supply>().HasIndex(s => s.SupplierRequestId);

        b.Entity<SupplierRequest>(e =>
        {
            e.HasIndex(r => r.Number).IsUnique();
            e.HasIndex(r => r.SupplierKey);
            e.Property(r => r.Number).HasMaxLength(40);
            e.Property(r => r.SupplierKey).HasMaxLength(64);
            e.Property(r => r.SupplierName).HasMaxLength(120);
            e.Property(r => r.Comment).HasMaxLength(500);
            e.Property(r => r.DecidedBy).HasMaxLength(120);
            e.Property(r => r.RejectionReason).HasMaxLength(300);
            e.HasMany(r => r.Lines).WithOne().HasForeignKey(l => l.RequestId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SupplierRequestLine>().HasOne(l => l.Product).WithMany().HasForeignKey(l => l.ProductId).OnDelete(DeleteBehavior.Restrict);

        b.Entity<HotOfferOverride>(e =>
        {
            e.HasIndex(o => o.DishId).IsUnique();
            e.HasOne<Dish>().WithMany().HasForeignKey(o => o.DishId).OnDelete(DeleteBehavior.Cascade);
            e.Property(o => o.Note).HasMaxLength(80);
            e.Property(o => o.CreatedBy).HasMaxLength(120);
        });

        b.Entity<TrashItem>(e =>
        {
            e.HasIndex(t => new { t.PurgedAt, t.RestoredAt, t.DeletedAt });
            e.HasOne<ProductBatch>().WithMany().HasForeignKey(t => t.BatchId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(t => t.WriteOffMovement).WithMany().HasForeignKey(t => t.WriteOffMovementId).OnDelete(DeleteBehavior.Restrict);
            e.Property(t => t.Reason).HasMaxLength(200);
            e.Property(t => t.DeletedBy).HasMaxLength(120);
            e.Property(t => t.RestoredBy).HasMaxLength(120);
            e.Property(t => t.PurgedBy).HasMaxLength(120);
        });

        b.Entity<SupplyLine>().HasOne(l => l.Product).WithMany().HasForeignKey(l => l.ProductId);

        b.Entity<ProductBatch>(e =>
        {
            e.HasIndex(x => x.Code).IsUnique();
            e.HasIndex(x => new { x.ProductId, x.State, x.ExpiresAt });
            e.HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Version).IsConcurrencyToken();
        });

        b.Entity<Dish>().HasMany(d => d.Ingredients).WithOne().HasForeignKey(i => i.DishId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<DishIngredient>(e =>
        {
            e.HasKey(i => new { i.DishId, i.ProductId });
            e.HasOne(i => i.Product).WithMany().HasForeignKey(i => i.ProductId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Order>(e =>
        {
            e.HasIndex(o => o.Number).IsUnique();
            e.HasIndex(o => o.CreatedAt);
            e.Property(o => o.Title).HasMaxLength(OrderLimits.Title);
            e.Property(o => o.Comment).HasMaxLength(OrderLimits.Comment);
            e.HasMany(o => o.Lines).WithOne().HasForeignKey(l => l.OrderId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(o => o.Shortages).WithOne().HasForeignKey(l => l.OrderId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<StockMovement>(e =>
        {
            e.HasIndex(m => m.CreatedAt);
            e.HasIndex(m => new { m.ProductId, m.CreatedAt });
        });

        b.Entity<Alert>(e =>
        {
            e.HasIndex(a => new { a.Key, a.Status });
            e.HasIndex(a => a.CreatedAt);
        });

        b.Entity<StopListEntry>().HasIndex(x => new { x.DishId, x.EndedAt });
        b.Entity<WarehouseSettings>().Property(x => x.Id).ValueGeneratedNever();
    }

    private sealed class UtcConverter() : ValueConverter<DateTime, DateTime>(
        v => v.Kind == DateTimeKind.Utc ? v : v.ToUniversalTime(),
        v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

    private sealed class NullableUtcConverter() : ValueConverter<DateTime?, DateTime?>(
        v => v == null ? v : v.Value.Kind == DateTimeKind.Utc ? v : v.Value.ToUniversalTime(),
        v => v == null ? v : DateTime.SpecifyKind(v.Value, DateTimeKind.Utc));
}
