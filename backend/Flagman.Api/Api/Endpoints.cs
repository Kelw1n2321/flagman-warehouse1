using System.Security.Claims;
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
    /// <summary>Кто выполнил действие - имя из учётки (для корзины и заявок).</summary>
    public static string Actor(ClaimsPrincipal u) => u.FindFirstValue(ClaimTypes.Name) ?? "Сотрудник";

    public static void MapFlagmanApi(this WebApplication app)
    {
        // Весь API склада - только после входа (см. AuthEndpoints).
        // Права: staff - менеджер и официант, mgr - только менеджер. Группы раздельные, потому что
        // политики вложенных групп складываются (И), а не заменяют друг друга.
        var api = app.MapGroup("/api/v1").WithTags("Флагман");
        var staff = api.MapGroup("").RequireAuthorization(Policies.Staff);
        var mgr = api.MapGroup("").RequireAuthorization(Policies.Manager);

        // Сводка, настройки, события
        // Старый адрес проверки живости Render: запрос без cookie входа получает "ok" без данных склада,
        // вошедший сотрудник - сводку, поставщик - 403, истёкшая сессия - 401.
        api.MapGet("/summary", async (HttpContext http, QueryService q, CancellationToken ct) =>
            http.User.IsInRole(Roles.Manager) || http.User.IsInRole(Roles.Waiter) ? Results.Ok(await q.GetSummaryAsync(ct))
            : http.User.Identity?.IsAuthenticated == true ? Results.Problem(statusCode: 403, title: "Нет доступа.")
            : http.Request.Cookies.ContainsKey("flagman.auth") ? Results.Problem(statusCode: 401, title: "Требуется вход.")
            : Results.Ok(new { status = "ok" })).AllowAnonymous();
        mgr.MapGet("/settings", async (WarehouseService w, QueryService q, CancellationToken ct) => q.ToSettingsDto(await w.GetSettingsAsync(ct)));
        mgr.MapPut("/settings", async (SettingsCommand cmd, WarehouseService w, QueryService q, CancellationToken ct) =>
            q.ToSettingsDto(await w.UpdateSettingsAsync(cmd, ct))).RequireRateLimiting("writes");

        staff.MapGet("/events", async (HttpContext http, EventBus bus, CancellationToken ct) =>
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
        mgr.MapGet("/stock", (string? search, string? category, string? filter, string? sort, QueryService q, CancellationToken ct) =>
            q.GetStockAsync(search, category, filter, sort, ct));
        mgr.MapGet("/products/{id:int}", async (int id, QueryService q, CancellationToken ct) =>
            await q.GetProductAsync(id, ct) is { } p ? Results.Ok(p) : Results.Problem(statusCode: 404, title: "Продукт не найден"));
        mgr.MapPost("/products", async (CreateProductCommand cmd, WarehouseService w, CancellationToken ct) =>
        {
            var p = await w.CreateProductAsync(cmd, ct);
            return Results.Created($"/api/v1/products/{p.Id}", new { p.Id, p.Sku, p.Name });
        }).RequireRateLimiting("writes");
        mgr.MapPatch("/products/{id:int}/min-stock", async (int id, MinStockRequest r, WarehouseService w, CancellationToken ct) =>
        {
            var p = await w.UpdateMinStockAsync(id, r.MinStock, ct);
            return Results.Ok(new { p.Id, p.MinStock });
        }).RequireRateLimiting("writes");
        mgr.MapGet("/movements", (int? productId, string? type, int? limit, QueryService q, CancellationToken ct) =>
            q.GetMovementsAsync(productId, type, limit ?? 100, ct));

        // Партии и сроки
        mgr.MapGet("/batches", (string? expiry, int? productId, string? category, bool? includeClosed, string? search, QueryService q, CancellationToken ct) =>
            q.GetBatchesAsync(expiry, productId, category, includeClosed ?? false, search, ct));
        mgr.MapPost("/batches/{id:int}/adjust", async (int id, AdjustRequest r, WarehouseService w, CancellationToken ct) =>
        {
            var b = await w.AdjustBatchAsync(id, r.Quantity, r.Reason, ct);
            return Results.Ok(new { b.Id, b.QuantityRemaining });
        }).RequireRateLimiting("writes");
        mgr.MapPost("/batches/{id:int}/write-off", async (int id, WriteOffRequest r, ClaimsPrincipal u, WarehouseService w, CancellationToken ct) =>
        {
            var b = await w.WriteOffBatchAsync(id, r.Quantity, r.Reason, ct, actor: Actor(u));
            return Results.Ok(new { b.Id, b.QuantityRemaining });
        }).RequireRateLimiting("writes");
        mgr.MapPost("/batches/write-off-expired", async (ClaimsPrincipal u, WarehouseService w, CancellationToken ct) =>
            Results.Ok(new { writtenOff = await w.WriteOffExpiredAsync(false, ct, actor: Actor(u)) })).RequireRateLimiting("writes");

        // Корзина списаний
        mgr.MapGet("/trash", (string? kind, string? search, QueryService q, CancellationToken ct) => q.GetTrashAsync(kind, search, ct));
        mgr.MapPost("/trash/{id:int}/restore", async (int id, ClaimsPrincipal u, WarehouseService w, CancellationToken ct) =>
        {
            var t = await w.RestoreTrashItemAsync(id, Actor(u), ct);
            return Results.Ok(new { t.Id, restored = true });
        }).RequireRateLimiting("writes");
        mgr.MapPost("/trash/{id:int}/purge", async (int id, ClaimsPrincipal u, WarehouseService w, CancellationToken ct) =>
        {
            var t = await w.PurgeTrashItemAsync(id, Actor(u), ct);
            return Results.Ok(new { t.Id, purged = true });
        }).RequireRateLimiting("writes");

        // Заявки поставщиков (сторона менеджера)
        mgr.MapGet("/supplier-requests", (string? status, QueryService q, CancellationToken ct) => q.GetSupplierRequestsAsync(null, status, ct));
        mgr.MapGet("/supplier-requests/{id:guid}", async (Guid id, QueryService q, CancellationToken ct) =>
            await q.GetSupplierRequestAsync(id, null, ct) is { } r ? Results.Ok(r) : Results.Problem(statusCode: 404, title: "Заявка не найдена"));
        mgr.MapPost("/supplier-requests/{id:guid}/accept", async (Guid id, AcceptSupplierRequestCommand cmd, ClaimsPrincipal u,
            WarehouseService w, QueryService q, CancellationToken ct) =>
        {
            await w.AcceptSupplierRequestAsync(id, cmd, Actor(u), ct);
            return Results.Ok(await q.GetSupplierRequestAsync(id, null, ct));
        }).RequireRateLimiting("writes");
        mgr.MapPost("/supplier-requests/{id:guid}/reject", async (Guid id, RejectSupplierRequestCommand cmd, ClaimsPrincipal u,
            WarehouseService w, QueryService q, CancellationToken ct) =>
        {
            await w.RejectSupplierRequestAsync(id, cmd.Reason, Actor(u), ct);
            return Results.Ok(await q.GetSupplierRequestAsync(id, null, ct));
        }).RequireRateLimiting("writes");

        // Поставки
        mgr.MapGet("/supplies", (string? search, string? status, QueryService q, CancellationToken ct) => q.GetSuppliesAsync(search, status, ct));
        mgr.MapGet("/supplies/recommendations", (QueryService q, CancellationToken ct) => q.GetSupplyRecommendationsAsync(ct));
        mgr.MapGet("/supplies/{id:guid}", async (Guid id, QueryService q, CancellationToken ct) =>
            await q.GetSupplyAsync(id, ct) is { } s ? Results.Ok(s) : Results.Problem(statusCode: 404, title: "Поставка не найдена"));
        mgr.MapPost("/supplies", async (CreateSupplyCommand cmd, WarehouseService w, QueryService q, CancellationToken ct) =>
        {
            var s = await w.CreateSupplyAsync(cmd, ct);
            return Results.Created($"/api/v1/supplies/{s.Id}", await q.GetSupplyAsync(s.Id, ct));
        }).RequireRateLimiting("writes");
        mgr.MapPost("/supplies/{id:guid}/receive", async (Guid id, WarehouseService w, QueryService q, CancellationToken ct) =>
        {
            await w.ReceiveSupplyAsync(id, ct);
            return Results.Ok(await q.GetSupplyAsync(id, ct));
        }).RequireRateLimiting("writes");
        mgr.MapPost("/supplies/{id:guid}/cancel", async (Guid id, WarehouseService w, QueryService q, CancellationToken ct) =>
        {
            await w.CancelSupplyAsync(id, ct);
            return Results.Ok(await q.GetSupplyAsync(id, ct));
        }).RequireRateLimiting("writes");

        // Блюда
        // Выключенные из меню блюда видит только менеджер.
        staff.MapGet("/dishes", (bool? includeInactive, ClaimsPrincipal u, QueryService q, CancellationToken ct) =>
            q.GetDishesAsync(includeInactive == true && u.IsInRole(Roles.Manager), ct));
        mgr.MapPut("/dishes/{id:int}", async (int id, UpdateDishCommand cmd, WarehouseService w, CancellationToken ct) =>
        {
            var d = await w.UpdateDishAsync(id, cmd, ct);
            return Results.Ok(new { d.Id, d.Name });
        }).RequireRateLimiting("writes");
        mgr.MapPost("/dishes", async (UpdateDishCommand cmd, WarehouseService w, CancellationToken ct) =>
        {
            var d = await w.CreateDishAsync(cmd, ct);
            return Results.Created($"/api/v1/dishes/{d.Id}", new { d.Id, d.Name });
        }).RequireRateLimiting("writes");
        mgr.MapPost("/dishes/availability-check", async (OrderRequest r, WarehouseService w, QueryService q, CancellationToken ct) =>
        {
            var (evaluation, snapshot) = await w.CheckOrderAsync(r.Lines, ct);
            return q.ToCheckDto(evaluation, snapshot);
        });

        // Заказы
        staff.MapGet("/orders", (string? status, string? search, int? limit, QueryService q, CancellationToken ct) =>
            q.GetOrdersAsync(status, search, limit ?? 100, ct));
        staff.MapGet("/orders/{id:guid}", async (Guid id, QueryService q, CancellationToken ct) =>
            await q.GetOrderAsync(id, ct) is { } o ? Results.Ok(o) : Results.Problem(statusCode: 404, title: "Заказ не найден"));
        staff.MapPost("/orders", async (OrderRequest r, WarehouseService w, QueryService q, CancellationToken ct) =>
        {
            var outcome = await w.PlaceOrderAsync(r.Lines, "manual", ct, title: r.Title, comment: r.Comment);
            var dto = await q.GetOrderAsync(outcome.Order.Id, ct);
            // Отклонённый заказ тоже сохраняется (для статистики), но клиенту возвращается 409 с причиной.
            return outcome.Order.Status == OrderStatus.Completed
                ? Results.Created($"/api/v1/orders/{outcome.Order.Id}", dto)
                : Results.Json(dto, statusCode: StatusCodes.Status409Conflict);
        }).RequireRateLimiting("writes");

        // Стоп-лист, предложения, статистика, предупреждения
        staff.MapGet("/stop-list", (QueryService q, CancellationToken ct) => q.GetStopListAsync(ct));
        staff.MapGet("/hot-offers", (ClaimsPrincipal u, QueryService q, CancellationToken ct) => q.GetHotOffersAsync(ct, u.IsInRole(Roles.Manager)));
        mgr.MapPut("/hot-offers/overrides/{dishId:int}", async (int dishId, HotOverrideCommand cmd, ClaimsPrincipal u, WarehouseService w, CancellationToken ct) =>
        {
            var o = await w.SetHotOverrideAsync(dishId, cmd, Actor(u), ct);
            return Results.Ok(new { o.DishId, mode = o.Mode == HotOverrideMode.Pin ? "pin" : "hide", o.Note, o.Until });
        }).RequireRateLimiting("writes");
        mgr.MapDelete("/hot-offers/overrides/{dishId:int}", async (int dishId, WarehouseService w, CancellationToken ct) =>
        {
            await w.ClearHotOverrideAsync(dishId, ct);
            return Results.NoContent();
        }).RequireRateLimiting("writes");
        mgr.MapGet("/stats", (int? days, string? category, QueryService q, CancellationToken ct) => q.GetStatsAsync(days ?? 7, category, ct));
        mgr.MapGet("/alerts", (string? status, int? limit, QueryService q, CancellationToken ct) => q.GetAlertsAsync(status, limit ?? 200, ct));
        mgr.MapPost("/alerts/acknowledge", async (AckRequest r, WarehouseService w, CancellationToken ct) =>
            Results.Ok(new { acknowledged = await w.AcknowledgeAlertsAsync(r.Ids, ct) })).RequireRateLimiting("writes");

        // Демо-режим
        mgr.MapPost("/demo/reset", async (IServiceProvider sp, WriteGate gate, EventBus bus, WarehouseService w, IConfiguration config, CancellationToken ct) =>
        {
            if (!config.GetValue("Demo:AllowReset", false)) return Results.Problem(statusCode: 403, title: "Сброс отключён в этом окружении");
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
