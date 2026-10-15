// Контракты API /api/v1 (зеркало Flagman.Api/Api/Dtos.cs). Время - ISO-строки в UTC.

export type Unit = 'kg' | 'g' | 'l' | 'ml' | 'pcs';
export type Risk = 'ok' | 'expiring' | 'low' | 'critical' | 'out' | 'expired';
export type Expiry = 'normal' | 'soon' | 'critical' | 'expired';

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: Unit;
  icon: string;
  minStock: number;
  defaultShelfLifeHours: number | null;
  total: number;
  available: number;
  expired: number;
  expiringSoon: number;
  expiringCritical: number;
  batchCount: number;
  expiredBatchCount: number;
  earliestExpiry: string | null;
  earliestState: Expiry | null;
  belowMinimum: boolean;
  risk: Risk;
  riskLevel: number;
  usedInDishes: number;
  blockedDishes: string[];
}

export interface Batch {
  id: number;
  code: string;
  productId: number;
  productName: string;
  unit: Unit;
  icon: string;
  category: string;
  supplyId: string;
  supplyNumber: string;
  receivedAt: string;
  expiresAt: string;
  quantityReceived: number;
  quantityRemaining: number;
  state: 'active' | 'depleted' | 'writtenOff';
  expiry: Expiry;
  hoursLeft: number;
  fefoRank: number | null;
}

export type MovementType =
  | 'receipt'
  | 'consumption'
  | 'expiredWriteOff'
  | 'spoilageWriteOff'
  | 'adjustmentPlus'
  | 'adjustmentMinus'
  | 'restore';

export interface Movement {
  id: number;
  productId: number;
  productName: string;
  unit: Unit;
  batchId: number | null;
  batchCode: string | null;
  type: MovementType;
  quantity: number;
  batchBalanceAfter: number;
  createdAt: string;
  supplyId: string | null;
  supplyNumber: string | null;
  orderId: string | null;
  orderNumber: string | null;
  reason: string | null;
}

export interface SupplyLine {
  id: number;
  productId: number;
  productName: string;
  unit: Unit;
  icon: string;
  quantity: number;
  expiresAt: string;
  hoursLeft: number;
  expiry: Expiry;
  batch: Batch | null;
}

export type SupplyStatus = 'draft' | 'received' | 'cancelled';

export interface Supply {
  id: string;
  supplyNumber: string;
  supplier: string;
  createdAt: string;
  receivedAt: string | null;
  status: SupplyStatus;
  note: string | null;
  lineCount: number;
  productNames: string[];
  earliestExpiry: string | null;
  lines: SupplyLine[] | null;
}

export interface DishIngredient {
  productId: number;
  name: string;
  unit: Unit;
  icon: string;
  perServing: number;
  available: number;
  servingsPossible: number;
  missing: number;
  expiredExcluded: number;
  atRisk: boolean;
}

export interface Dish {
  id: number;
  name: string;
  description: string;
  category: string;
  icon: string;
  isActive: boolean;
  maxServings: number;
  available: boolean;
  limitingProductId: number | null;
  limitingProductName: string | null;
  ingredients: DishIngredient[];
  stopSince: string | null;
  hotLevel: HotLevel | null;
}

export interface Shortage {
  productId: number;
  productName: string;
  unit: Unit;
  required: number;
  available: number;
  missing: number;
  expiredExcluded: number;
}

export interface Consumption {
  productId: number;
  productName: string;
  unit: Unit;
  batchCode: string | null;
  batchExpiresAt: string | null;
  quantity: number;
}

export interface Order {
  id: string;
  number: string;
  createdAt: string;
  status: 'completed' | 'rejected';
  rejectionReason: string | null;
  source: string;
  lines: { dishId: number; dishName: string; icon: string; servings: number }[];
  shortages: Shortage[];
  consumption: Consumption[] | null;
  title: string | null;
  comment: string | null;
}

export interface Requirement extends Shortage {
  fefoPlan: Consumption[];
}

export interface OrderCheck {
  canFulfill: boolean;
  requirements: Requirement[];
  reason: string | null;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export interface Alert {
  id: number;
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  createdAt: string;
  status: AlertStatus;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  productId: number | null;
  batchId: number | null;
  dishId: number | null;
  orderId: string | null;
}

export interface StopMissing {
  productId: number;
  name: string;
  unit: Unit;
  icon: string;
  required: number;
  available: number;
  shortfall: number;
  expiredExcluded: number;
}

export interface StopForecast {
  dishId: number;
  name: string;
  icon: string;
  maxServings: number;
  hoursUntil: number;
  predictedAt: string;
  causeProductId: number;
  causeProductName: string;
}

export interface StopList {
  items: { dishId: number; name: string; icon: string; category: string; since: string | null; missing: StopMissing[] }[];
  forecast: StopForecast[];
  recentlyReturned: { dishId: number; name: string; icon: string; startedAt: string; endedAt: string }[];
  totalDishes: number;
}

export type HotLevel = 'high' | 'medium' | 'low';

export interface HotIngredient {
  productId: number;
  name: string;
  unit: Unit;
  icon: string;
  atRiskQuantity: number;
  hoursLeft: number;
  batchCode: string;
  state: Expiry;
  perServing: number;
  servingsToClear: number;
  usableServings: number;
  rescuedQuantity: number;
  urgency: number;
  volume: number;
  coverage: number;
  exclusivity: number;
  otherDishCount: number;
  contribution: number;
  explanation: string[];
}

export interface HotOffer {
  dishId: number;
  name: string;
  icon: string;
  description: string;
  score: number;
  level: HotLevel;
  maxServings: number;
  recommendedServings: number;
  limitingProductName: string | null;
  summary: string;
  ingredients: HotIngredient[];
  /** Закреплено менеджером (например, сезонное блюдо). */
  pinned: boolean;
  pinNote: string | null;
  pinnedUntil: string | null;
}

export interface HiddenOffer {
  dishId: number;
  name: string;
  icon: string;
  note: string | null;
  hiddenAt: string;
  hiddenBy: string;
  until: string | null;
  score: number | null;
}

export interface HotOffers {
  offers: HotOffer[];
  blocked: { dishId: number; name: string; icon: string; atRiskProducts: string[]; missingProducts: string[] }[];
  hidden: HiddenOffer[];
  formula: string;
}

export interface Recommendation {
  productId: number;
  name: string;
  unit: Unit;
  icon: string;
  category: string;
  available: number;
  minStock: number;
  dailyUsage: number;
  daysOfCover: number | null;
  expectedLoss: number;
  recommendedQuantity: number;
  urgency: 'critical' | 'high' | 'normal';
  reasons: string[];
  defaultShelfLifeHours: number | null;
}

export interface Settings {
  soonHours: number;
  criticalHours: number;
  autoWriteOffExpired: boolean;
  timeZone: string;
  forecastWindowDays: number;
  supplyCoverDays: number;
  generatorEnabled: boolean;
  generatorIntervalSeconds: number;
  mode: string;
}

export interface Summary {
  now: string;
  timeZone: string;
  version: number;
  productCount: number;
  productsInStock: number;
  activeBatches: number;
  attentionProducts: number;
  expiringBatches: number;
  criticalBatches: number;
  expiredBatches: number;
  stopListCount: number;
  dishCount: number;
  activeAlerts: number;
  criticalAlerts: number;
  ordersToday: number;
  rejectedToday: number;
  hotOffers: number;
  categories: string[];
  settings: Settings;
  pendingSupplierRequests: number;
  trashCount: number;
}

export interface ForecastPoint {
  at: string;
  usable: number;
}

export interface ProductDetail {
  product: Product;
  batches: Batch[];
  movements: Movement[];
  supplies: Supply[];
  dishes: { dishId: number; name: string; icon: string; perServing: number; maxServings: number; available: boolean }[];
  forecast: { hasData: boolean; dailyUsage: number; depletionAt: string | null; hoursToDepletion: number | null; expectedLoss: number; series: ForecastPoint[] };
}

export interface DayPoint {
  date: string;
  receipts: number;
  supplies: number;
  ordersCompleted: number;
  ordersRejected: number;
  writeOffs: number;
  consumptions: number;
}

export interface Stats {
  days: number;
  category: string | null;
  totals: {
    products: number;
    productsInStock: number;
    activeBatches: number;
    expiringProducts: number;
    expiringBatches: number;
    expiredProducts: number;
    expiredBatches: number;
    ordersCompleted: number;
    ordersRejected: number;
    supplies: number;
    batchesReceived: number;
    writeOffOperations: number;
  };
  daily: DayPoint[];
  flows: {
    productId: number;
    name: string;
    unit: Unit;
    icon: string;
    category: string;
    received: number;
    consumed: number;
    expiredWrittenOff: number;
    spoilageWrittenOff: number;
    adjusted: number;
    wasteRatio: number;
  }[];
  deficits: {
    productId: number;
    name: string;
    unit: Unit;
    icon: string;
    rejections: number;
    missingTotal: number;
    blockedDishesNow: number;
    belowMinimum: boolean;
    score: number;
  }[];
  stopFrequency: { dishId: number; name: string; icon: string; entries: number; totalHours: number; currentlyStopped: boolean }[];
  forecasts: {
    productId: number;
    name: string;
    unit: Unit;
    icon: string;
    available: number;
    dailyUsage: number;
    hoursToDepletion: number | null;
    depletionAt: string | null;
    expectedLoss: number;
    series: ForecastPoint[];
  }[];
  stopForecast: StopForecast[];
  forecastHasData: boolean;
}

export type SupplierRequestStatus = 'sent' | 'accepted' | 'rejected';

export interface SupplierRequestLine {
  id: number;
  productId: number;
  productName: string;
  unit: Unit;
  requestedQuantity: number;
  acceptedQuantity: number | null;
  expiresAt: string;
}

export interface SupplierRequest {
  id: string;
  number: string;
  supplierName: string;
  createdAt: string;
  status: SupplierRequestStatus;
  /** Принята не полностью (по какой-то строке меньше заявленного). */
  partial: boolean;
  comment: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  rejectionReason: string | null;
  supplyId: string | null;
  supplyNumber: string | null;
  lines: SupplierRequestLine[];
}

export interface SupplierProduct {
  id: number;
  name: string;
  unit: Unit;
  category: string;
  defaultShelfLifeHours: number | null;
}

export interface TrashItem {
  id: number;
  batchId: number;
  batchCode: string;
  productId: number;
  productName: string;
  unit: Unit;
  category: string;
  quantity: number;
  kind: 'expired' | 'spoilage';
  reason: string;
  deletedAt: string;
  deletedBy: string;
  batchExpiresAt: string;
  batchExpired: boolean;
}

export interface TopDish {
  dishId: number;
  name: string;
  category: string;
  rank: number;
  servings: number;
  orders: number;
  /** Доля от всех проданных порций за период, 0..1. */
  share: number;
  prevServings: number;
  /** Изменение к прошлому такому же периоду в процентах; null - тогда не продавалось. */
  trendPercent: number | null;
  daily: number[];
  isActive: boolean;
  maxServings: number;
  inStopList: boolean;
  limitingProductName: string | null;
}

export interface TopDishes {
  days: number;
  from: string;
  totalServings: number;
  totalOrders: number;
  dayLabels: string[];
  items: TopDish[];
  categories: string[];
}
