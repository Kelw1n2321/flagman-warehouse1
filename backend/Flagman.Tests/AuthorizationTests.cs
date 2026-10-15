using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace Flagman.Tests;

/// <summary>Права по ролям на настоящем HTTP-конвейере: кому какие адреса открыты.</summary>
public sealed class AuthorizationTests : IClassFixture<AuthorizationTests.App>
{
    public sealed class App : WebApplicationFactory<Program>
    {
        private readonly string _db = Path.Combine(Path.GetTempPath(), $"flagman-test-{Guid.NewGuid():N}.db");

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration(c => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Auth:AdminIds"] = "m1:Менеджер, w1:Официант:waiter, s1:ООО Фермер:supplier",
                ["Auth:AdminIdHashes"] = "",
                ["Demo:SeedOnStart"] = "false",
                ["ConnectionStrings:Sqlite"] = $"Data Source={_db}",
            }));
            builder.ConfigureTestServices(s => s.RemoveAll<IHostedService>());
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            File.Delete(_db);
        }
    }

    private readonly App _app;
    public AuthorizationTests(App app) => _app = app;

    private async Task<HttpClient> LoginAsync(string id, string? portal = null)
    {
        var client = _app.CreateClient();
        var res = await client.PostAsJsonAsync("/api/v1/auth/login", new { id, portal });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return client;
    }

    [Fact]
    public async Task Roles_SeeOnlyTheirEndpoints()
    {
        var waiter = await LoginAsync("w1");
        foreach (var path in new[] { "/api/v1/dishes", "/api/v1/hot-offers", "/api/v1/stop-list", "/api/v1/orders", "/api/v1/summary" })
            Assert.Equal(HttpStatusCode.OK, (await waiter.GetAsync(path)).StatusCode);
        foreach (var path in new[] { "/api/v1/stock", "/api/v1/trash", "/api/v1/supplies", "/api/v1/settings", "/api/v1/supplier-requests" })
            Assert.Equal(HttpStatusCode.Forbidden, (await waiter.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await waiter.GetAsync("/api/v1/supplier/products")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await waiter.PutAsJsonAsync("/api/v1/hot-offers/overrides/1", new { mode = "hide" })).StatusCode);

        // У поставщика своя cookie: для основного сайта он просто не вошёл.
        var supplier = await LoginAsync("s1", "supplier");
        Assert.Equal(HttpStatusCode.OK, (await supplier.GetAsync("/api/v1/supplier/products")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await supplier.GetAsync("/api/v1/supplier/requests")).StatusCode);
        foreach (var path in new[] { "/api/v1/orders", "/api/v1/dishes", "/api/v1/stock" })
            Assert.Equal(HttpStatusCode.Unauthorized, (await supplier.GetAsync(path)).StatusCode);
        Assert.DoesNotContain("productCount", await supplier.GetStringAsync("/api/v1/summary"));

        var manager = await LoginAsync("m1");
        foreach (var path in new[] { "/api/v1/stock", "/api/v1/trash", "/api/v1/supplier-requests", "/api/v1/hot-offers" })
            Assert.Equal(HttpStatusCode.OK, (await manager.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await manager.GetAsync("/api/v1/supplier/requests")).StatusCode);

        var anonymous = _app.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/v1/dishes")).StatusCode);
    }

    [Fact]
    public async Task Login_RejectsWrongPortal_AndReturnsRole()
    {
        var client = _app.CreateClient();
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/v1/auth/login", new { id = "s1" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/v1/auth/login", new { id = "m1", portal = "supplier" })).StatusCode);

        var me = await (await LoginAsync("w1")).GetFromJsonAsync<Dictionary<string, object>>("/api/v1/auth/me");
        Assert.Equal("waiter", me!["role"].ToString());
    }

    [Fact]
    public async Task SameBrowser_SupplierAndManager_DoNotKickEachOtherOut()
    {
        var browser = _app.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await browser.PostAsJsonAsync("/api/v1/auth/login", new { id = "s1", portal = "supplier" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await browser.PostAsJsonAsync("/api/v1/auth/login", new { id = "m1" })).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/api/v1/supplier/requests")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/api/v1/stock")).StatusCode);
        var supplierMe = await browser.GetFromJsonAsync<Dictionary<string, object>>("/api/v1/auth/me?portal=supplier");
        var staffMe = await browser.GetFromJsonAsync<Dictionary<string, object>>("/api/v1/auth/me");
        Assert.Equal(("supplier", "manager"), (supplierMe!["role"].ToString(), staffMe!["role"].ToString()));

        // Выход поставщика не выбивает менеджера.
        await browser.PostAsync("/api/v1/auth/logout?portal=supplier", null);
        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/api/v1/supplier/requests")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/api/v1/stock")).StatusCode);
    }
}
