using System.Text.Json;
using Flagman.Api.Data;
using Flagman.Api.Domain;
using Flagman.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Api.Api;

public sealed record AdjustRequest(decimal Quantity, string? Reason);
public sealed record WriteOffRequest(decimal? Quantity, string? Reason);
public sealed record OrderRequest(IReadOnlyList<OrderLineInput>? Lines, string? Title = null, string? Comment = null);
public sealed record AckRequest(IReadOnlyList<int>? Ids);
public sealed record MinStockRequest(decimal MinStock);

public static class Endpoints
{
    public static void MapFlagmanApi(this WebApplication app)
    {
        // Весь API склада - только после входа администратора (см. AuthEndpoints).
        var api = app.MapGroup("/api/v1").WithTags("Флагман").RequireAuthorization();

        // Сводка, настройки, события
        // Старый адрес проверки живости Render: запрос без cookie входа получает "ok" без данных склада,
        // вошедший администратор - сводку, истёкшая сессия - 401.
        api.MapGet("/summary", async (HttpContext http, QueryService q, CancellationToken ct) =>
            http.User.Identity?.IsAuthenticated == true ? Results.Ok(await q.GetSummaryAsync(ct))
            : http.Request.Cookies.ContainsKey("flagman.auth") ? Results.Problem(statusCode: 401, title: "Требуется вход.")
            : Results.Ok(new { status = "ok" })).AllowAnonymous();
        api.MapGet("/settings", async (WarehouseService w, QueryService q, CancellationToken ct) => q.ToSettingsDto(await w.GetSettingsAsync(ct)));
        api.MapPut("/settings", async (SettingsCommand cmd, WarehouseService w, QueryService q, CancellationToken ct) =>
            q.ToSettingsDto(await w.UpdateSettingsAsync(cmd, ct))).RequireRateLimiting("writes");

        api.MapGet("/events", async (HttpContext http, EventBus bus, CancellationToken ct) =>
        {
            http.Response.Headers.ContentType = "text/event-stream";
            http.Response.Headers.CacheControl = "no-cache";
            http.Response.Headers["X-Accel-Buffering"] = "no";
            var (id, reader) = bus.Subscribe();
            try
            {
                await http.Response.WriteAsync($"event: hello\ndata: {{\"version\":{bus.Version}}}\n\n", ct);
                await http.Response.Body.FlushAsync(ct);
                while (!ct.IsCancellationRequested)
                {
                    using var heartbeat = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    heartbeat.CancelAfter(TimeSpan.FromSeconds(15));
                    try
                    {
                        var evt = await reader.ReadAsync(heartbeat.Token);
                        await http.Response.WriteAsync($"event: changed\ndata: {JsonSerializer.Serialize(evt, JsonSerializerOptions.Web)}\n\n", ct);
                    }
                    catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                    {
                        await http.Response.WriteAsync(": ping\n\n", ct);
                    }
                    await http.Response.Body.FlushAsync(ct);
                }
            }
            catch (OperationCanceledException) { }
            finally { bus.Unsubscribe(id); }
        });

        // Склад
        api.MapGet("/stock", (string? search, string? category, string? filter, string? sort, QueryService q, CancellationToken ct) =>
            q.GetStockAsync(search, category, filter, sort, ct));
        api.MapGet("/products/{id:int}", async (int id, QueryService q, CancellationToken ct) =>
            await q.GetProductAsync(id, ct) is { } p ? Results.Ok(p) : Results.Problem(statusCode: 404, title: "Продукт не найден"));
        api.MapPost("/products", async (CreateProductCommand cmd, WarehouseService w, CancellationToken ct) =>
        {
            var p = await w.CreateProductAsync(cmd, ct);
            return Results.Created($"/api/v1/products/{p.Id}", new { p.Id, p.Sku, p.Name });
        }).RequireRateLimiting("writes");
        api.MapPatch("/products/{id:int}/min-stock", async (int id, MinStockRequest r, WarehouseService w, CancellationToken ct) =>
        {
            var p = await w.UpdateMinStockAsync(id, r.MinStock, ct);
            return Results.Ok(new { p.Id, p.MinStock });
        }).RequireRateLimiting("writes");
        api.MapGet("/movements", (int? productId, string? type, int? limit, QueryService q, CancellationToken ct) =>
            q.GetMovementsAsync(productId, type, limit ?? 100, ct));

        // Партии и сроки
        api.MapGet("/batches", (string? expiry, int? productId, string? category, bool? includeClosed, string? search, QueryService q, CancellationToken ct) =>
            q.GetBatchesAsync(expiry, productId, category, includeClosed ?? false, search, ct));
        api.MapPost("/batches/{id:int}/adjust", async (int id, AdjustRequest r, WarehouseService w, CancellationToken ct) =>
        {
            var b = await w.AdjustBatchAsync(id, r.Quantity, r.Reason, ct);
            return Results.Ok(new { b.Id, b.QuantityRemaining });
        }).RequireRateLimiting("writes");
        api.MapPost("/batches/{id:int}/write-off", async (int id, WriteOffRequest r, WarehouseService w, CancellationToken ct) =>
        {
            var b = await w.WriteOffBatchAsync(id, r.Quantity, r.Reason, ct);
            return Results.Ok(new { b.Id, b.QuantityRemaining });
        }).RequireRateLimiting("writes");
        api.MapPost("/batches/write-off-expired", async (WarehouseService w, CancellationToken ct) =>
            Results.Ok(new { writtenOff = await w.WriteOffExpiredAsync(false, ct) })).RequireRateLimiting("writes");

        // Поставки
        api.MapGet("/supplies", (string? search, string? status, QueryService q, CancellationToken ct) => q.GetSuppliesAsync(search, status, ct));
        api.MapGet("/supplies/recommendations", (QueryService q, CancellationToken ct) => q.GetSupplyRecommendationsAsync(ct));
        api.MapGet("/supplies/{id:guid}", async (Guid id, QueryService q, CancellationToken ct) =>
            await q.GetSupplyAsync(id, ct) is { } s ? Results.Ok(s) : Results.Problem(statusCode: 404, title: "Поставка не найдена"));
        api.MapPost("/supplies", async (CreateSupplyCommand cmd, WarehouseService w, QueryService q, CancellationToken ct) =>
        {
            var s = await w.CreateSupplyAsync(cmd, ct);
            return Results.Created($"/api/v1/supplies/{s.Id}", await q.GetSupplyAsync(s.Id, ct));
        }).RequireRateLimiting("writes");
        api.MapPost("/supplies/{id:guid}/receive", async (Guid id, WarehouseService w, QueryService q, CancellationToken ct) =>
        {
            await w.ReceiveSupplyAsync(id, ct);
            return Results.Ok(await q.GetSupplyAsync(id, ct));
        }).RequireRateLimiting("writes");
        api.MapPost("/supplies/{id:guid}/cancel", async (Guid id, WarehouseService w, QueryService q, CancellationToken ct) =>
        {
            await w.CancelSupplyAsync(id, ct);
            return Results.Ok(await q.GetSupplyAsync(id, ct));
        }).RequireRateLimiting("writes");

        // Блюда
        api.MapGet("/dishes", (bool? includeInactive, QueryService q, CancellationToken ct) => q.GetDishesAsync(includeInactive ?? false, ct));
        api.MapPut("/dishes/{id:int}", async (int id, UpdateDishCommand cmd, WarehouseService w, CancellationToken ct) =>
        {
            var d = await w.UpdateDishAsync(id, cmd, ct);
            return Results.Ok(new { d.Id, d.Name });
        }).RequireRateLimiting("writes");
        api.MapPost("/dishes", async (UpdateDishCommand cmd, WarehouseService w, CancellationToken ct) =>
        {
            var d = await w.CreateDishAsync(cmd, ct);
            return Results.Created($"/api/v1/dishes/{d.Id}", new { d.Id, d.Name });
        }).RequireRateLimiting("writes");
        api.MapPost("/dishes/availability-check", async (OrderRequest r, WarehouseService w, QueryService q, CancellationToken ct) =>
        {
            var (evaluation, snapshot) = await w.CheckOrderAsync(r.Lines, ct);
            return q.ToCheckDto(evaluation, snapshot);
        });

        // Заказы
        api.MapGet("/orders", (string? status, string? search, int? limit, QueryService q, CancellationToken ct) =>
            q.GetOrdersAsync(status, search, limit ?? 100, ct));
        api.MapGet("/orders/{id:guid}", async (Guid id, QueryService q, CancellationToken ct) =>
            await q.GetOrderAsync(id, ct) is { } o ? Results.Ok(o) : Results.Problem(statusCode: 404, title: "Заказ не найден"));
        api.MapPost("/orders", async (OrderRequest r, WarehouseService w, QueryService q, CancellationToken ct) =>
        {
            var outcome = await w.PlaceOrderAsync(r.Lines, "manual", ct, title: r.Title, comment: r.Comment);
            var dto = await q.GetOrderAsync(outcome.Order.Id, ct);
            // Отклонённый заказ тоже сохраняется (для статистики), но клиенту возвращается 409 с причиной.
            return outcome.Order.Status == OrderStatus.Completed
                ? Results.Created($"/api/v1/orders/{outcome.Order.Id}", dto)
                : Results.Json(dto, statusCode: StatusCodes.Status409Conflict);
        }).RequireRateLimiting("writes");

        // Стоп-лист, предложения, статистика, предупреждения
        api.MapGet("/stop-list", (QueryService q, CancellationToken ct) => q.GetStopListAsync(ct));
        api.MapGet("/hot-offers", (QueryService q, CancellationToken ct) => q.GetHotOffersAsync(ct));
        api.MapGet("/stats", (int? days, string? category, QueryService q, CancellationToken ct) => q.GetStatsAsync(days ?? 7, category, ct));
        api.MapGet("/alerts", (string? status, int? limit, QueryService q, CancellationToken ct) => q.GetAlertsAsync(status, limit ?? 200, ct));
        api.MapPost("/alerts/acknowledge", async (AckRequest r, WarehouseService w, CancellationToken ct) =>
            Results.Ok(new { acknowledged = await w.AcknowledgeAlertsAsync(r.Ids, ct) })).RequireRateLimiting("writes");

        // Демо-режим
        api.MapPost("/demo/reset", async (IServiceProvider sp, WriteGate gate, EventBus bus, WarehouseService w, IConfiguration config, CancellationToken ct) =>
        {
            if (!config.GetValue("Demo:AllowReset", true)) return Results.Problem(statusCode: 403, title: "Сброс отключён в этом окружении");
            using (await gate.AcquireAsync(ct))
            {
                var db = sp.GetRequiredService<FlagmanDbContext>();
                await db.Database.EnsureDeletedAsync(ct);
                await db.Database.EnsureCreatedAsync(ct);
            }
            await DemoSeeder.SeedAsync(sp, ct);
            bus.Publish("demo.reset", w.UtcNow);
            return Results.Ok(new { reset = true });
        }).RequireRateLimiting("writes");
    }
}
