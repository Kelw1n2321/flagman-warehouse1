import type { Expiry, Risk, Unit } from '../api/types';

const UNIT_LABEL: Record<Unit, string> = { kg: 'кг', g: 'г', l: 'л', ml: 'мл', pcs: 'шт' };

export const unitLabel = (u: Unit) => UNIT_LABEL[u] ?? u;

const num = (v: number, max = 3) => v.toLocaleString('ru-RU', { maximumFractionDigits: max });

/** Количество с единицей. Мелкие кг/л показываются в г/мл, как в рецептурах. */
export function qty(value: number, unit: Unit, opts: { small?: boolean } = { small: true }): string {
  if (opts.small !== false && (unit === 'kg' || unit === 'l') && value !== 0 && Math.abs(value) < 1) {
    return `${num(value * 1000, 1)} ${unit === 'kg' ? 'г' : 'мл'}`;
  }
  return `${num(value)} ${unitLabel(unit)}`;
}

/** Компактное число для счётчиков на карточке. */
export function compact(value: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) >= 100) return num(Math.round(value), 0);
  if (Math.abs(value) >= 10) return num(value, 1);
  return num(value, 2);
}

export function hoursLeft(hours: number): string {
  const sign = hours < 0 ? '−' : '';
  const h = Math.abs(hours);
  if (h < 1) return `${sign}${Math.max(0, Math.round(h * 60))} мин`;
  if (h < 48) return `${sign}${Math.round(h)} ч`;
  const d = Math.floor(h / 24);
  const rest = Math.round(h - d * 24);
  return `${sign}${d} д${rest ? ` ${rest} ч` : ''}`;
}

/** «через 5 ч» / «истёк 3 ч назад». */
export function relative(hours: number): string {
  return hours >= 0 ? `через ${hoursLeft(hours)}` : `${hoursLeft(-hours)} назад`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, options: Intl.DateTimeFormatOptions) {
  const key = tz + JSON.stringify(options);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, ...options });
    formatters.set(key, f);
  }
  return f;
}

export const dateTime = (iso: string, tz: string) =>
  fmt(tz, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const dateShort = (iso: string, tz: string) =>
  fmt(tz, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const dateOnly = (iso: string, tz: string) => fmt(tz, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
export const timeOnly = (iso: string | Date, tz: string) => fmt(tz, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const weekday = (d: Date, tz: string) => fmt(tz, { weekday: 'short' }).format(d).toUpperCase();
export const dayOfMonth = (d: Date, tz: string) => fmt(tz, { day: '2-digit' }).format(d);

/** Календарная дата в часовом поясе ресторана (yyyy-mm-dd) — для «сегодня/завтра». */
export function localDateKey(d: Date, tz: string): string {
  const parts = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** «сегодня 18:00», «завтра 09:30», иначе дата — с учётом границ суток в часовом поясе ресторана. */
export function humanDate(iso: string, tz: string, now: Date): string {
  const d = new Date(iso);
  const key = localDateKey(d, tz);
  const today = localDateKey(now, tz);
  const tomorrow = localDateKey(new Date(now.getTime() + 86_400_000), tz);
  const yesterday = localDateKey(new Date(now.getTime() - 86_400_000), tz);
  const t = timeOnly(d, tz);
  if (key === today) return `сегодня ${t}`;
  if (key === tomorrow) return `завтра ${t}`;
  if (key === yesterday) return `вчера ${t}`;
  return dateShort(iso, tz);
}

/** Строка для input[type=datetime-local] в часовом поясе ресторана. */
export function toLocalInput(d: Date, tz: string): string {
  const parts = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export const EXPIRY_LABEL: Record<Expiry, string> = {
  normal: 'Норма',
  soon: 'Скоро истекает',
  critical: 'Критический срок',
  expired: 'Просрочено',
};

export const RISK_LABEL: Record<Risk, string> = {
  ok: 'Норма',
  expiring: 'Истекает срок',
  low: 'Малый остаток',
  critical: 'Критический срок',
  out: 'Нет в наличии',
  expired: 'Есть просрочка',
};

/** Сводный статус карточки: норма / внимание / критично. */
export function riskTier(risk: Risk, blocked: boolean): 'ok' | 'attention' | 'critical' {
  if (blocked || risk === 'expired' || risk === 'out' || risk === 'critical') return 'critical';
  if (risk === 'low' || risk === 'expiring') return 'attention';
  return 'ok';
}

export const TIER_LABEL = { ok: 'Норма', attention: 'Требуется внимание', critical: 'Критично' } as const;

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
