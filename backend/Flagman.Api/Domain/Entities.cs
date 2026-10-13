namespace Flagman.Api.Domain;

/// <summary>Складская позиция (тип продукта). Остаток не хранится здесь — он всегда считается из партий.</summary>
public sealed class Product
{
    public int Id { get; set; }
    public required string Sku { get; set; }
    public required string Name { get; set; }
    public required string Category { get; set; }
    /// <summary>Единица учёта: kg, g, l, ml, pcs.</summary>
    public required string Unit { get; set; }
    /// <summary>Минимально допустимый доступный остаток.</summary>
    public decimal MinStock { get; set; }
    /// <summary>Срок хранения по умолчанию (часы) — подставляется при приёмке, если срок не указан явно.</summary>
    public int? DefaultShelfLifeHours { get; set; }
    public string Icon { get; set; } = "📦";
    public bool IsArchived { get; set; }
}

public enum SupplyStatus { Draft = 0, Received = 1, Cancelled = 2 }

public sealed class Supply
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string SupplyNumber { get; set; }
    public string Supplier { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime? ReceivedAt { get; set; }
    public SupplyStatus Status { get; set; }
    public string? Note { get; set; }
    public List<SupplyLine> Lines { get; set; } = [];
    public List<ProductBatch> Batches { get; set; } = [];
}

/// <summary>Строка поставки (заявленная позиция). При приёмке каждая строка превращается в отдельную партию.</summary>
public sealed class SupplyLine
{
    public int Id { get; set; }
    public Guid SupplyId { get; set; }
    public int ProductId { get; set; }
    public Product? Product { get; set; }
    public decimal Quantity { get; set; }
    public DateTime ExpiresAt { get; set; }
}

public enum BatchState { Active = 0, Depleted = 1, WrittenOff = 2 }

public sealed class ProductBatch
{
    public int Id { get; set; }
    public required string Code { get; set; }
    public int ProductId { get; set; }
    public Product? Product { get; set; }
    public Guid SupplyId { get; set; }
    public Supply? Supply { get; set; }
    public DateTime ReceivedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public decimal QuantityReceived { get; set; }
    public decimal QuantityRemaining { get; set; }
    public BatchState State { get; set; }
    /// <summary>Токен оптимистичной блокировки — защищает от гонок при нескольких экземплярах сервиса.</summary>
    public int Version { get; set; }
}

public sealed class Dish
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string Description { get; set; } = "";
    public string Category { get; set; } = "";
    public string Icon { get; set; } = "🍽️";
    public bool IsActive { get; set; } = true;
    public List<DishIngredient> Ingredients { get; set; } = [];
}

public sealed class DishIngredient
{
    public int DishId { get; set; }
    public int ProductId { get; set; }
    public Product? Product { get; set; }
    public decimal QuantityPerServing { get; set; }
}

public enum OrderStatus { Completed = 0, Rejected = 1 }

public sealed class Order
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Number { get; set; }
    /// <summary>Название от официанта: «Стол 5», «Навынос» — необязательно.</summary>
    public string? Title { get; set; }
    /// <summary>Пожелания к приготовлению — необязательно.</summary>
    public string? Comment { get; set; }
    public DateTime CreatedAt { get; set; }
    public OrderStatus Status { get; set; }
    public string? RejectionReason { get; set; }
    public string Source { get; set; } = "manual";
    public List<OrderLine> Lines { get; set; } = [];
    public List<OrderShortage> Shortages { get; set; } = [];
}

public sealed class OrderLine
{
    public int Id { get; set; }
    public Guid OrderId { get; set; }
    public int DishId { get; set; }
    public string DishName { get; set; } = "";
    public int Servings { get; set; }
}

/// <summary>Нехватка ингредиента, из-за которой заказ был отклонён.</summary>
public sealed class OrderShortage
{
    public int Id { get; set; }
    public Guid OrderId { get; set; }
    public int ProductId { get; set; }
    public string ProductName { get; set; } = "";
    public string Unit { get; set; } = "";
    public decimal Required { get; set; }
    public decimal Available { get; set; }
    public decimal Missing { get; set; }
    /// <summary>Количество, которое физически есть, но исключено из доступного остатка как просроченное.</summary>
    public decimal ExpiredExcluded { get; set; }
}

public enum MovementType
{
    Receipt = 0,
    Consumption = 1,
    ExpiredWriteOff = 2,
    SpoilageWriteOff = 3,
    AdjustmentPlus = 4,
    AdjustmentMinus = 5,
}

/// <summary>Журнал движения: каждая операция с партией фиксируется отдельной записью. Quantity со знаком.</summary>
public sealed class StockMovement
{
    public long Id { get; set; }
    public int ProductId { get; set; }
    public int? BatchId { get; set; }
    public MovementType Type { get; set; }
    public decimal Quantity { get; set; }
    public decimal BatchBalanceAfter { get; set; }
    public DateTime CreatedAt { get; set; }
    public Guid? SupplyId { get; set; }
    public Guid? OrderId { get; set; }
    public string? Reason { get; set; }
}

public enum AlertType
{
    ExpiringSoon = 0,
    ExpiryCritical = 1,
    Expired = 2,
    LowStock = 3,
    OutOfStock = 4,
    DishStopped = 5,
    OrderRejected = 6,
    ExpiredWrittenOff = 7,
}

public enum AlertSeverity { Info = 0, Warning = 1, Critical = 2 }
public enum AlertStatus { Active = 0, Acknowledged = 1, Resolved = 2 }

public sealed class Alert
{
    public int Id { get; set; }
    public AlertType Type { get; set; }
    public AlertSeverity Severity { get; set; }
    /// <summary>Ключ условия (например, batch:12:critical) — исключает дубли активных предупреждений.</summary>
    public required string Key { get; set; }
    public int? ProductId { get; set; }
    public int? BatchId { get; set; }
    public int? DishId { get; set; }
    public Guid? OrderId { get; set; }
    public required string Title { get; set; }
    public string Message { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public AlertStatus Status { get; set; }
    public DateTime? AcknowledgedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
}

/// <summary>Интервал нахождения блюда в стоп-листе — для статистики частоты.</summary>
public sealed class StopListEntry
{
    public int Id { get; set; }
    public int DishId { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }
    public string Reason { get; set; } = "";
}

public sealed class WarehouseSettings
{
    public int Id { get; set; } = 1;
    /// <summary>Меньше этого числа часов до окончания срока — «скоро истекает».</summary>
    public int SoonHours { get; set; } = 72;
    /// <summary>Меньше этого числа часов — «критический срок».</summary>
    public int CriticalHours { get; set; } = 24;
    public bool AutoWriteOffExpired { get; set; }
    public string TimeZone { get; set; } = "Europe/Moscow";
    /// <summary>Окно (дни), по которому считается средний расход для прогнозов.</summary>
    public int ForecastWindowDays { get; set; } = 7;
    /// <summary>На сколько дней вперёд рассчитывать рекомендуемую поставку.</summary>
    public int SupplyCoverDays { get; set; } = 3;
    public bool GeneratorEnabled { get; set; }
    public int GeneratorIntervalSeconds { get; set; } = 25;

    public ExpiryThresholds Thresholds => new(SoonHours, CriticalHours);
}

public readonly record struct ExpiryThresholds(int SoonHours, int CriticalHours);

public enum ExpiryState { Normal = 0, Soon = 1, Critical = 2, Expired = 3 }

public static class Units
{
    public static readonly IReadOnlySet<string> All = new HashSet<string> { "kg", "g", "l", "ml", "pcs" };
    public static bool IsDiscrete(string unit) => unit == "pcs";

    public static string Label(string unit) => unit switch
    {
        "kg" => "кг",
        "g" => "г",
        "l" => "л",
        "ml" => "мл",
        "pcs" => "шт",
        _ => unit,
    };

    public static string Format(decimal quantity, string unit)
    {
        // Мелкие количества в кг/л показываем в г/мл — так рецептурные нормы читаются естественно.
        if (unit is "kg" or "l" && quantity != 0 && Math.Abs(quantity) < 1m)
            return $"{(quantity * 1000m).ToString("0.#", Ru)} {(unit == "kg" ? "г" : "мл")}";
        return $"{quantity.ToString("0.###", Ru)} {Label(unit)}";
    }

    public static readonly System.Globalization.CultureInfo Ru = System.Globalization.CultureInfo.GetCultureInfo("ru-RU");
}
