namespace Flagman.Api.Api;

public sealed record ProductDto(
    int Id, string Sku, string Name, string Category, string Unit, string Icon,
    decimal MinStock, int? DefaultShelfLifeHours,
    decimal Total, decimal Available, decimal Expired, decimal ExpiringSoon, decimal ExpiringCritical,
    int BatchCount, int ExpiredBatchCount, DateTime? EarliestExpiry, string? EarliestState,
    bool BelowMinimum, string Risk, int RiskLevel, int UsedInDishes, IReadOnlyList<string> BlockedDishes);

public sealed record BatchDto(
    int Id, string Code, int ProductId, string ProductName, string Unit, string Icon, string Category,
    Guid SupplyId, string SupplyNumber, DateTime ReceivedAt, DateTime ExpiresAt,
    decimal QuantityReceived, decimal QuantityRemaining, string State, string Expiry, double HoursLeft, int? FefoRank);

public sealed record MovementDto(
    long Id, int ProductId, string ProductName, string Unit, int? BatchId, string? BatchCode, string Type,
    decimal Quantity, decimal BatchBalanceAfter, DateTime CreatedAt, Guid? SupplyId, string? SupplyNumber,
    Guid? OrderId, string? OrderNumber, string? Reason);

public sealed record SupplyLineDto(int Id, int ProductId, string ProductName, string Unit, string Icon, decimal Quantity, DateTime ExpiresAt,
    double HoursLeft, string Expiry, BatchDto? Batch);

public sealed record SupplyDto(
    Guid Id, string SupplyNumber, string Supplier, DateTime CreatedAt, DateTime? ReceivedAt, string Status, string? Note,
    int LineCount, IReadOnlyList<string> ProductNames, DateTime? EarliestExpiry, IReadOnlyList<SupplyLineDto>? Lines);

public sealed record DishIngredientDto(int ProductId, string Name, string Unit, string Icon, decimal PerServing,
    decimal Available, int ServingsPossible, decimal Missing, decimal ExpiredExcluded, bool AtRisk);

public sealed record DishDto(
    int Id, string Name, string Description, string Category, string Icon, bool IsActive,
    int MaxServings, bool Available, int? LimitingProductId, string? LimitingProductName,
    IReadOnlyList<DishIngredientDto> Ingredients, DateTime? StopSince, string? HotLevel);

public sealed record OrderLineDto(int DishId, string DishName, string Icon, int Servings);
public sealed record ShortageDto(int ProductId, string ProductName, string Unit, decimal Required, decimal Available, decimal Missing, decimal ExpiredExcluded);
public sealed record ConsumptionDto(int ProductId, string ProductName, string Unit, string? BatchCode, DateTime? BatchExpiresAt, decimal Quantity);

public sealed record OrderDto(
    Guid Id, string Number, DateTime CreatedAt, string Status, string? RejectionReason, string Source,
    IReadOnlyList<OrderLineDto> Lines, IReadOnlyList<ShortageDto> Shortages, IReadOnlyList<ConsumptionDto>? Consumption);

public sealed record RequirementDto(int ProductId, string ProductName, string Unit, decimal Required, decimal Available, decimal Missing, decimal ExpiredExcluded,
    IReadOnlyList<ConsumptionDto> FefoPlan);
public sealed record OrderCheckDto(bool CanFulfill, IReadOnlyList<RequirementDto> Requirements, string? Reason);

public sealed record AlertDto(
    int Id, string Type, string Severity, string Title, string Message, DateTime CreatedAt, string Status,
    DateTime? AcknowledgedAt, DateTime? ResolvedAt, int? ProductId, int? BatchId, int? DishId, Guid? OrderId);

public sealed record StopMissingDto(int ProductId, string Name, string Unit, string Icon, decimal Required, decimal Available, decimal Shortfall, decimal ExpiredExcluded);
public sealed record StopItemDto(int DishId, string Name, string Icon, string Category, DateTime? Since, IReadOnlyList<StopMissingDto> Missing);
public sealed record StopForecastDto(int DishId, string Name, string Icon, int MaxServings, double HoursUntil, DateTime PredictedAt, int CauseProductId, string CauseProductName);
public sealed record StopReturnDto(int DishId, string Name, string Icon, DateTime StartedAt, DateTime EndedAt);
public sealed record StopListDto(IReadOnlyList<StopItemDto> Items, IReadOnlyList<StopForecastDto> Forecast, IReadOnlyList<StopReturnDto> RecentlyReturned, int TotalDishes);

public sealed record HotIngredientDto(int ProductId, string Name, string Unit, string Icon, decimal AtRiskQuantity, double HoursLeft,
    string BatchCode, string State, decimal PerServing, int ServingsToClear, int UsableServings, decimal RescuedQuantity,
    double Urgency, double Volume, double Coverage, double Exclusivity, int OtherDishCount, double Contribution, IReadOnlyList<string> Explanation);
public sealed record HotOfferDto(int DishId, string Name, string Icon, string Description, double Score, string Level,
    int MaxServings, int RecommendedServings, string? LimitingProductName, string Summary, IReadOnlyList<HotIngredientDto> Ingredients);
public sealed record BlockedOfferDto(int DishId, string Name, string Icon, IReadOnlyList<string> AtRiskProducts, IReadOnlyList<string> MissingProducts);
public sealed record HotOffersDto(IReadOnlyList<HotOfferDto> Offers, IReadOnlyList<BlockedOfferDto> Blocked, string Formula);

public sealed record RecommendationDto(int ProductId, string Name, string Unit, string Icon, string Category, decimal Available, decimal MinStock,
    decimal DailyUsage, double? DaysOfCover, decimal ExpectedLoss, decimal RecommendedQuantity, string Urgency,
    IReadOnlyList<string> Reasons, int? DefaultShelfLifeHours);

public sealed record SummaryDto(
    DateTime Now, string TimeZone, long Version,
    int ProductCount, int ProductsInStock, int ActiveBatches, int AttentionProducts,
    int ExpiringBatches, int CriticalBatches, int ExpiredBatches, int StopListCount, int DishCount,
    int ActiveAlerts, int CriticalAlerts, int OrdersToday, int RejectedToday, int HotOffers,
    IReadOnlyList<string> Categories, SettingsDto Settings);

public sealed record SettingsDto(int SoonHours, int CriticalHours, bool AutoWriteOffExpired, string TimeZone,
    int ForecastWindowDays, int SupplyCoverDays, bool GeneratorEnabled, int GeneratorIntervalSeconds, string Mode);

public sealed record ProductDetailDto(
    ProductDto Product, IReadOnlyList<BatchDto> Batches, IReadOnlyList<MovementDto> Movements,
    IReadOnlyList<SupplyDto> Supplies, IReadOnlyList<DishIngredientUseDto> Dishes, ProductForecastDto Forecast);
public sealed record DishIngredientUseDto(int DishId, string Name, string Icon, decimal PerServing, int MaxServings, bool Available);
public sealed record ForecastPointDto(DateTime At, decimal Usable);
public sealed record ProductForecastDto(bool HasData, decimal DailyUsage, DateTime? DepletionAt, double? HoursToDepletion, decimal ExpectedLoss, IReadOnlyList<ForecastPointDto> Series);

public sealed record DayPointDto(string Date, int Receipts, int Supplies, int OrdersCompleted, int OrdersRejected, int WriteOffs, int Consumptions);
public sealed record ProductFlowDto(int ProductId, string Name, string Unit, string Icon, string Category,
    decimal Received, decimal Consumed, decimal ExpiredWrittenOff, decimal SpoilageWrittenOff, decimal Adjusted, double WasteRatio);
public sealed record DeficitDto(int ProductId, string Name, string Unit, string Icon, int Rejections, decimal MissingTotal,
    int BlockedDishesNow, bool BelowMinimum, double Score);
public sealed record StopFrequencyDto(int DishId, string Name, string Icon, int Entries, double TotalHours, bool CurrentlyStopped);
public sealed record DepletionForecastDto(int ProductId, string Name, string Unit, string Icon, decimal Available, decimal DailyUsage,
    double? HoursToDepletion, DateTime? DepletionAt, decimal ExpectedLoss, IReadOnlyList<ForecastPointDto> Series);
public sealed record StatsTotalsDto(int Products, int ProductsInStock, int ActiveBatches, int ExpiringProducts, int ExpiringBatches,
    int ExpiredProducts, int ExpiredBatches, int OrdersCompleted, int OrdersRejected, int Supplies, int BatchesReceived, int WriteOffOperations);
public sealed record StatsDto(int Days, string? Category, StatsTotalsDto Totals, IReadOnlyList<DayPointDto> Daily,
    IReadOnlyList<ProductFlowDto> Flows, IReadOnlyList<DeficitDto> Deficits, IReadOnlyList<StopFrequencyDto> StopFrequency,
    IReadOnlyList<DepletionForecastDto> Forecasts, IReadOnlyList<StopForecastDto> StopForecast, bool ForecastHasData);
