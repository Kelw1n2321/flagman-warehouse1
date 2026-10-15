using Flagman.Api.Services;

namespace Flagman.Tests;

public sealed class HotOverrideTests : IAsyncLifetime
{
    private readonly TestHost _host = new();

    public Task InitializeAsync() => Task.CompletedTask;
    public async Task DisposeAsync() => await _host.DisposeAsync();

    [Fact]
    public async Task Pin_AddsDishWithoutExpiringIngredients_First()
    {
        var flour = await _host.AddProductAsync("FLR");
        var cream = await _host.AddProductAsync("CRM", "l");
        await _host.ReceiveAsync((flour, 5, 500), (cream, 1, 30));
        var pancakes = await _host.AddDishAsync("Блины", (flour, 0.1m));
        var soup = await _host.AddDishAsync("Суп", (cream, 0.1m));

        await _host.With((w, _) => w.SetHotOverrideAsync(pancakes, new HotOverrideCommand("pin", "Сезонное", null), "Максим", default));

        var hot = await _host.Query(q => q.GetHotOffersAsync(default));
        Assert.Equal([pancakes, soup], hot.Offers.Select(o => o.DishId));
        Assert.True(hot.Offers[0].Pinned);
        Assert.Equal("Сезонное", hot.Offers[0].PinNote);
        var summary = await _host.Query(q => q.GetSummaryAsync(default));
        Assert.Equal(2, summary.HotOffers);
        var dishes = await _host.Query(q => q.GetDishesAsync(false, default));
        Assert.Equal("pinned", dishes.Single(d => d.Id == pancakes).HotLevel);
    }

    [Fact]
    public async Task Hide_RemovesDishEvenWhenExpiring_AndClearRestores()
    {
        var cream = await _host.AddProductAsync("CRM", "l");
        await _host.ReceiveAsync((cream, 1, 30));
        var soup = await _host.AddDishAsync("Суп", (cream, 0.1m));
        Assert.Single((await _host.Query(q => q.GetHotOffersAsync(default))).Offers);

        await _host.With((w, _) => w.SetHotOverrideAsync(soup, new HotOverrideCommand("hide", null, null), "Максим", default));
        var hot = await _host.Query(q => q.GetHotOffersAsync(default));
        Assert.Empty(hot.Offers);
        Assert.Equal(soup, hot.Hidden.Single().DishId);
        Assert.NotNull(hot.Hidden.Single().Score);
        Assert.Equal(0, (await _host.Query(q => q.GetSummaryAsync(default))).HotOffers);
        Assert.Null((await _host.Query(q => q.GetDishesAsync(false, default))).Single().HotLevel);

        await _host.With((w, _) => w.ClearHotOverrideAsync(soup, default));
        Assert.Single((await _host.Query(q => q.GetHotOffersAsync(default))).Offers);
    }

    [Fact]
    public async Task ExpiredPin_IsIgnored_AndHideReplacesPin()
    {
        var flour = await _host.AddProductAsync("FLR");
        await _host.ReceiveAsync((flour, 5, 500));
        var pancakes = await _host.AddDishAsync("Блины", (flour, 0.1m));
        await _host.With((w, _) => w.SetHotOverrideAsync(pancakes, new HotOverrideCommand("pin", null, "2026-10-11"), "М", default));
        Assert.Single((await _host.Query(q => q.GetHotOffersAsync(default))).Offers);

        _host.Clock.Now = _host.Clock.Now.AddDays(3);
        Assert.Empty((await _host.Query(q => q.GetHotOffersAsync(default))).Offers);

        await _host.With((w, _) => w.SetHotOverrideAsync(pancakes, new HotOverrideCommand("hide", null, null), "М", default));
        var hot = await _host.Query(q => q.GetHotOffersAsync(default));
        Assert.Empty(hot.Offers);
        Assert.Single(hot.Hidden);
    }
}
