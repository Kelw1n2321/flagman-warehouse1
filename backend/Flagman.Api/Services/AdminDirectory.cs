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

    public AdminDirectory(IConfiguration config) : this(config["Auth:AdminIds"]) { }

    public AdminDirectory(string? raw)
    {
        _admins = Parse(raw);
    }

    public bool IsConfigured => _admins.Count > 0;

    public static IReadOnlyList<AdminAccount> Parse(string? raw)
    {
        var list = new List<AdminAccount>();
        foreach (var entry in (raw ?? "").Split([',', ';', '\n'], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
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
