using Flagman.Api.Domain;
using Flagman.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Tests;

public sealed class TrashTests : IAsyncLifetime
{
    private readonly TestHost _host = new();

    public Task InitializeAsync() => Task.CompletedTask;
    public async Task DisposeAsync() => await _host.DisposeAsync();

    [Fact]
    public async Task ManualWriteOff_GoesToTrash_AndRestoreReturnsQuantity()
    {
        var tom = await _host.AddProductAsync("TOM");
        await _host.ReceiveAsync((tom, 3, 48));
        var batch = (await _host.BatchesAsync(tom)).Single();

        await _host.With((w, _) => w.WriteOffBatchAsync(batch.Id, 1, "Помялись", default, actor: "Максим"));
        var item = (await _host.Query(q => q.GetTrashAsync(null, null, default))).Single();
        Assert.Equal(("spoilage", 1m, "Максим", "Помялись"), (item.Kind, item.Quantity, item.DeletedBy, item.Reason));
        Assert.Equal(2m, (await _host.SnapshotAsync()).Stock[tom].Available);

        await _host.With((w, _) => w.RestoreTrashItemAsync(item.Id, "Максим", default));
        var after = (await _host.BatchesAsync(tom)).Single();
        Assert.Equal((3m, BatchState.Active), (after.QuantityRemaining, after.State));
        Assert.True(after.Version > batch.Version);
        var restore = await _host.With((_, db) => db.Movements.SingleAsync(m => m.Type == MovementType.Restore));
        Assert.Equal(1m, restore.Quantity);
        Assert.Empty(await _host.Query(q => q.GetTrashAsync(null, null, default)));

        var twice = await Assert.ThrowsAsync<DomainException>(() => _host.With((w, _) => w.RestoreTrashItemAsync(item.Id, "М", default)));
        Assert.Equal(409, twice.Status);
    }

    [Fact]
    public async Task FullWriteOff_RestoreReactivatesBatch()
    {
        var tom = await _host.AddProductAsync("TOM");
        await _host.ReceiveAsync((tom, 3, 48));
        var batch = (await _host.BatchesAsync(tom)).Single();
        await _host.With((w, _) => w.WriteOffBatchAsync(batch.Id, null, null, default));
        Assert.Equal(BatchState.Depleted, (await _host.BatchesAsync(tom)).Single().State);

        var item = (await _host.Query(q => q.GetTrashAsync(null, null, default))).Single();
        await _host.With((w, _) => w.RestoreTrashItemAsync(item.Id, "М", default));
        Assert.Equal(3m, (await _host.SnapshotAsync()).Stock[tom].Available);
    }

    [Fact]
    public async Task ExpiredWriteOff_CreatesItemPerBatch_AndPurgeKeepsStock()
    {
        var milk = await _host.AddProductAsync("MLK", "l");
        await _host.ReceiveAsync((milk, 1, 2), (milk, 2, 3), (milk, 5, 100));
        _host.Clock.Now = _host.Clock.Now.AddHours(4);

        Assert.Equal(2, await _host.With((w, _) => w.WriteOffExpiredAsync(false, default, actor: "М")));
        var items = await _host.Query(q => q.GetTrashAsync("expired", null, default));
        Assert.Equal(2, items.Count);
        Assert.All(items, i => Assert.True(i.BatchExpired));

        await _host.With((w, _) => w.PurgeTrashItemAsync(items[0].Id, "М", default));
        Assert.Single(await _host.Query(q => q.GetTrashAsync(null, null, default)));
        Assert.Equal(5m, (await _host.SnapshotAsync()).Stock[milk].Available);
        var restorePurged = await Assert.ThrowsAsync<DomainException>(() => _host.With((w, _) => w.RestoreTrashItemAsync(items[0].Id, "М", default)));
        Assert.Equal(409, restorePurged.Status);
    }

    [Fact]
    public async Task RestoreExpired_WithAutoWriteOff_Conflicts()
    {
        var milk = await _host.AddProductAsync("MLK", "l");
        await _host.ReceiveAsync((milk, 1, 2));
        _host.Clock.Now = _host.Clock.Now.AddHours(3);
        await _host.With((w, _) => w.WriteOffExpiredAsync(false, default));
        await _host.With(async (_, db) =>
        {
            (await db.Settings.SingleAsync()).AutoWriteOffExpired = true;
            return await db.SaveChangesAsync();
        });
        var item = (await _host.Query(q => q.GetTrashAsync(null, null, default))).Single();
        var ex = await Assert.ThrowsAsync<DomainException>(() => _host.With((w, _) => w.RestoreTrashItemAsync(item.Id, "М", default)));
        Assert.Equal(409, ex.Status);
    }

    [Fact]
    public async Task Stats_IgnoreRestoredWriteOffs()
    {
        var tom = await _host.AddProductAsync("TOM");
        await _host.ReceiveAsync((tom, 3, 48));
        var batch = (await _host.BatchesAsync(tom)).Single();
        await _host.With((w, _) => w.WriteOffBatchAsync(batch.Id, 1, null, default));
        await _host.With((w, _) => w.WriteOffBatchAsync(batch.Id, 0.5m, null, default));
        var first = (await _host.Query(q => q.GetTrashAsync(null, null, default))).Single(t => t.Quantity == 1);
        await _host.With((w, _) => w.RestoreTrashItemAsync(first.Id, "М", default));

        var stats = await _host.Query(q => q.GetStatsAsync(7, null, default));
        Assert.Equal(0.5m, stats.Flows.Single(f => f.ProductId == tom).SpoilageWrittenOff);
        Assert.Equal(1, stats.Totals.WriteOffOperations);
    }
}
