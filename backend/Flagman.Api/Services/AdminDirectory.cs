using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace Flagman.Api.Services;

/// <summary>Key - постоянный идентификатор учётки без самого ID (по нему поставщик видит свои заявки).</summary>
public sealed record AdminAccount(string Id, string Name, string Role, string Key);

public static class Roles
{
    public const string Manager = "manager";
    public const string Waiter = "waiter";
    public const string Supplier = "supplier";
    public static readonly string[] All = [Manager, Waiter, Supplier];

    public static string DefaultName(string role) => role switch
    {
        Waiter => "Официант",
        Supplier => "Поставщик",
        _ => "Администратор",
    };
}

public static class AuthSchemes
{
    /// <summary>Отдельная cookie кабинета поставщика (сотрудники - схема по умолчанию).</summary>
    public const string Supplier = "SupplierCookie";
}

public static class Policies
{
    /// <summary>Менеджер и официант.</summary>
    public const string Staff = "staff";
    public const string Manager = "manager";
    public const string Supplier = "supplier";
}

/// <summary>
/// Список учёток. Auth:AdminIds - ID через запятую, дальше через двоеточие имя и роль:
/// "1001:Иван, 1002:Анна:waiter, 1003:ООО Фермер:supplier". Без роли - менеджер.
/// Auth:AdminIdHashes - то же самое, но вместо ID хеш PBKDF2, его можно хранить в репозитории.
/// </summary>
public sealed class AdminDirectory
{
    private readonly IReadOnlyList<AdminAccount> _admins;
    private readonly IReadOnlyList<HashedAdmin> _hashed;
    // Проверка хеша медленная намеренно (~десятки мс), а ID сверяется на каждом запросе: успешные проверки запоминаются.
    private readonly ConcurrentDictionary<string, AdminAccount> _verified = new();

    private sealed record HashedAdmin(int Iterations, byte[] Salt, byte[] Hash, string Name, string Role);

    /// <summary>Имена переменной, которые принимаются (регистр не важен): основное и частые варианты набора.</summary>
    public static readonly string[] ConfigKeys = ["Auth:AdminIds", "Auth_AdminIds", "AUTH_ADMIN_IDS", "ADMIN_IDS", "AdminIds"];

    public AdminDirectory(IConfiguration config) : this(FromConfig(config), config["Auth:AdminIdHashes"]) { }

    /// <summary>Первое непустое значение среди <see cref="ConfigKeys"/>, а также переменные окружения с пробелами в имени.</summary>
    public static string? FromConfig(IConfiguration config)
    {
        foreach (var key in ConfigKeys)
            if (!string.IsNullOrWhiteSpace(config[key])) return config[key];
        foreach (var (key, value) in config.AsEnumerable())
            if (!string.IsNullOrWhiteSpace(value) && ConfigKeys.Any(k => string.Equals(key.Trim().Replace("__", ":"), k, StringComparison.OrdinalIgnoreCase)))
                return value;
        return null;
    }

    public AdminDirectory(string? raw, string? hashes = null)
    {
        _admins = Parse(raw);
        _hashed = ParseHashes(hashes);
    }

    public bool IsConfigured => _admins.Count > 0 || _hashed.Count > 0;

    /// <summary>Все учётки без самих ID (для демо-данных).</summary>
    public IReadOnlyList<(string Key, string Name, string Role)> Accounts =>
        [.. _admins.Select(a => (a.Key, a.Name, a.Role)), .. _hashed.Select(h => (HashedKey(h.Salt), h.Name, h.Role))];

    /// <summary>
    /// Разбирает "имя:роль" после ID. Роль только из списка; если в конце не роль, а что-то другое,
    /// запись пропускается, чтобы опечатка не дала права менеджера.
    /// </summary>
    private static (string Name, string Role)? ParseNameRole(string rest)
    {
        rest = rest.Trim();
        var role = Roles.Manager;
        var last = rest.LastIndexOf(':');
        if (last >= 0)
        {
            role = rest[(last + 1)..].Trim().ToLowerInvariant();
            if (!Roles.All.Contains(role)) return null;
            rest = rest[..last].Trim();
        }
        else if (Roles.All.Contains(rest.ToLowerInvariant()))
        {
            role = rest.ToLowerInvariant();
            rest = "";
        }
        return (rest.Length > 0 ? rest : Roles.DefaultName(role), role);
    }

    private static string HashedKey(byte[] salt) => "h:" + Convert.ToBase64String(salt);
    private static string PlainKey(string id) => "p:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(id)))[..16].ToLowerInvariant();

    private static IReadOnlyList<HashedAdmin> ParseHashes(string? raw)
    {
        var list = new List<HashedAdmin>();
        foreach (var entry in (raw ?? "").Split([',', ';', '\n'], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            var sep = entry.IndexOf(':');
            var parts = (sep < 0 ? entry : entry[..sep]).Split('$');
            if (ParseNameRole(sep < 0 ? "" : entry[(sep + 1)..]) is not { } nr) continue;
            if (parts.Length != 4 || parts[0] != "pbkdf2-sha256" || !int.TryParse(parts[1], out var iterations)) continue;
            try
            {
                list.Add(new HashedAdmin(iterations, Convert.FromBase64String(parts[2]), Convert.FromBase64String(parts[3]), nr.Name, nr.Role));
            }
            catch (FormatException) { }
        }
        return list;
    }

    /// <summary>Строка для <c>Auth:AdminIdHashes</c> по известному ID.</summary>
    public static string HashId(string id, int iterations = 210_000)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(id.Trim()), salt, iterations, HashAlgorithmName.SHA256, 32);
        return $"pbkdf2-sha256${iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static IReadOnlyList<AdminAccount> Parse(string? raw)
    {
        var list = new List<AdminAccount>();
        raw = (raw ?? "").Trim();
        // В поле значения часто вставляют строку целиком: "Auth__AdminIds=1001:Иван".
        var eq = raw.IndexOf('=');
        if (eq > 0 && ConfigKeys.Any(k => string.Equals(raw[..eq].Trim().Replace("__", ":"), k, StringComparison.OrdinalIgnoreCase)))
            raw = raw[(eq + 1)..];
        raw = raw.Trim().Trim('"', '\'', '«', '»').Trim();
        foreach (var entry in raw.Split([',', ';', '\n'], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            var sep = entry.IndexOf(':');
            var id = (sep < 0 ? entry : entry[..sep]).Trim();
            if (ParseNameRole(sep < 0 ? "" : entry[(sep + 1)..]) is not { } nr) continue;
            if (id.Length == 0 || list.Any(a => a.Id == id)) continue;
            list.Add(new AdminAccount(id, nr.Name, nr.Role, PlainKey(id)));
        }
        return list;
    }

    /// <summary>
    /// Учётка по ключу из cookie. Сам ID в cookie не хранится, а поиск по ключу не требует медленного PBKDF2,
    /// поэтому старая cookie удалённого сотрудника не нагружает сервер. Id у найденной так учётки пустой.
    /// </summary>
    public AdminAccount? FindByKey(string? key)
    {
        if (string.IsNullOrEmpty(key)) return null;
        if (_admins.FirstOrDefault(a => a.Key == key) is { } plain) return plain;
        return _hashed.FirstOrDefault(h => HashedKey(h.Salt) == key) is { } h ? new AdminAccount("", h.Name, h.Role, key) : null;
    }

    /// <summary>Ищет администратора по введённому ID; сравнение за постоянное время, без раннего выхода.</summary>
    public AdminAccount? Find(string? id)
    {
        var input = Encoding.UTF8.GetBytes((id ?? "").Trim());
        AdminAccount? found = null;
        foreach (var a in _admins)
            if (CryptographicOperations.FixedTimeEquals(input, Encoding.UTF8.GetBytes(a.Id)))
                found = a;
        if (input.Length == 0) return null;
        if (found is not null || _hashed.Count == 0) return found;

        var key = Convert.ToBase64String(SHA256.HashData(input));
        if (_verified.TryGetValue(key, out var cached)) return cached;
        foreach (var h in _hashed)
            if (CryptographicOperations.FixedTimeEquals(Rfc2898DeriveBytes.Pbkdf2(input, h.Salt, h.Iterations, HashAlgorithmName.SHA256, h.Hash.Length), h.Hash))
                return _verified[key] = new AdminAccount(Encoding.UTF8.GetString(input), h.Name, h.Role, HashedKey(h.Salt));
        return null;
    }
}
