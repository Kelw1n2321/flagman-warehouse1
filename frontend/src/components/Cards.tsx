import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Batch, Product } from '../api/types';
import { compact, EXPIRY_LABEL, humanDate, qty, relative, RISK_LABEL, riskTier, TIER_LABEL, unitLabel } from '../lib/format';
import { Icon } from './Icon';
import { Emoji } from './ui';

export type Tone = 'ok' | 'warn' | 'crit' | 'neutral';

/** Показатель карточки: значение + подпись; цвет дублирует смысл, а не заменяет его. */
export function Metric({ label, value, tone, zero, title, changed }: { label: string; value: ReactNode; tone: Tone; zero?: boolean; title?: string; changed?: boolean }) {
  return (
    <span className={`metric ${tone === 'neutral' ? '' : `metric--${tone}`} ${zero ? 'is-zero' : ''} ${changed ? 'is-changed' : ''}`} title={title}>
      <span className="metric__value">{value}</span>
      <span className="metric__label">{label}</span>
    </span>
  );
}

export function StatusPill({ tier, children }: { tier: 'ok' | 'attention' | 'critical' | 'info'; children: ReactNode }) {
  return (
    <span className={`status status--${tier}`}>
      <Icon name={tier === 'ok' ? 'check' : tier === 'info' ? 'clock' : tier === 'attention' ? 'alert' : 'x'} />
      {children}
    </span>
  );
}

/** true на короткое время после изменения значения (не при первом показе) — подсветка обновлённого остатка. */
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="pcard__row">
      <span>{label}</span>
      <span>{children}</span>
    </span>
  );
}

export function ProductCard({
  p,
  tz,
  now,
  soonHours,
  selected,
  onOpen,
}: {
  p: Product;
  tz: string;
  now: Date;
  soonHours: number;
  selected?: boolean;
  onOpen: () => void;
}) {
  const tier = riskTier(p.risk, p.blockedDishes.length > 0);
  const atRisk = p.expiringSoon + p.expiringCritical;
  const deficit = Math.max(0, p.minStock - p.available);
  const u = unitLabel(p.unit);
  const statusText = tier === 'ok' ? TIER_LABEL.ok : RISK_LABEL[p.risk === 'ok' ? 'low' : p.risk];
  const changed = useChanged(p.available);

  return (
    <button
      className={`pcard pcard--clickable ${tier === 'critical' ? 'pcard--critical' : tier === 'attention' ? 'pcard--attention' : ''} ${selected ? 'is-selected' : ''}`}
      onClick={onOpen}
      aria-label={`${p.name}: доступно ${qty(p.available, p.unit, { small: false })}, ${statusText}`}
    >
      <span className="pcard__head">
        <span className="pcard__icon">
          <Emoji>{p.icon}</Emoji>
        </span>
        <span className="pcard__title">
          <span className="pcard__name" style={{ display: 'block' }}>
            {p.name}
          </span>
          <span className="pcard__sub" style={{ display: 'block' }}>
            {p.category} · {p.sku}
          </span>
          <StatusPill tier={tier}>{statusText}</StatusPill>
        </span>
      </span>

      <span className="pcard__metrics">
        <Metric label="Доступно" value={`${compact(p.available)} ${u}`} tone={p.belowMinimum ? 'warn' : 'ok'} zero={p.available === 0} title={`Доступно: ${qty(p.available, p.unit)}`} changed={changed} />
        <Metric label="Истекает" value={`${compact(atRisk)} ${u}`} tone="warn" zero={atRisk === 0} title={`Истекает в ближайшие ${soonHours} ч: ${qty(atRisk, p.unit)}`} />
        {p.expired > 0 || !p.belowMinimum ? (
          <Metric label="Просрочка" value={`${compact(p.expired)} ${u}`} tone="crit" zero={p.expired === 0} title={`Просрочено, не используется: ${qty(p.expired, p.unit)}`} />
        ) : (
          <Metric label="Нехватка" value={`${compact(deficit)} ${u}`} tone="crit" title={`Не хватает до минимального остатка ${qty(p.minStock, p.unit)}`} />
        )}
      </span>

      <span className="pcard__rows">
        <Row label="Партий">
          {p.batchCount}
          {p.total !== p.available && ` · всего ${qty(p.total, p.unit)}`}
        </Row>
        <Row label="Ближайший срок">{p.earliestExpiry ? humanDate(p.earliestExpiry, tz, now) : '—'}</Row>
      </span>
      {p.blockedDishes.length > 0 && (
        <span className="pcard__alert" title={p.blockedDishes.join(', ')}>
          Стоп-лист: {p.blockedDishes.join(', ')}
        </span>
      )}
    </button>
  );
}

const EXPIRY_TIER = { normal: 'ok', soon: 'attention', critical: 'critical', expired: 'critical' } as const;

export function BatchCard({ b, tz, now, onOpen }: { b: Batch; tz: string; now: Date; onOpen: () => void }) {
  const expired = b.expiry === 'expired';
  return (
    <button
      className={`pcard pcard--clickable ${b.expiry === 'critical' || expired ? 'pcard--critical' : b.expiry === 'soon' ? 'pcard--attention' : ''}`}
      onClick={onOpen}
      aria-label={`Партия ${b.code} ${b.productName}`}
    >
      <span className="pcard__head">
        <span className="pcard__icon">
          <Emoji>{b.icon}</Emoji>
        </span>
        <span className="pcard__title">
          <span className="pcard__name" style={{ display: 'block' }}>
            {b.productName}
          </span>
          <span className="pcard__sub" style={{ display: 'block' }}>
            Партия {b.code}
          </span>
          <StatusPill tier={EXPIRY_TIER[b.expiry]}>{EXPIRY_LABEL[b.expiry]}</StatusPill>
        </span>
      </span>
      <span className="pcard__metrics">
        <Metric label="Остаток" value={`${compact(b.quantityRemaining)} ${unitLabel(b.unit)}`} tone={expired ? 'crit' : 'ok'} />
        <Metric label={expired ? 'Истёк' : 'Осталось'} value={relative(b.hoursLeft).replace('через ', '')} tone={b.expiry === 'normal' ? 'neutral' : b.expiry === 'soon' ? 'warn' : 'crit'} />
        <Metric label="FEFO" value={b.fefoRank ? `№${b.fefoRank}` : '—'} tone="neutral" zero={!b.fefoRank} />
      </span>
      <span className="pcard__rows">
        <Row label="Поставка">{b.supplyNumber}</Row>
        <Row label="Принята">
          {humanDate(b.receivedAt, tz, now)} · {qty(b.quantityReceived, b.unit)}
        </Row>
        <Row label="Годна до">{humanDate(b.expiresAt, tz, now)}</Row>
      </span>
    </button>
  );
}
