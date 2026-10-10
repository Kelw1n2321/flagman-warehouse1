using System.Threading.RateLimiting;
using Flagman.Api.Api;
using Flagman.Api.Data;
using Flagman.Api.Services;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// База данных: SQLite для демонстрационного режима, PostgreSQL — для производственного (Database:Provider=postgres).
var provider = builder.Configuration["Database:Provider"] ?? "sqlite";
builder.Services.AddDbContext<FlagmanDbContext>(o =>
{
    if (provider.Equals("postgres", StringComparison.OrdinalIgnoreCase))
        o.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")
            ?? throw new InvalidOperationException("Не задана строка подключения ConnectionStrings:Postgres"));
    else
    {
        var cs = builder.Configuration.GetConnectionString("Sqlite") ?? "Data Source=App_Data/flagman.db";
        Directory.CreateDirectory(Path.Combine(builder.Environment.ContentRootPath, "App_Data"));
        o.UseSqlite(cs);
    }
});

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<WriteGate>();
builder.Services.AddSingleton<EventBus>();
builder.Services.AddScoped<WarehouseService>();
builder.Services.AddScoped<QueryService>();
builder.Services.AddHostedService<ExpiryMonitor>();
builder.Services.AddHostedService<EventGenerator>();
builder.Services.AddProblemDetails();
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("writes", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "local",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();

app.UseExceptionHandler(errorApp => errorApp.Run(async ctx =>
{
    var ex = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
    var (status, title, errors) = ex switch
    {
        DomainException d => (d.Status, d.Message, d.Errors),
        BadHttpRequestException => (400, "Некорректный запрос: проверьте формат данных.", null),
        _ => (500, "Внутренняя ошибка сервера. Попробуйте ещё раз.", (IDictionary<string, string[]>?)null),
    };
    if (status == 500) app.Logger.LogError(ex, "Необработанная ошибка");
    ctx.Response.StatusCode = status;
    await Results.Problem(statusCode: status, title: title,
        extensions: errors is null ? null : new Dictionary<string, object?> { ["errors"] = errors }).ExecuteAsync(ctx);
}));

app.UseRateLimiter();
app.UseDefaultFiles();
// index.html не кэшируется (иначе после сборки браузер держит старые ассеты), хэшированные ассеты — надолго.
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl =
        ctx.File.Name == "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
});
app.MapFlagmanApi();
app.MapFallbackToFile("index.html", new StaticFileOptions
{
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache",
});

using (var scope = app.Services.CreateScope())
{
    // Демо-режим наполняет пустую базу историей; в производственном режиме база создаётся пустой.
    if (app.Configuration.GetValue("Demo:SeedOnStart", true))
        await DemoSeeder.EnsureSeededAsync(scope.ServiceProvider, CancellationToken.None);
    else
    {
        var db = scope.ServiceProvider.GetRequiredService<FlagmanDbContext>();
        await db.Database.EnsureCreatedAsync();
        if (!await db.Settings.AnyAsync())
        {
            db.Settings.Add(new Flagman.Api.Domain.WarehouseSettings());
            await db.SaveChangesAsync();
        }
    }
}

app.Run();

public partial class Program;
