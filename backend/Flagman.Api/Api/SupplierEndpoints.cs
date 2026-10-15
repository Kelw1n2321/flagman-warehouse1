using System.Security.Claims;
using Flagman.Api.Services;

namespace Flagman.Api.Api;

/// <summary>API кабинета поставщика. Поставщик видит только каталог товаров и свои заявки.</summary>
public static class SupplierEndpoints
{
    public static void MapFlagmanSupplier(this WebApplication app)
    {
        var sup = app.MapGroup("/api/v1/supplier").WithTags("Поставщик").RequireAuthorization(Policies.Supplier);

        sup.MapGet("/products", (QueryService q, CancellationToken ct) => q.GetSupplierProductsAsync(ct));
        sup.MapGet("/requests", (ClaimsPrincipal u, AdminDirectory admins, QueryService q, CancellationToken ct) =>
            q.GetSupplierRequestsAsync(Me(u, admins).Key, null, ct));
        sup.MapGet("/requests/{id:guid}", async (Guid id, ClaimsPrincipal u, AdminDirectory admins, QueryService q, CancellationToken ct) =>
            await q.GetSupplierRequestAsync(id, Me(u, admins).Key, ct) is { } r ? Results.Ok(r) : Results.Problem(statusCode: 404, title: "Заявка не найдена"));
        sup.MapPost("/requests", async (SupplierRequestCommand cmd, ClaimsPrincipal u, AdminDirectory admins,
            WarehouseService w, QueryService q, CancellationToken ct) =>
        {
            var me = Me(u, admins);
            var r = await w.CreateSupplierRequestAsync(cmd, me.Key, me.Name, ct);
            return Results.Created($"/api/v1/supplier/requests/{r.Id}", await q.GetSupplierRequestAsync(r.Id, me.Key, ct));
        }).RequireRateLimiting("writes");
    }

    // Учётка уже проверена при входе и на каждом запросе (OnValidatePrincipal), поэтому здесь она всегда есть.
    private static AdminAccount Me(ClaimsPrincipal u, AdminDirectory admins) =>
        admins.FindByKey(u.FindFirstValue(AuthEndpoints.AccountKeyClaim)) ?? throw new DomainException(401, "Требуется вход.");
}
