using System.Security.Cryptography;
using System.Text;

namespace Flagman.Api.Services;

public sealed record AdminAccount(string Id, string Name);

/// <summary>
/// Список администраторов из настройки <c>Auth:AdminIds</c>: записи через запятую или точку с запятой,
/// у записи может быть имя — <c>1001:Иван Петров, 1002</c>. Вход — по ID, поэтому ID должен быть
/// длинным и известным только администратору (это его пароль).
/// </summary>
public sealed class AdminDirectory
{
    private readonly IReadOnlyList<AdminAccount> _admins;

    /// <summary>Имена переменной, которые принимаются (регистр не важен): основное и частые варианты набора.</summary>
    public static readonly string[] ConfigKeys = ["Auth:AdminIds", "Auth_AdminIds", "AUTH_ADMIN_IDS", "ADMIN_IDS", "AdminIds"];

    public AdminDirectory(IConfiguration config) : this(FromConfig(config)) { }

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

    public AdminDirectory(string? raw)
    {
        _admins = Parse(raw);
    }

    public bool IsConfigured => _admins.Count > 0;

    public static IReadOnlyList<AdminAccount> Parse(string? raw)
    {
        var list = new List<AdminAccount>();
        raw = (raw ?? "").Trim();
        // В поле значения часто вставляют строку целиком: «Auth__AdminIds=1001:Иван».
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
        return input.Length == 0 ? null : found;
    }
}
