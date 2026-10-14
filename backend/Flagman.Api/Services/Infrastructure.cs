using System.Collections.Concurrent;
using System.Threading.Channels;

namespace Flagman.Api.Services;

/// <summary>Ожидаемая ошибка предметной области; превращается в ProblemDetails с понятным текстом.</summary>
public sealed class DomainException(int status, string title, IDictionary<string, string[]>? errors = null) : Exception(title)
{
    public int Status { get; } = status;
    public IDictionary<string, string[]>? Errors { get; } = errors;

    public static DomainException NotFound(string what) => new(404, $"{what} не найден(а)");
    public static DomainException Invalid(string field, string message) =>
        new(400, "Ошибка валидации", new Dictionary<string, string[]> { [field] = [message] });
    public static DomainException Conflict(string message) => new(409, message);
}

/// <summary>
/// Изменяющие операции выполняются по одной, чтобы два заказа не списали одно и то же.
/// </summary>
public sealed class WriteGate
{
    private readonly SemaphoreSlim _lock = new(1, 1);

    public async Task<IDisposable> AcquireAsync(CancellationToken ct)
    {
        await _lock.WaitAsync(ct);
        return new Releaser(_lock);
    }

    private sealed class Releaser(SemaphoreSlim s) : IDisposable
    {
        private int _done;
        public void Dispose()
        {
            if (Interlocked.Exchange(ref _done, 1) == 0) s.Release();
        }
    }
}

public sealed record ServerEvent(long Version, string Reason, DateTime At);

/// <summary>Шина событий для SSE: каждый подключённый клиент получает свой канал.</summary>
public sealed class EventBus
{
    private readonly ConcurrentDictionary<Guid, Channel<ServerEvent>> _subscribers = new();
    private long _version;

    public long Version => Interlocked.Read(ref _version);

    public void Publish(string reason, DateTime at)
    {
        var evt = new ServerEvent(Interlocked.Increment(ref _version), reason, at);
        foreach (var ch in _subscribers.Values) ch.Writer.TryWrite(evt);
    }

    public (Guid Id, ChannelReader<ServerEvent> Reader) Subscribe()
    {
        var ch = Channel.CreateBounded<ServerEvent>(new BoundedChannelOptions(64) { FullMode = BoundedChannelFullMode.DropOldest });
        var id = Guid.NewGuid();
        _subscribers[id] = ch;
        return (id, ch.Reader);
    }

    public void Unsubscribe(Guid id)
    {
        if (_subscribers.TryRemove(id, out var ch)) ch.Writer.TryComplete();
    }

    public int SubscriberCount => _subscribers.Count;
}

public static class TimeZones
{
    public static TimeZoneInfo Resolve(string id)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.Utc; }
        catch (InvalidTimeZoneException) { return TimeZoneInfo.Utc; }
    }

    public static bool IsValid(string id)
    {
        try { TimeZoneInfo.FindSystemTimeZoneById(id); return true; }
        catch { return false; }
    }

    /// <summary>Переводит "настенное" время ресторана (без смещения) в UTC с учётом часового пояса.</summary>
    public static DateTime LocalToUtc(DateTime local, TimeZoneInfo tz)
    {
        var unspecified = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        if (tz.IsInvalidTime(unspecified)) unspecified = unspecified.AddHours(1); // пропущенный час при переводе часов
        return TimeZoneInfo.ConvertTimeToUtc(unspecified, tz);
    }

    public static DateTime UtcToLocal(DateTime utc, TimeZoneInfo tz) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), tz);
}
