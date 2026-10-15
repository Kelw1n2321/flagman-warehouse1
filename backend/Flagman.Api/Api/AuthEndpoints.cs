using System.Security.Claims;
using Flagman.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace Flagman.Api.Api;

/// <summary>Portal - откуда входят: "staff" (основной сайт) или "supplier" (кабинет поставщика).</summary>
public sealed record LoginRequest(string? Id, string? Portal = null);

/// <summary>Кто вошёл: имя, роль и хвост ID (сам ID - секрет, на экран целиком не выводится).</summary>
public sealed record SessionDto(string Name, string IdHint, string Role);

public static class AuthEndpoints
{
    /// <summary>Ключ учётки (не сам ID) и хвост ID для показа в меню.</summary>
    public const string AccountKeyClaim = "flagman:account";
    public const string IdHintClaim = "flagman:id-hint";

    public static void MapFlagmanAuth(this WebApplication app)
    {
        var auth = app.MapGroup("/api/v1/auth").WithTags("Вход").AllowAnonymous();

        auth.MapPost("/login", async (LoginRequest r, HttpContext http, AdminDirectory admins) =>
        {
            if (!admins.IsConfigured)
                return Results.Problem(statusCode: 503, title: "Вход не настроен: задайте ID администраторов в переменной окружения Auth__AdminIds.");
            if (admins.Find(r.Id) is not { } admin)
                return Results.Problem(statusCode: 401, title: "Неверный ID.");
            var supplierPortal = string.Equals(r.Portal, "supplier", StringComparison.OrdinalIgnoreCase);
            if (supplierPortal && admin.Role != Roles.Supplier)
                return Results.Problem(statusCode: 403, title: "Это ID сотрудника ресторана. Войдите на основном сайте.");
            if (!supplierPortal && admin.Role == Roles.Supplier)
                return Results.Problem(statusCode: 403, title: "Это ID поставщика. Войдите в кабинете поставщика: /supplier");

            var identity = new ClaimsIdentity(
                [new Claim(AccountKeyClaim, admin.Key), new Claim(IdHintClaim, Hint(admin.Id)), new Claim(ClaimTypes.Name, admin.Name), new Claim(ClaimTypes.Role, admin.Role)],
                CookieAuthenticationDefaults.AuthenticationScheme);
            await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
            return Results.Ok(ToDto(admin));
        }).RequireRateLimiting("login");

        auth.MapGet("/me", (ClaimsPrincipal user, AdminDirectory admins) =>
            admins.FindByKey(user.FindFirstValue(AccountKeyClaim)) is { } admin
                ? Results.Ok(new SessionDto(admin.Name, user.FindFirstValue(IdHintClaim) ?? "", admin.Role))
                : Results.Problem(statusCode: 401, title: "Требуется вход."));

        auth.MapPost("/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });
    }

    private static string Hint(string id) => id.Length <= 4 ? new string('•', id.Length) : "••" + id[^2..];

    private static SessionDto ToDto(AdminAccount a) => new(a.Name, Hint(a.Id), a.Role);
}
