using System.Security.Claims;
using Flagman.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace Flagman.Api.Api;

public sealed record LoginRequest(string? Id);

/// <summary>Кто вошёл: имя и хвост ID (сам ID - секрет, на экран целиком не выводится).</summary>
public sealed record SessionDto(string Name, string IdHint);

public static class AuthEndpoints
{
    public const string AdminIdClaim = "flagman:admin-id";

    public static void MapFlagmanAuth(this WebApplication app)
    {
        var auth = app.MapGroup("/api/v1/auth").WithTags("Вход").AllowAnonymous();

        auth.MapPost("/login", async (LoginRequest r, HttpContext http, AdminDirectory admins) =>
        {
            if (!admins.IsConfigured)
                return Results.Problem(statusCode: 503, title: "Вход не настроен: задайте ID администраторов в переменной окружения Auth__AdminIds.");
            if (admins.Find(r.Id) is not { } admin)
                return Results.Problem(statusCode: 401, title: "Неверный ID администратора.");

            var identity = new ClaimsIdentity(
                [new Claim(AdminIdClaim, admin.Id), new Claim(ClaimTypes.Name, admin.Name)],
                CookieAuthenticationDefaults.AuthenticationScheme);
            await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
            return Results.Ok(ToDto(admin));
        }).RequireRateLimiting("login");

        auth.MapGet("/me", (ClaimsPrincipal user, AdminDirectory admins) =>
            admins.Find(user.FindFirstValue(AdminIdClaim)) is { } admin
                ? Results.Ok(ToDto(admin))
                : Results.Problem(statusCode: 401, title: "Требуется вход."));

        auth.MapPost("/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });
    }

    private static SessionDto ToDto(AdminAccount a) =>
        new(a.Name, a.Id.Length <= 4 ? new string('•', a.Id.Length) : "••" + a.Id[^2..]);
}
