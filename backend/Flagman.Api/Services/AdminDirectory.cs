using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace Flagman.Api.Services;

public sealed record AdminAccount(string Id, string Name);

/// <summary>
/// Список админов. Auth:AdminIds - ID через запятую, после двоеточия можно имя: "1001:Иван, 1002".
/// Auth:AdminIdHashes - то же самое, но вместо ID хеш PBKDF2, его можно хранить в репозитории.
/// </summary>
public sealed class AdminDirectory
{
    private readonly IReadOnlyList<AdminAccount> _admins;
    private readonly IReadOnlyList<HashedAdmin> _hashed;
    // Проверка хеша медленная намеренно (~десятки мс), а ID сверяется на каждом запросе: успешные проверки запоминаются.
    private readonly ConcurrentDictionary<string, AdminAccount> _verified = new();

    private sealed record HashedAdmin(int Iterations, byte[] Salt, byte[] Hash, string Name);

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

    private static IReadOnlyList<HashedAdmin> ParseHashes(string? raw)
    {
        var list = new List<HashedAdmin>();
        foreach (var entry in (raw ?? "").Split([',', ';', '\n'], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            var sep = entry.IndexOf(':');
            var parts = (sep < 0 ? entry : entry[..sep]).Split('$');
            var name = sep < 0 ? "" : entry[(sep + 1)..].Trim();
            if (parts.Length != 4 || parts[0] != "pbkdf2-sha256" || !int.TryParse(parts[1], out var iterations)) continue;
            try
            {
                list.Add(new HashedAdmin(iterations, Convert.FromBase64String(parts[2]), Convert.FromBase64String(parts[3]), name.Length > 0 ? name : "Администратор"));
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
            var name = sep < 0 ? "" : entry[(sep + 1)..].Trim();
            if (id.Length == 0 || list.Any(a => a.Id == id)) continue;
            list.Add(new AdminAccount(id, name.Length > 0 ? name : "Администратор"));
        }
        return list;
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
                return _verified[key] = new AdminAccount(Encoding.UTF8.GetString(input), h.Name);
        return null;
    }
}
