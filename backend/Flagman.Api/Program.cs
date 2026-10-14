using System.IO.Compression;
using System.Threading.RateLimiting;
using Flagman.Api.Api;
using Flagman.Api.Data;
using Flagman.Api.Services;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.ResponseCompression;
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
// Сжатие JSON и статики: ответы склада в 5–10 раз меньше, что заметно на медленной сети.
// Поток событий (text/event-stream) в список типов не входит и уходит без буферизации.
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<BrotliCompressionProvider>();
    o.Providers.Add<GzipCompressionProvider>();
    o.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(["application/problem+json", "image/svg+xml"]);
});
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
builder.Services.Configure<GzipCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("writes", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "local",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1) }));
    // Подбор ID: не больше 10 попыток входа в минуту с одного адреса.
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "local",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});

// Вход администратора по ID (Auth:AdminIds): после входа — защищённая cookie на 12 часов со скользящим продлением.
builder.Services.AddSingleton<AdminDirectory>();
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = "flagman.auth";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    o.ExpireTimeSpan = TimeSpan.FromHours(12);
    o.SlidingExpiration = true;
    // API отвечает кодами, а не перенаправлением на страницу входа.
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    // ID убрали из настроек — его сессии перестают действовать сразу, а не через 12 часов.
    o.Events.OnValidatePrincipal = ctx =>
    {
        var admins = ctx.HttpContext.RequestServices.GetRequiredService<AdminDirectory>();
        if (admins.Find(ctx.Principal?.FindFirst(AuthEndpoints.AdminIdClaim)?.Value) is null) ctx.RejectPrincipal();
        return Task.CompletedTask;
    };
});
builder.Services.AddAuthorization();
// За прокси Render: схема https из X-Forwarded-Proto, чтобы cookie получала флаг Secure.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

var app = builder.Build();

if (!app.Services.GetRequiredService<AdminDirectory>().IsConfigured)
    app.Logger.LogWarning("Не задан ни один ID администратора (Auth__AdminIds) — войти в систему будет невозможно. Переменные окружения со словом admin: {Names}",
        string.Join(", ", Environment.GetEnvironmentVariables().Keys.Cast<string>().Where(k => k.Contains("admin", StringComparison.OrdinalIgnoreCase)).Select(k => $"«{k}»")) is { Length: > 0 } names ? names : "нет");

app.UseForwardedHeaders();

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

app.UseResponseCompression();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseDefaultFiles();
// index.html не кэшируется (иначе после сборки браузер держит старые ассеты), хэшированные ассеты — надолго.
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl =
        ctx.File.Name == "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
});
// Проверка живости для Render — без входа и без данных склада.
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
app.MapFlagmanAuth();
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
        await SchemaPatches.ApplyAsync(db, CancellationToken.None);
        if (!await db.Settings.AnyAsync())
        {
            db.Settings.Add(new Flagman.Api.Domain.WarehouseSettings());
            await db.SaveChangesAsync();
        }
    }
}

app.Run();

public partial class Program;
