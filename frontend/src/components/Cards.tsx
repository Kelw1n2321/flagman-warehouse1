import { memo, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { Batch, Dish, Product } from '../api/types';
import { EXPIRY_LABEL, humanDate, qty, relative, RISK_LABEL, riskTier, TIER_LABEL } from '../lib/format';
import { Icon } from './Icon';

/**
 * Карточка перерисовывается, только если изменились её данные. Обработчики (onOpen, onAdd) создаются
 * заново при каждой отрисовке экрана, поэтому в сравнении не участвуют.
 */
export function memoCard<P extends object>(Component: ComponentType<P>) {
  return memo(Component, (a, b) => {
    for (const k of Object.keys(b) as (keyof P)[]) {
      if (typeof b[k] === 'function') continue;
      if (!Object.is(a[k], b[k])) return false;
    }
    return Object.keys(a).length === Object.keys(b).length;
  });
}

export type Tone = 'ok' | 'warn' | 'crit' | 'neutral' | 'muted';
type Tier = 'ok' | 'attention' | 'critical' | 'info';

/** Метка состояния: точка + текст на мягком фоне своего цвета. */
export function StatusPill({ tier, children }: { tier: Tier; children: ReactNode }) {
  return <span className={`status status--${tier}`}>{children}</span>;
}

export interface Stat {
  label: string;
  value: ReactNode;
  tone?: Tone;
  title?: string;
  changed?: boolean;
}

/** Строки-плашки "подпись ... значение" - основная информация карточки. */
export function Stats({ items }: { items: Stat[] }) {
  return (
    <dl className="dcard__stats">
      {items.map((s) => (
        <div key={s.label} className={`dcard__stat ${s.changed ? 'is-changed' : ''}`} title={s.title}>
          <dt>{s.label}</dt>
          <dd className={s.tone ? `tone-${s.tone}` : undefined}>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Строки второго плана: "Партии", "Ближайший срок", "Ограничивает". */
export function Meta({ rows }: { rows: [string, ReactNode, Tone?][] }) {
  return (
    <div className="dcard__meta">
      {rows.map(([label, value, tone]) => (
        <div key={label}>
          <span>{label}</span>
          <span className={tone ? `tone-${tone}` : undefined}>{value}</span>
        </div>
      ))}
    </div>
  );
}

/** true на короткое время после изменения значения (не при первом показе) - подсветка обновлённого остатка. */
function useChanged(value: number): boolean {
  const prev = useRef(value);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setChanged(true);
    const t = window.setTimeout(() => setChanged(false), 1600);
    return () => window.clearTimeout(t);
  }, [value]);
  return changed;
}

export function CardHead({ name, sub, tier, status }: { name: string; sub: string; tier: Tier; status: string }) {
  return (
    <div className="dcard__head">
      <h3 className="dcard__name">{name}</h3>
      <div className="dcard__sub">{sub}</div>
      <StatusPill tier={tier}>{status}</StatusPill>
    </div>
  );
}

// Продукт

export const ProductCard = memoCard(function ProductCard({ p, tz, now, selected, onOpen }: { p: Product; tz: string; now: Date; soonHours?: number; selected?: boolean; onOpen: () => void }) {
  const tier = riskTier(p.risk, p.blockedDishes.length > 0);
  const status = tier === 'ok' ? TIER_LABEL.ok : RISK_LABEL[p.risk === 'ok' ? 'low' : p.risk];
  const changed = useChanged(p.available);
  const availableTone: Tone = p.available <= 0 ? 'crit' : p.belowMinimum ? 'warn' : 'ok';

  return (
    <button className={`dcard dcard--clickable ${selected ? 'is-selected' : ''}`} onClick={onOpen} aria-label={`${p.name}: доступно ${qty(p.available, p.unit, { small: false })}, ${status}`}>
      <CardHead name={p.name} sub={`${p.category} · ${p.sku}`} tier={tier} status={status} />
      <Stats
        items={[
          { label: 'Доступно', value: qty(p.available, p.unit, { small: false }), tone: availableTone, changed, title: 'Пригодный остаток (без просрочки)' },
          { label: 'Минимум', value: qty(p.minStock, p.unit, { small: false }), tone: 'neutral', title: 'Минимально допустимый остаток' },
          { label: 'Просрочено', value: qty(p.expired, p.unit, { small: false }), tone: p.expired > 0 ? 'crit' : 'muted', title: 'Не используется для блюд' },
        ]}
      />
      <Meta
        rows={[
          ['Партии', p.total !== p.available || p.batchCount > 1 ? `${p.batchCount} · всего ${qty(p.total, p.unit, { small: false })}` : p.batchCount],
          ['Ближайший срок', p.earliestExpiry ? humanDate(p.earliestExpiry, tz, now) : '—'],
        ]}
      />
      {p.blockedDishes.length > 0 && (
        <div className="dcard__alert" title={p.blockedDishes.join(', ')}>
          Стоп-лист: {p.blockedDishes.join(', ')}
        </div>
      )}
    </button>
  );
});

// Партия

const EXPIRY_TIER = { normal: 'ok', soon: 'attention', critical: 'critical', expired: 'critical' } as const;

export const BatchCard = memoCard(function BatchCard({ b, tz, now, onOpen }: { b: Batch; tz: string; now: Date; onOpen: () => void }) {
  const expired = b.expiry === 'expired';
  return (
    <button className="dcard dcard--clickable" onClick={onOpen} aria-label={`Партия ${b.code} ${b.productName}`}>
      <CardHead name={b.productName} sub={`Партия ${b.code}`} tier={EXPIRY_TIER[b.expiry]} status={EXPIRY_LABEL[b.expiry]} />
      <Stats
        items={[
          { label: 'Остаток', value: qty(b.quantityRemaining, b.unit, { small: false }), tone: expired ? 'crit' : 'ok' },
          { label: expired ? 'Истёк' : 'Осталось', value: relative(b.hoursLeft).replace('через ', ''), tone: b.expiry === 'normal' ? 'neutral' : b.expiry === 'soon' ? 'warn' : 'crit' },
          { label: 'Очередь FEFO', value: b.fefoRank ? `№${b.fefoRank}` : '—', tone: b.fefoRank === 1 ? 'ok' : 'muted' },
        ]}
      />
      <Meta
        rows={[
          ['Поставка', b.supplyNumber],
          ['Годна до', humanDate(b.expiresAt, tz, now)],
        ]}
      />
    </button>
  );
});

// Блюдо

/** Короткий состав для карточки: первые слова названий ингредиентов. */
const shortIngredients = (d: Dish) => d.ingredients.map((i) => i.name.split(/[ (]/)[0]).join(', ');

export function dishTier(d: Dish): { tier: Tier; status: string } {
  if (!d.available) return { tier: 'critical', status: 'Стоп-лист' };
  if (d.ingredients.some((i) => i.atRisk)) return { tier: 'attention', status: 'Проверить' };
  return { tier: 'ok', status: 'Доступно' };
}

export const DishCard = memoCard(function DishCard({ d, onAdd, onOpen, inOrder }: { d: Dish; onAdd?: () => void; onOpen?: () => void; inOrder?: number }) {
  const missing = d.ingredients.filter((i) => i.missing > 0);
  const risky = d.ingredients.filter((i) => i.atRisk).length;
  const { tier, status } = dishTier(d);
  const limiting = d.available ? d.limitingProductName ?? '—' : missing[0]?.name ?? '—';
  const clickable = !!onOpen && !onAdd;
  const Tag = clickable ? 'button' : 'article';

  return (
    <Tag className={`dcard ${clickable ? 'dcard--clickable' : ''} ${d.isActive ? '' : 'dcard--inactive'}`} onClick={clickable ? onOpen : undefined}>
      <CardHead name={d.name} sub={`${d.category} · ${d.ingredients.length} ингр.${d.isActive ? '' : ' · не в меню'}`} tier={tier} status={status} />
      <Stats
        items={[
          { label: 'Порции', value: d.maxServings, tone: d.maxServings > 0 ? 'ok' : 'crit', title: 'Сколько порций можно приготовить из доступных остатков' },
          { label: 'Не хватает', value: missing.length, tone: missing.length ? 'crit' : 'muted', title: missing.map((m) => m.name).join(', ') || 'Все ингредиенты в наличии' },
          { label: 'Истекает', value: risky, tone: risky ? 'warn' : 'muted', title: 'Ингредиентов с истекающим сроком годности' },
        ]}
      />
      <Meta rows={[['Ограничивает', limiting, d.available ? undefined : 'crit']]} />
      <div className="dcard__ings" title={d.ingredients.map((i) => `${i.name} — ${qty(i.perServing, i.unit)}`).join(', ')}>
        {shortIngredients(d)}
      </div>
      {onAdd &&
        (d.available ? (
          <button className="dcard__action" onClick={onAdd} aria-label={`Добавить «${d.name}» в заказ`}>
            <Icon name="plus" /> В заказ{inOrder ? ` · ${inOrder}` : ''}
          </button>
        ) : (
          <div className="dcard__action dcard__action--blocked" title={`Не хватает: ${missing.map((m) => m.name).join(', ')}`}>
            Нет: {missing[0]?.name.toLowerCase()}
            {missing.length > 1 ? ` +${missing.length - 1}` : ''}
          </div>
        ))}
      {clickable && (
        <span className="dcard__action">
          <Icon name="edit" /> Изменить рецептуру
        </span>
      )}
    </Tag>
  );
});
