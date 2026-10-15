using System.Data;
using Flagman.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Flagman.Api.Data;

/// <summary>
/// Добавляет новые таблицы и колонки в старую базу. EnsureCreated уже созданные таблицы не меняет,
/// поэтому новое добавляется тут вручную.
/// </summary>
public static class SchemaPatches
{
    private static readonly (string Table, string Column, string SqliteType, string PgType)[] AddedColumns =
    [
        ("Orders", "Title", "TEXT", $"character varying({OrderLimits.Title})"),
        ("Orders", "Comment", "TEXT", $"character varying({OrderLimits.Comment})"),
        ("Supplies", "SupplierRequestId", "TEXT", "uuid"),
    ];

    /// <summary>Таблицы, которых могло не быть в старой базе. DDL берём из модели EF, чтобы не писать SQL руками.</summary>
    private static readonly string[] NewTables = ["SupplierRequests", "SupplierRequestLines", "HotOfferOverrides", "TrashItems"];

    // Имена таблиц и колонок - константы этого класса, не пользовательский ввод: интерполяция безопасна,
    // а параметризовать имена идентификаторов в DDL нельзя.
#pragma warning disable EF1002
    public static async Task ApplyAsync(FlagmanDbContext db, CancellationToken ct)
    {
        foreach (var (table, column, sqliteType, pgType) in AddedColumns)
        {
            if (db.Database.IsNpgsql())
            {
                await db.Database.ExecuteSqlRawAsync(
                    $"ALTER TABLE \"{table}\" ADD COLUMN IF NOT EXISTS \"{column}\" {pgType} NULL", ct);
            }
            else if (db.Database.IsSqlite() && !await SqliteHasColumnAsync(db, table, column, ct))
            {
                await db.Database.ExecuteSqlRawAsync($"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {sqliteType} NULL", ct);
            }
        }
        await EnsureTablesAsync(db, ct);
    }

    private static async Task EnsureTablesAsync(FlagmanDbContext db, CancellationToken ct)
    {
        var script = db.Database.GenerateCreateScript();
        foreach (var raw in script.Split(';'))
        {
            var sql = raw.Trim();
            if (sql.Length == 0) continue;
            var table = NewTables.FirstOrDefault(t =>
                sql.StartsWith($"CREATE TABLE \"{t}\"", StringComparison.Ordinal) ||
                (sql.Contains("INDEX", StringComparison.Ordinal) && sql.Contains($" ON \"{t}\"", StringComparison.Ordinal)));
            var supplyIndex = sql.Contains("INDEX", StringComparison.Ordinal) && sql.Contains("\"IX_Supplies_SupplierRequestId\"", StringComparison.Ordinal);
            if (table is null && !supplyIndex) continue;
            sql = sql.Replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ", StringComparison.Ordinal)
                     .Replace("CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ", StringComparison.Ordinal)
                     .Replace("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ", StringComparison.Ordinal);
            await db.Database.ExecuteSqlRawAsync(sql, ct);
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
