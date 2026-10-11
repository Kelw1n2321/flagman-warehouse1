import { useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Dish, Order, OrderCheck } from '../api/types';
import { Metric, StatusPill } from '../components/Cards';
import { Icon } from '../components/Icon';
import { SearchBox, Workspace } from '../components/Shell';
import { Emoji, EmptyState, Loadable, LoadingBar, LoadingGrid, Modal, Tag } from '../components/ui';
import { dateShort, humanDate, qty } from '../lib/format';
import { useLive, useNow, useQuery, useTz, useUi } from '../state/store';
import { matches } from './StockScreen';

type Lines = Record<number, number>;

export function OrdersScreen() {
  const { route, navigate } = useUi();
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'menu' | 'history'>(route.param ? 'history' : 'menu');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [lines, setLines] = useState<Lines>({});
  const dishes = useQuery<Dish[]>('/dishes');
  const count = Object.values(lines).reduce((a, b) => a + b, 0);
  const cats = [...new Set((dishes.data ?? []).map((d) => d.category))].sort();

  const add = (id: number, delta: number) =>
    setLines((l) => {
      const next = Math.max(0, Math.min(200, (l[id] ?? 0) + delta));
      const { [id]: _, ...rest } = l;
      return next ? { ...rest, [id]: next } : rest;
    });

  return (
    <Workspace
      rightLabel="Заказ"
      rightCount={count || undefined}
      sidebar={
        <>
          <SearchBox value={search} onChange={setSearch} placeholder={view === 'menu' ? 'Найти блюдо…' : 'Номер или блюдо…'} />
          <div className="sidebar__scroll">
            <h3>Заказы</h3>
            <button className={`side-btn side-btn--nav ${view === 'menu' ? 'is-active' : ''}`} onClick={() => setView('menu')}>
              <Icon name="chef" /> <span style={{ flex: 1 }}>Новый заказ</span>
            </button>
            <button className={`side-btn side-btn--nav ${view === 'history' ? 'is-active' : ''}`} onClick={() => setView('history')}>
              <Icon name="list" /> <span style={{ flex: 1 }}>История заказов</span>
            </button>
            {view === 'menu' ? (
              <>
                <h3>Разделы меню</h3>
                <button className={`side-btn ${category === '' ? 'is-active' : ''}`} onClick={() => setCategory('')}>
                  <span style={{ flex: 1, textAlign: 'left' }}>Всё меню</span>
                </button>
                {cats.map((c) => (
                  <button key={c} className={`side-btn ${category === c ? 'is-active' : ''}`} onClick={() => setCategory(c)}>
                    <span style={{ flex: 1, textAlign: 'left' }}>{c}</span>
                  </button>
                ))}
              </>
            ) : (
              <>
                <h3>Статус</h3>
                {(
                  [
                    ['', 'Все'],
                    ['completed', 'Выполнены'],
                    ['rejected', 'Отклонены'],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} className={`side-btn ${status === k ? 'is-active' : ''}`} onClick={() => setStatus(k)}>
                    <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      }
      right={<OrderComposer lines={lines} dishes={dishes.data ?? []} add={add} clear={() => setLines({})} />}
    >
      {view === 'menu' ? (
        <>
          <div className="toolbar">
            <span className="muted">Добавьте блюда в заказ — система проверит остатки и спишет ингредиенты по FEFO.</span>
          </div>
          <LoadingBar active={dishes.loading} />
          <div className="tray">
            <Loadable q={dishes} skeleton={<LoadingGrid count={12} />}>
              {(all) => {
                const list = all.filter((d) => (!category || d.category === category) && matches(d, search));
                if (list.length === 0) return <EmptyState icon="chef" title="Блюда не найдены" />;
                return (
                  <div className="grid">
                    {list.map((d) => (
                      <DishCard key={d.id} d={d} inOrder={lines[d.id] ?? 0} onAdd={() => add(d.id, 1)} />
                    ))}
                  </div>
                );
              }}
            </Loadable>
          </div>
        </>
      ) : (
        <OrderHistory search={search} status={status} />
      )}
      {route.param && <OrderDetail id={route.param} onClose={() => navigate('orders')} />}
    </Workspace>
  );
}

export function DishCard({ d, inOrder, onAdd, onOpen }: { d: Dish; inOrder?: number; onAdd?: () => void; onOpen?: () => void }) {
  const missing = d.ingredients.filter((i) => i.missing > 0);
  const risky = d.ingredients.filter((i) => i.atRisk).length;
  const Tagname = onOpen ? 'button' : 'div';
  const tier = !d.available ? 'critical' : d.hotLevel ? 'attention' : 'ok';
  return (
    <Tagname
      className={`pcard ${onOpen ? 'pcard--clickable' : ''} ${tier === 'critical' ? 'pcard--critical pcard--muted' : ''}`}
      onClick={onOpen}
    >
      <span className="pcard__head">
        <span className="pcard__icon">
          <Emoji>{d.icon}</Emoji>
        </span>
        <span className="pcard__title">
          <span className="pcard__name" style={{ display: 'block' }}>
            {d.name}
          </span>
          <span className="pcard__sub" style={{ display: 'block' }}>
            {d.category} · {d.ingredients.length} ингр.
          </span>
          <StatusPill tier={tier}>{!d.available ? 'Стоп-лист' : d.hotLevel ? 'Продвигать' : 'Доступно'}</StatusPill>
        </span>
      </span>
      <span className="pcard__metrics">
        <Metric label="Порций" value={d.maxServings} tone={d.maxServings ? 'ok' : 'crit'} />
        <Metric label="Не хватает" value={missing.length} tone="crit" zero={!missing.length} title={missing.length ? `Не хватает: ${missing.map((m) => m.name).join(', ')}` : 'Все ингредиенты в наличии'} />
        <Metric label="Истекает" value={risky} tone="warn" zero={!risky} title="Ингредиентов с истекающим сроком" />
      </span>
      <span className="pcard__rows">
        {d.available ? (
          <span className="pcard__row">
            <span>Ограничивает</span>
            <span>{d.limitingProductName ?? '—'}</span>
          </span>
        ) : (
          <span className="pcard__alert" title={missing.map((m) => m.name).join(', ')}>
            Нет: {missing.map((m) => m.name).join(', ')}
          </span>
        )}
        <span className="pcard__row" title={d.ingredients.map((i) => `${i.name} ${qty(i.perServing, i.unit)}`).join(', ')}>
          <span>Состав</span>
          <span>{d.ingredients.map((i) => i.name.split(' ')[0]).join(', ')}</span>
        </span>
      </span>
      {onAdd && (
        <span className="pcard__foot">
          <span className="muted" style={{ fontSize: 12.5 }}>
            {inOrder ? `В заказе: ${inOrder} порц.` : ''}
          </span>
          <button className="btn btn--sm btn--blue" onClick={onAdd} aria-label={`Добавить «${d.name}» в заказ`}>
            <Icon name="plus" /> В заказ
          </button>
        </span>
      )}
    </Tagname>
  );
}

function OrderComposer({ lines, dishes, add, clear }: { lines: Lines; dishes: Dish[]; add: (id: number, d: number) => void; clear: () => void }) {
  const [check, setCheck] = useState<OrderCheck | null>(null);
  const [result, setResult] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const { bump } = useLive();
  const entries = Object.entries(lines).map(([id, n]) => ({ dish: dishes.find((d) => d.id === Number(id)), servings: n }));
  const payload = { lines: Object.entries(lines).map(([dishId, servings]) => ({ dishId: Number(dishId), servings })) };
  const total = entries.reduce((a, e) => a + e.servings, 0);

  const doCheck = async () => {
    setBusy(true);
    try {
      setCheck(await api.post<OrderCheck>('/dishes/availability-check', payload));
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : 'Проверка не выполнена', 'error');
    } finally {
      setBusy(false);
    }
  };

  const place = async () => {
    setBusy(true);
    try {
      const order = await api.post<Order>('/orders', payload);
      setResult(order);
      clear();
      toast(`Заказ ${order.number} принят, ингредиенты списаны`, 'ok');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body && (e.body as Order).number) {
        setResult(e.body as Order);
        toast(`Заказ ${(e.body as Order).number} отклонён: не хватает ингредиентов`, 'error');
      } else toast(e instanceof ApiError ? e.detail : 'Заказ не оформлен', 'error');
    } finally {
      setBusy(false);
      bump();
    }
  };

  return (
    <>
      <div className="rightbar__title">
        <h2>Заказ</h2>
        {total > 0 && (
          <button className="btn btn--sm btn--red" onClick={clear} aria-label="Очистить заказ">
            <Icon name="minus" />
          </button>
        )}
      </div>
      <div className="rightbar__body">
        {entries.length === 0 ? (
          <EmptyState icon="list" title="Заказ пуст" text="Добавьте блюда из меню кнопкой «В заказ»." />
        ) : (
          entries.map(({ dish, servings }) =>
            dish ? (
              <div key={dish.id} className={`risk risk--${dish.available && dish.maxServings >= servings ? 'ok' : 'critical'}`} style={{ padding: 8 }}>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <span className="emoji" style={{ fontSize: 26 }}>
                    {dish.icon}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{dish.name}</b>
                    <div className="risk__meta">
                      {dish.maxServings >= servings ? `Хватает (до ${dish.maxServings} порц.)` : dish.available ? `Отдельно можно максимум ${dish.maxServings} порц.` : 'В стоп-листе'}
                    </div>
                  </div>
                  <button className="btn btn--sm" onClick={() => add(dish.id, -1)} aria-label="Меньше">
                    <Icon name="minus" />
                  </button>
                  <b className="pill-num" style={{ minWidth: 22, textAlign: 'center' }}>
                    {servings}
                  </b>
                  <button className="btn btn--sm" onClick={() => add(dish.id, 1)} aria-label="Больше">
                    <Icon name="plus" />
                  </button>
                </div>
              </div>
            ) : null,
          )
        )}
      </div>
      <div className="rightbar__foot" style={{ flexWrap: 'wrap' }}>
        <span>
          <span className="big">{total}</span> <span className="muted">порц.</span>
        </span>
        <span className="row" style={{ gap: 8 }}>
          <button className="btn" disabled={busy || total === 0} onClick={doCheck}>
            Проверить
          </button>
          <button className="btn btn--lg btn--blue" disabled={busy || total === 0} onClick={place}>
            Оформить
          </button>
        </span>
      </div>
      {check && <CheckDialog check={check} onClose={() => setCheck(null)} onPlace={() => (setCheck(null), place())} />}
      {result && <OrderResult order={result} onClose={() => setResult(null)} />}
    </>
  );
}

function CheckDialog({ check, onClose, onPlace }: { check: OrderCheck; onClose: () => void; onPlace: () => void }) {
  const tz = useTz();
  return (
    <Modal
      title={check.canFulfill ? 'Заказ можно выполнить' : 'Ингредиентов не хватает'}
      onClose={onClose}
      size="md"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
          {check.canFulfill && (
            <button className="btn btn--blue" onClick={onPlace}>
              Оформить и списать
            </button>
          )}
        </>
      }
    >
      {check.reason && <p style={{ margin: 0, color: 'var(--crit)' }}>{check.reason}</p>}
      <div className="sheet table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Ингредиент</th>
              <th className="num">Нужно</th>
              <th className="num">Доступно</th>
              <th className="num">Не хватает</th>
              <th>План списания (FEFO)</th>
            </tr>
          </thead>
          <tbody>
            {check.requirements.map((r) => (
              <tr key={r.productId} className={r.missing > 0 ? 'row--expired' : ''}>
                <td>
                  <b>{r.productName}</b>
                  {r.expiredExcluded > 0 && <div className="ink-muted">+ {qty(r.expiredExcluded, r.unit)} просрочено, не учитывается</div>}
                </td>
                <td className="num">{qty(r.required, r.unit)}</td>
                <td className="num">{qty(r.available, r.unit)}</td>
                <td className="num">{r.missing > 0 ? <b style={{ color: 'var(--crit)' }}>{qty(r.missing, r.unit)}</b> : '—'}</td>
                <td style={{ fontSize: 12.5 }}>
                  {r.fefoPlan.length
                    ? r.fefoPlan.map((c) => `${c.batchCode} (до ${c.batchExpiresAt ? dateShort(c.batchExpiresAt, tz) : '—'}): ${qty(c.quantity, c.unit)}`).join('; ')
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function OrderResult({ order, onClose }: { order: Order; onClose: () => void }) {
  return (
    <Modal title={`Заказ ${order.number}: ${order.status === 'completed' ? 'выполнен' : 'отклонён'}`} onClose={onClose} size="md">
      <OrderBody order={order} />
    </Modal>
  );
}

function OrderBody({ order }: { order: Order }) {
  const tz = useTz();
  const { openProduct } = useUi();
  return (
    <>
      <div className="sheet">
        <dl className="kv">
          <dt>Создан</dt>
          <dd>{dateShort(order.createdAt, tz)}</dd>
          <dt>Статус</dt>
          <dd>
            <Tag kind={order.status}>{order.status === 'completed' ? 'Выполнен' : 'Отклонён'}</Tag>
          </dd>
          <dt>Блюда</dt>
          <dd>{order.lines.map((l) => `${l.dishName} × ${l.servings}`).join(', ')}</dd>
          <dt>Источник</dt>
          <dd>{order.source === 'manual' ? 'Касса / вручную' : order.source === 'generator' ? 'Генератор событий' : 'Демо-история'}</dd>
        </dl>
      </div>
      {order.status === 'rejected' && (
        <div className="sheet table-wrap">
          <h3>Причина отказа: не хватает ингредиентов</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Ингредиент</th>
                <th className="num">Нужно</th>
                <th className="num">Было доступно</th>
                <th className="num">Не хватало</th>
                <th className="num">Просрочено (исключено)</th>
              </tr>
            </thead>
            <tbody>
              {order.shortages.map((s) => (
                <tr key={s.productId} className="row--expired is-clickable" onClick={() => openProduct(s.productId)}>
                  <td>
                    <b>{s.productName}</b>
                  </td>
                  <td className="num">{qty(s.required, s.unit)}</td>
                  <td className="num">{qty(s.available, s.unit)}</td>
                  <td className="num">
                    <b>{qty(s.missing, s.unit)}</b>
                  </td>
                  <td className="num">{s.expiredExcluded ? qty(s.expiredExcluded, s.unit) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ink-muted" style={{ margin: '8px 0 0' }}>
            Складские остатки не изменились: заказ отклонён целиком.
          </p>
        </div>
      )}
      {order.status === 'completed' && order.consumption && (
        <div className="sheet table-wrap">
          <h3>Списано со склада (FEFO — сначала ранний срок)</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Продукт</th>
                <th>Партия</th>
                <th>Годна до</th>
                <th className="num">Списано</th>
              </tr>
            </thead>
            <tbody>
              {order.consumption.map((c, i) => (
                <tr key={i} className="is-clickable" onClick={() => openProduct(c.productId)}>
                  <td>{c.productName}</td>
                  <td>{c.batchCode}</td>
                  <td>{c.batchExpiresAt ? dateShort(c.batchExpiresAt, tz) : '—'}</td>
                  <td className="num">{qty(c.quantity, c.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery<Order>(`/orders/${id}`);
  return (
    <Modal title={q.data ? `Заказ ${q.data.number}` : 'Заказ'} icon="receipt" onClose={onClose} size="md">
      <Loadable q={q} dark>
        {(o) => <OrderBody order={o} />}
      </Loadable>
    </Modal>
  );
}

function OrderHistory({ search, status }: { search: string; status: string }) {
  const q = useQuery<Order[]>(`/orders?limit=300${status ? `&status=${status}` : ''}`);
  const { navigate } = useUi();
  const tz = useTz();
  const now = useNow();
  return (
    <>
      <LoadingBar active={q.loading} />
      <div className="tray">
        <Loadable q={q}>
          {(all) => {
            const t = search.trim().toLowerCase();
            const list = all.filter((o) => !t || o.number.toLowerCase().includes(t) || o.lines.some((l) => l.dishName.toLowerCase().includes(t)));
            if (list.length === 0) return <EmptyState icon="receipt" title="Заказов не найдено" />;
            return (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Номер</th>
                      <th>Время</th>
                      <th>Блюда</th>
                      <th>Статус</th>
                      <th>Причина отказа</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((o) => (
                      <tr key={o.id} className={`is-clickable ${o.status === 'rejected' ? 'row--soon' : ''}`} onClick={() => navigate('orders', o.id)}>
                        <td>
                          <b>{o.number}</b>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{humanDate(o.createdAt, tz, now)}</td>
                        <td>{o.lines.map((l) => `${l.dishName} × ${l.servings}`).join(', ')}</td>
                        <td>
                          <Tag kind={o.status}>{o.status === 'completed' ? 'Выполнен' : 'Отклонён'}</Tag>
                        </td>
                        <td style={{ fontSize: 12.5, maxWidth: 380 }}>{o.shortages.map((s) => `${s.productName}: −${qty(s.missing, s.unit)}`).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        </Loadable>
      </div>
    </>
  );
}
