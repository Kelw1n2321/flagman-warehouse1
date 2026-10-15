using Flagman.Api.Domain;
using Flagman.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Tests;

public sealed class SupplierRequestTests : IAsyncLifetime
{
    private readonly TestHost _host = new();

    public Task InitializeAsync() => Task.CompletedTask;
    public async Task DisposeAsync() => await _host.DisposeAsync();

    // T0 = 10.10.2026, срок "до 15.10" - по времени ресторана.
    private Task<SupplierRequest> Send(string key, params (int ProductId, decimal Qty)[] lines) =>
        _host.With((w, _) => w.CreateSupplierRequestAsync(
            new SupplierRequestCommand(lines.Select(l => new SupplierRequestLineInput(l.ProductId, l.Qty, "2026-10-15")).ToList(), "Привезём утром"),
            key, "ООО Фермер", default));

    [Fact]
    public async Task Create_ValidatesQuantityAndExpiry()
    {
        var chk = await _host.AddProductAsync("CHK");
        var bad = new SupplierRequestCommand([new SupplierRequestLineInput(chk, 5, "2026-10-01")], null);
        var ex = await Assert.ThrowsAsync<DomainException>(() => _host.With((w, _) => w.CreateSupplierRequestAsync(bad, "k", "Ф", default)));
        Assert.Equal(400, ex.Status);
        await Assert.ThrowsAsync<DomainException>(() => Send("k", (chk, 0)));
        Assert.Equal(0, await _host.With((_, db) => db.SupplierRequests.CountAsync()));
    }

    [Fact]
    public async Task Accept_Partial_CreatesBatchesOnlyForAcceptedQuantity()
    {
        var chk = await _host.AddProductAsync("CHK");
        var crm = await _host.AddProductAsync("CRM", "l");
        var req = await Send("k", (chk, 20), (crm, 5));
        var lines = req.Lines.OrderBy(l => l.Id).ToList();

        var supply = await _host.With((w, _) => w.AcceptSupplierRequestAsync(req.Id,
            new AcceptSupplierRequestCommand([new AcceptLineInput(lines[0].Id, 18), new AcceptLineInput(lines[1].Id, 0)]), "Максим", default));

        Assert.Equal(SupplyStatus.Received, supply.Status);
        Assert.Equal(req.Id, supply.SupplierRequestId);
        Assert.Equal(18m, (await _host.BatchesAsync(chk)).Single().QuantityReceived);
        Assert.Empty(await _host.BatchesAsync(crm));
        var dto = await _host.Query(q => q.GetSupplierRequestAsync(req.Id, null, default));
        Assert.Equal("accepted", dto!.Status);
        Assert.True(dto.Partial);
        Assert.Equal(supply.SupplyNumber, dto.SupplyNumber);
        Assert.Equal([18m, 0m], dto.Lines.Select(l => l.AcceptedQuantity!.Value));
    }

    [Fact]
    public async Task Accept_RejectsMoreThanRequested_AndNothingAccepted()
    {
        var chk = await _host.AddProductAsync("CHK");
        var req = await Send("k", (chk, 20));
        var line = req.Lines.Single().Id;

        await Assert.ThrowsAsync<DomainException>(() => _host.With((w, _) =>
            w.AcceptSupplierRequestAsync(req.Id, new AcceptSupplierRequestCommand([new AcceptLineInput(line, 21)]), "М", default)));
        await Assert.ThrowsAsync<DomainException>(() => _host.With((w, _) =>
            w.AcceptSupplierRequestAsync(req.Id, new AcceptSupplierRequestCommand([new AcceptLineInput(line, 0)]), "М", default)));
        Assert.Empty(await _host.BatchesAsync(chk));
    }

    [Fact]
    public async Task CannotAcceptTwice_OrAcceptRejected()
    {
        var chk = await _host.AddProductAsync("CHK");
        var first = await Send("k", (chk, 20));
        await _host.With((w, _) => w.AcceptSupplierRequestAsync(first.Id, new AcceptSupplierRequestCommand(null), "М", default));
        var again = await Assert.ThrowsAsync<DomainException>(() => _host.With((w, _) =>
            w.AcceptSupplierRequestAsync(first.Id, new AcceptSupplierRequestCommand(null), "М", default)));
        Assert.Equal(409, again.Status);
        Assert.Single(await _host.BatchesAsync(chk));

        var second = await Send("k", (chk, 3));
        await Assert.ThrowsAsync<DomainException>(() => _host.With((w, _) => w.RejectSupplierRequestAsync(second.Id, "", "М", default)));
        await _host.With((w, _) => w.RejectSupplierRequestAsync(second.Id, "Не заказывали", "М", default));
        var ex = await Assert.ThrowsAsync<DomainException>(() => _host.With((w, _) =>
            w.AcceptSupplierRequestAsync(second.Id, new AcceptSupplierRequestCommand(null), "М", default)));
        Assert.Equal(409, ex.Status);
        Assert.Single(await _host.BatchesAsync(chk));
    }

    [Fact]
    public async Task Supplier_SeesOnlyOwnRequests()
    {
        var chk = await _host.AddProductAsync("CHK");
        var mine = await Send("me", (chk, 1));
        var other = await Send("other", (chk, 2));

        var list = await _host.Query(q => q.GetSupplierRequestsAsync("me", null, default));
        Assert.Equal([mine.Id], list.Select(r => r.Id));
        Assert.Null(await _host.Query(q => q.GetSupplierRequestAsync(other.Id, "me", default)));
        Assert.Equal(2, (await _host.Query(q => q.GetSupplierRequestsAsync(null, null, default))).Count);
    }

    [Fact]
    public async Task Accept_DuplicateLine_IsValidationError()
    {
        var chk = await _host.AddProductAsync("CHK");
        var req = await Send("k", (chk, 20));
        var line = req.Lines.Single().Id;
        var ex = await Assert.ThrowsAsync<DomainException>(() => _host.With((w, _) => w.AcceptSupplierRequestAsync(req.Id,
            new AcceptSupplierRequestCommand([new AcceptLineInput(line, 5), new AcceptLineInput(line, 6)]), "М", default)));
        Assert.Equal(400, ex.Status);
    }
}
