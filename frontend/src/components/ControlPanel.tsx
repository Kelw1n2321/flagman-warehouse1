import { useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { Alert, Batch, Product, StopList } from '../api/types';
import { humanDate, qty, relative } from '../lib/format';
import { useAction, useLive, useNow, useQuery, useTz, useUi } from '../state/store';
import { Icon, type IconName } from './Icon';
import { EmptyState, Loadable } from './ui';

type Tab = 'risks' | 'expiry' | 'deficit';

export const ALERT_ICON: Record<string, IconName> = {
  DishStopped: 'stop',
  Expired: 'alert',
  ExpiryCritical: 'clock',
  ExpiringSoon: 'clock',
  OutOfStock: 'inbox',
  LowStock: 'box',
  OrderRejected: 'receipt',
  ExpiredWrittenOff: 'trash',
};

const ICON_NAMES = new Set<string>(Object.values(ALERT_ICON));

/** Элемент списка рисков: заголовок раскрывает подробности и доступные действия. */
export function RiskItem({
  tone,
  icon,
  title,
  text,
  meta,
  open,
  onToggle,
  actions,
}: {
  tone: 'critical' | 'warning' | 'info' | 'ok';
  icon: string;
  title: ReactNode;
  text?: ReactNode;
  meta?: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className={`risk risk--${tone} ${open ? 'is-selected' : ''}`}>
      <button className="risk__head" onClick={onToggle} aria-expanded={actions ? !!open : undefined}>
        <span className={`risk__icon risk__icon--${tone}`}>
          <Icon name={ICON_NAMES.has(icon) ? (icon as IconName) : 'box'} />
        </span>
        <span>
          <span className="risk__title">{title}</span>
          {text && <span className="risk__text">{text}</span>}
          {meta && <span className="risk__meta">{meta}</span>}
        </span>
      </button>
      {open && actions && <div className="risk__actions">{actions}</div>}
    </div>
  );
}

/** Правая панель «Контроль склада»: активные риски, ближайшие стопы, сроки и дефицит. */
export function ControlPanel() {
  const [tab, setTab] = useState<Tab>('risks');
  const [selected, setSelected] = useState<string | null>(null);
  const { summary } = useLive();
  const { run, busy } = useAction();
  const { confirm } = useUi();
  const active = summary?.activeAlerts ?? 0;
  const toggle = (k: string) => setSelected((s) => (s === k ? null : k));

  const ackAll = async () => {
    const ok = await confirm({
      title: 'Принять все предупреждения?',
      text: `${active} активных предупреждений будут отмечены как просмотренные. Сохраняющиеся условия останутся в списке рисков.`,
      confirmLabel: 'Принять все',
    });
    if (ok) await run(() => api.post<{ acknowledged: number }>('/alerts/acknowledge', { ids: null }), (r) => `Принято предупреждений: ${r.acknowledged}`);
  };

  return (
    <>
      <div className="rightbar__title">
        <h2>Контроль</h2>
        <span className="tag tag--critical" title="Критических активных предупреждений">
          {summary?.criticalAlerts ?? 0} крит.
        </span>
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ['risks', 'Риски'],
            ['expiry', 'Сроки'],
            ['deficit', 'Дефицит'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-active' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>
      <div className="rightbar__body">
        {tab === 'risks' && <RisksTab selected={selected} toggle={toggle} />}
        {tab === 'expiry' && <ExpiryTab selected={selected} toggle={toggle} />}
        {tab === 'deficit' && <DeficitTab selected={selected} toggle={toggle} />}
      </div>
      <div className="rightbar__foot">
        <span title="Активных (непросмотренных) предупреждений">
          <span className="big">{active}</span> <span className="muted">активн.</span>
        </span>
        <button className="btn btn--lg" disabled={active === 0 || busy} onClick={ackAll}>
          Принять все
        </button>
      </div>
    </>
  );
}

const sev = (a: Alert) => (a.status === 'active' ? 10 : 0) + (a.severity === 'critical' ? 3 : a.severity === 'warning' ? 2 : 1);
const toneOf = (a: Alert) => (a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info');

interface TabProps {
  selected: string | null;
  toggle: (k: string) => void;
}

function RisksTab({ selected, toggle }: TabProps) {
  const alerts = useQuery<Alert[]>('/alerts?status=open&limit=60');
  const stop = useQuery<StopList>('/stop-list');
  const { navigate, openProduct } = useUi();
  const { run, busy } = useAction();
  const tz = useTz();
  const now = useNow();

  return (
    <Loadable q={alerts} dark>
      {(list) => {
        const sorted = [...list].sort((a, b) => sev(b) - sev(a) || +new Date(b.createdAt) - +new Date(a.createdAt));
        const forecast = (stop.data?.forecast ?? []).filter((f) => f.hoursUntil <= 48).slice(0, 4);
        if (sorted.length === 0 && forecast.length === 0)
          return <EmptyState dark icon="check" title="Рисков нет" text="Все партии в норме, блюда доступны." />;
        return (
          <>
            {sorted.map((a) => (
              <RiskItem
                key={a.id}
                tone={toneOf(a)}
                icon={ALERT_ICON[a.type] ?? 'alert'}
                title={a.title}
                text={a.message}
                meta={
                  <>
                    <span>{humanDate(a.createdAt, tz, now)}</span>
                    {a.status === 'acknowledged' && <span>просмотрено</span>}
                  </>
                }
                open={selected === `a${a.id}`}
                onToggle={() => toggle(`a${a.id}`)}
                actions={
                  <>
                    {a.productId && (
                      <button className="btn btn--sm" onClick={() => openProduct(a.productId)}>
                        Продукт и партии
                      </button>
                    )}
                    {a.type === 'Expired' && a.batchId && (
                      <button className="btn btn--sm btn--red" disabled={busy} onClick={() => run(() => api.post(`/batches/${a.batchId}/write-off`, { reason: 'Списание просрочки' }), 'Партия списана')}>
                        Списать партию
                      </button>
                    )}
                    {(a.type === 'ExpiryCritical' || a.type === 'ExpiringSoon') && (
                      <button className="btn btn--sm btn--blue" onClick={() => navigate('hot')}>
                        Что приготовить?
                      </button>
                    )}
                    {a.type === 'DishStopped' && (
                      <button className="btn btn--sm" onClick={() => navigate('stop-list')}>
                        Стоп-лист
                      </button>
                    )}
                    {(a.type === 'OutOfStock' || a.type === 'LowStock' || a.type === 'DishStopped') && (
                      <button className="btn btn--sm btn--green" onClick={() => navigate('supplies', 'recommendations')}>
                        Заказать поставку
                      </button>
                    )}
                    {a.type === 'OrderRejected' && a.orderId && (
                      <button className="btn btn--sm" onClick={() => navigate('orders', a.orderId)}>
                        Открыть заказ
                      </button>
                    )}
                    {a.status === 'active' && (
                      <button className="btn btn--sm btn--dark" disabled={busy} onClick={() => run(() => api.post('/alerts/acknowledge', { ids: [a.id] }), 'Предупреждение принято')}>
                        <Icon name="check" /> Принять
                      </button>
                    )}
                  </>
                }
              />
            ))}
            {forecast.length > 0 && (
              <h3 className="section-title" style={{ marginTop: 6 }}>
                Ближайшие риски (прогноз)
              </h3>
            )}
            {forecast.map((f) => (
              <RiskItem
                key={f.dishId}
                tone="warning"
                icon="stop"
                title={`«${f.name}» — стоп ${relative(f.hoursUntil)}`}
                text={`При текущем расходе закончится «${f.causeProductName}». Сейчас доступно ${f.maxServings} порц.`}
                onToggle={() => navigate('stop-list')}
              />
            ))}
          </>
        );
      }}
    </Loadable>
  );
}

function ExpiryTab({ selected, toggle }: TabProps) {
  const q = useQuery<Batch[]>('/batches');
  const { openProduct, navigate } = useUi();
  const { run, busy } = useAction();
  const tz = useTz();
  const now = useNow();
  return (
    <Loadable q={q} dark>
      {(all) => {
        const list = all.filter((b) => b.expiry !== 'normal').slice(0, 30);
        if (list.length === 0) return <EmptyState dark icon="check" title="Сроки в норме" />;
        return (
          <>
            {list.map((b) => (
              <RiskItem
                key={b.id}
                tone={b.expiry === 'soon' ? 'warning' : 'critical'}
                icon="clock"
                title={`${b.productName}: ${qty(b.quantityRemaining, b.unit)}`}
                text={`${b.expiry === 'expired' ? 'Просрочено' : 'Истекает'} ${relative(b.hoursLeft)} · ${humanDate(b.expiresAt, tz, now)}`}
                meta={
                  <>
                    <span>{b.code}</span>
                    {b.fefoRank && <span>FEFO №{b.fefoRank}</span>}
                  </>
                }
                open={selected === `b${b.id}`}
                onToggle={() => toggle(`b${b.id}`)}
                actions={
                  <>
                    <button className="btn btn--sm" onClick={() => openProduct(b.productId)}>
                      Продукт
                    </button>
                    {b.expiry === 'expired' ? (
                      <button className="btn btn--sm btn--red" disabled={busy} onClick={() => run(() => api.post(`/batches/${b.id}/write-off`, { reason: 'Списание просрочки' }), 'Партия списана')}>
                        Списать
                      </button>
                    ) : (
                      <button className="btn btn--sm btn--blue" onClick={() => navigate('hot')}>
                        Что приготовить?
                      </button>
                    )}
                  </>
                }
              />
            ))}
          </>
        );
      }}
    </Loadable>
  );
}

function DeficitTab({ selected, toggle }: TabProps) {
  const q = useQuery<Product[]>('/stock?sort=risk');
  const { openProduct, navigate } = useUi();
  return (
    <Loadable q={q} dark>
      {(all) => {
        const list = all.filter((p) => p.belowMinimum || p.blockedDishes.length > 0 || p.available <= 0);
        if (list.length === 0) return <EmptyState dark icon="box" title="Дефицита нет" />;
        return (
          <>
            {list.map((p) => (
              <RiskItem
                key={p.id}
                tone={p.blockedDishes.length || p.available <= 0 ? 'critical' : 'warning'}
                icon="box"
                title={p.name}
                text={`Доступно ${qty(p.available, p.unit)} при минимуме ${qty(p.minStock, p.unit)}${p.expired > 0 ? ` · просрочено ${qty(p.expired, p.unit)}` : ''}`}
                meta={p.blockedDishes.length > 0 ? <span>Стоп-лист: {p.blockedDishes.join(', ')}</span> : undefined}
                open={selected === `p${p.id}`}
                onToggle={() => toggle(`p${p.id}`)}
                actions={
                  <>
                    <button className="btn btn--sm" onClick={() => openProduct(p.id)}>
                      Партии и история
                    </button>
                    <button className="btn btn--sm btn--green" onClick={() => navigate('supplies', 'recommendations')}>
                      Рекомендуемая поставка
                    </button>
                  </>
                }
              />
            ))}
          </>
        );
      }}
    </Loadable>
  );
}
