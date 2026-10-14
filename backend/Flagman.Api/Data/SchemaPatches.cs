using System.Data;
using Flagman.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Api.Data;

/// <summary>
/// Добавляет новые колонки в старую базу. EnsureCreated уже созданные таблицы не меняет,
/// поэтому новые поля добавляются тут вручную.
/// </summary>
public static class SchemaPatches
{
    private static readonly (string Table, string Column, int MaxLength)[] AddedColumns =
    [
        ("Orders", "Title", OrderLimits.Title),
        ("Orders", "Comment", OrderLimits.Comment),
    ];

    // Имена таблиц и колонок - константы этого класса, не пользовательский ввод: интерполяция безопасна,
    // а параметризовать имена идентификаторов в DDL нельзя.
#pragma warning disable EF1002
    public static async Task ApplyAsync(FlagmanDbContext db, CancellationToken ct)
    {
        foreach (var (table, column, maxLength) in AddedColumns)
        {
            if (db.Database.IsNpgsql())
            {
                await db.Database.ExecuteSqlRawAsync(
                    $"ALTER TABLE \"{table}\" ADD COLUMN IF NOT EXISTS \"{column}\" character varying({maxLength}) NULL", ct);
            }
            else if (db.Database.IsSqlite() && !await SqliteHasColumnAsync(db, table, column, ct))
            {
                await db.Database.ExecuteSqlRawAsync($"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" TEXT NULL", ct);
            }
        }
    }
#pragma warning restore EF1002

    private static async Task<bool> SqliteHasColumnAsync(FlagmanDbContext db, string table, string column, CancellationToken ct)
    {
        var conn = db.Database.GetDbConnection();
        var opened = conn.State != ConnectionState.Open;
        if (opened) await conn.OpenAsync(ct);
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"PRAGMA table_info(\"{table}\")";
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                if (string.Equals(reader.GetString(1), column, StringComparison.OrdinalIgnoreCase))
                    return true;
            return false;
        }
        finally
        {
            if (opened) await conn.CloseAsync();
        }
    }
}
