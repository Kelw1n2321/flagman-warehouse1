import type { Batch, Product } from '../api/types';
import { compact, EXPIRY_LABEL, humanDate, qty, relative, RISK_LABEL, riskTier, TIER_LABEL, unitLabel } from '../lib/format';
import { Icon } from './Icon';
import { Emoji } from './ui';

function Counter({ color, value, label }: { color: 'red' | 'green' | 'yellow' | 'gray'; value: number | string; label: string }) {
  const zero = value === 0 || value === '0';
  return (
    <span className={`counter counter--${color} ${zero ? 'is-zero' : ''}`} title={label} aria-label={label}>
      {typeof value === 'number' ? compact(value) : value}
    </span>
  );
}

function TierBadge({ tier }: { tier: 'ok' | 'attention' | 'critical' }) {
  return (
    <span className={`card__badge card__badge--${tier}`} title={TIER_LABEL[tier]}>
      <Icon name={tier === 'ok' ? 'check' : tier === 'attention' ? 'alert' : 'x'} />
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
  const redValue = p.expired > 0 ? p.expired : p.belowMinimum ? deficit : 0;
  const redLabel =
    p.expired > 0
      ? `Просрочено: ${qty(p.expired, p.unit)} (не используется)`
      : p.belowMinimum
        ? `Дефицит до минимума: ${qty(deficit, p.unit)}`
        : 'Просрочки и дефицита нет';
  const u = unitLabel(p.unit);

  return (
    <button
      className={`card ${tier === 'critical' ? 'card--critical' : ''} ${selected ? 'is-selected' : ''}`}
      onClick={onOpen}
      aria-label={`${p.name}: доступно ${qty(p.available, p.unit, { small: false })}, ${TIER_LABEL[tier]}`}
    >
      <span className="card__counters">
        <Counter color="red" value={redValue} label={redLabel} />
        <Counter color="green" value={p.available} label={`Доступно: ${qty(p.available, p.unit)}`} />
        <Counter color="yellow" value={atRisk} label={`Истекает в ближайшие ${soonHours} ч: ${qty(atRisk, p.unit)}`} />
      </span>
      <span className="card__thumb">
        <Emoji>{p.icon}</Emoji>
        <span className="x" title="Количество партий">
          ×{p.batchCount}
        </span>
        <TierBadge tier={tier} />
      </span>
      <span className="card__body">
        <span className="card__name">{p.name}</span>
        <span className="card__sub">
          {p.category} · {p.sku}
        </span>
        <span className="card__line">
          Партий: <b>{p.batchCount}</b>
          {p.total !== p.available && <> · всего {qty(p.total, p.unit)}</>}
        </span>
        <span className="card__line">
          {atRisk > 0 ? (
            <>
              Истекает ≤{soonHours} ч: <b>{qty(atRisk, p.unit)}</b>
            </>
          ) : p.expired > 0 ? (
            <>
              Просрочено: <b>{qty(p.expired, p.unit)}</b>
            </>
          ) : (
            <>Сроки в норме</>
          )}
        </span>
        <span className="card__line">
          Ближ. срок: <b>{p.earliestExpiry ? humanDate(p.earliestExpiry, tz, now) : '—'}</b>
        </span>
        {p.blockedDishes.length > 0 && (
          <span className="card__line" title={p.blockedDishes.join(', ')}>
            ⛔ Стоп: {p.blockedDishes.join(', ')}
          </span>
        )}
        <span className="card__foot">
          <span>
            <span className="card__status">
              {tier === 'ok' ? '✓' : '!'} {tier === 'ok' ? TIER_LABEL.ok : RISK_LABEL[p.risk === 'ok' ? 'low' : p.risk]}
            </span>
            <span className="card__big">
              {compact(p.available)}
              <small>{u}</small>
            </span>
          </span>
          <span className="open-btn" aria-hidden>
            <Icon name="chevron" />
          </span>
        </span>
      </span>
    </button>
  );
}

const EXPIRY_COLOR = { normal: 'green', soon: 'yellow', critical: 'red', expired: 'red' } as const;

export function BatchCard({ b, tz, now, onOpen }: { b: Batch; tz: string; now: Date; onOpen: () => void }) {
  const tier = b.expiry === 'normal' ? 'ok' : b.expiry === 'soon' ? 'attention' : 'critical';
  return (
    <button className={`card ${b.expiry === 'expired' ? 'card--critical' : ''}`} onClick={onOpen} aria-label={`Партия ${b.code} ${b.productName}`}>
      <span className="card__counters">
        <Counter color={EXPIRY_COLOR[b.expiry]} value={b.expiry === 'expired' ? '✕' : Math.max(0, Math.floor(b.hoursLeft / 24))} label={`${EXPIRY_LABEL[b.expiry]}: ${relative(b.hoursLeft)}`} />
        <Counter color="green" value={b.expiry === 'expired' ? 0 : b.quantityRemaining} label={`Пригодно: ${qty(b.expiry === 'expired' ? 0 : b.quantityRemaining, b.unit)}`} />
        <Counter color="gray" value={b.fefoRank ?? '—'} label={b.fefoRank ? `Очередь FEFO: ${b.fefoRank}` : 'Не участвует в FEFO'} />
      </span>
      <span className="card__thumb">
        <Emoji>{b.icon}</Emoji>
        <span className="x">{b.fefoRank === 1 ? 'FEFO' : ''}</span>
        <TierBadge tier={tier} />
      </span>
      <span className="card__body">
        <span className="card__name">{b.productName}</span>
        <span className="card__sub">Партия {b.code}</span>
        <span className="card__line">
          Поставка: <b>{b.supplyNumber}</b>
        </span>
        <span className="card__line">
          Принята: {humanDate(b.receivedAt, tz, now)} · из {qty(b.quantityReceived, b.unit)}
        </span>
        <span className="card__line">
          Срок: <b>{humanDate(b.expiresAt, tz, now)}</b> ({relative(b.hoursLeft)})
        </span>
        <span className="card__foot">
          <span>
            <span className="card__status">{EXPIRY_LABEL[b.expiry]}</span>
            <span className="card__big">
              {compact(b.quantityRemaining)}
              <small>{unitLabel(b.unit)}</small>
            </span>
          </span>
          <span className="open-btn" aria-hidden>
            <Icon name="chevron" />
          </span>
        </span>
      </span>
    </button>
  );
}
