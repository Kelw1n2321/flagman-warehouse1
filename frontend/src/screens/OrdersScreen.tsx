import { useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Dish, Order } from '../api/types';
import { DishCard, dishTier, StatusPill } from '../components/Cards';
import { Icon } from '../components/Icon';
import { SearchBox, Workspace } from '../components/Shell';
import { EmptyState, Loadable, LoadingBar, LoadingGrid, Modal, Tag } from '../components/ui';
import { dateShort, humanDate, plural, qty } from '../lib/format';
import { useLive, useNow, useQuery, useTz, useUi, type QueryResult } from '../state/store';

type Lines = Record<number, number>;
type Sort = 'risk' | 'servings' | 'name';

const TITLE_MAX = 80;
const COMMENT_MAX = 500;

export function OrdersScreen() {
  const { route, navigate, toast } = useUi();
  const dishes = useQuery<Dish[]>('/dishes');
  const [lines, setLines] = useState<Lines>({});
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<Order | null>(null);

  const view = route.param === 'history' ? 'history' : 'menu';
  const modalOpen = route.param === 'new';
  const detailId = route.param && route.param !== 'new' && route.param !== 'history' ? route.param : null;

  const setServings = (id: number, servings: number) =>
    setLines((l) => {
      const { [id]: _, ...rest } = l;
      const n = Math.max(0, Math.min(200, servings));
      return n ? { ...rest, [id]: n } : rest;
    });
  const add = (id: number, delta: number) => setServings(id, (lines[id] ?? 0) + delta);
  const reset = () => (setLines({}), setTitle(''), setComment(''));

  return (
    <Workspace>
      {view === 'menu' ? (
        <DishBoard q={dishes} lines={lines} onAdd={(id) => (add(id, 1), navigate('orders', 'new'))} />
      ) : (
        <OrderHistory />
      )}
      {modalOpen && (
        <NewOrderModal
          dishes={dishes.data ?? []}
          lines={lines}
          add={add}
          setServings={setServings}
          title={title}
          setTitle={setTitle}
          comment={comment}
          setComment={setComment}
          onCancel={() => (reset(), navigate('orders'))}
          onClose={() => navigate('orders')}
          onDone={(order) => {
            setResult(order);
            if (order.status === 'completed') {
              reset();
              toast(`Заказ ${order.number} создан, ингредиенты списаны по FEFO`, 'ok');
            } else toast(`Заказ ${order.number} отклонён: не хватает ингредиентов`, 'error');
            navigate('orders');
          }}
        />
      )}
      {detailId && <OrderDetail id={detailId} onClose={() => navigate('orders', 'history')} />}
      {result && <OrderResult order={result} onClose={() => setResult(null)} />}
    </Workspace>
  );
}

// ───────────────────────── Панель блюд ─────────────────────────

function DishBoard({ q, lines, onAdd }: { q: QueryResult<Dish[]>; lines: Lines; onAdd: (id: number) => void }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<Sort>('risk');
  const { navigate } = useUi();
  const all = q.data ?? [];
  const cats = [...new Set(all.map((d) => d.category))].sort((a, b) => a.localeCompare(b, 'ru'));
  const t = search.trim().toLowerCase();
  const risky = (d: Dish) => d.ingredients.filter((i) => i.atRisk).length;

  const list = all
    .filter((d) => !category || d.category === category)
    .filter((d) => !t || d.name.toLowerCase().includes(t) || d.ingredients.some((i) => i.name.toLowerCase().includes(t)))
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'ru')
        : sort === 'servings'
          ? a.maxServings - b.maxServings || a.name.localeCompare(b.name, 'ru')
          : risky(b) - risky(a) || a.name.localeCompare(b.name, 'ru'),
    );
  const toCheck = all.filter((d) => dishTier(d).tier === 'attention').length;
  const stopped = all.filter((d) => !d.available).length;

  return (
    <>
      <div className="toolbar">
        <div style={{ width: 280, maxWidth: '100%' }}>
          <SearchBox value={search} onChange={setSearch} placeholder="Найти блюдо или ингредиент" />
        </div>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Сортировка">
          <option value="risk">По риску сроков</option>
          <option value="servings">По доступным порциям</option>
          <option value="name">По названию</option>
        </select>
        <span className="spacer" />
        <div className="counters" aria-label="Сводка по блюдам">
          <span>
            {all.length} {plural(all.length, 'блюдо', 'блюда', 'блюд')}
          </span>
          <span className="tone-warn">{toCheck} проверить</span>
          <span className="tone-crit">{stopped} в стоп-листе</span>
        </div>
      </div>
      <div className="cattabs">
        <div role="tablist" aria-label="Разделы меню">
          {['', ...cats].map((c) => (
            <button key={c || 'all'} role="tab" aria-selected={category === c} className={category === c ? 'is-active' : ''} onClick={() => setCategory(c)}>
              {c || 'Все блюда'}
            </button>
          ))}
        </div>
        <button className="btn btn--sm btn--dark" onClick={() => navigate('orders', 'history')}>
          <Icon name="list" /> История заказов
        </button>
      </div>
      <LoadingBar active={q.loading} />
      <div className="tray">
        <Loadable q={q} skeleton={<LoadingGrid count={8} />}>
          {() =>
            list.length === 0 ? (
              <EmptyState icon="search" title="Блюда не найдены" text="Измените поиск или раздел меню." />
            ) : (
              <>
                <div className="grid">
                  {list.map((d) => (
                    <DishCard key={d.id} d={d} inOrder={lines[d.id]} onAdd={() => onAdd(d.id)} />
                  ))}
                </div>
                <p className="footnote">
                  <Icon name="alert" /> Порции — оценка по остаткам. Истекающие продукты учитываются по FEFO: сначала с ближайшим сроком годности.
                </p>
              </>
            )
          }
        </Loadable>
      </div>
    </>
  );
}

// ───────────────────────── Окно «Новый заказ» ─────────────────────────

function NewOrderModal({
  dishes,
  lines,
  add,
  setServings,
  title,
  setTitle,
  comment,
  setComment,
  onCancel,
  onClose,
  onDone,
}: {
  dishes: Dish[];
  lines: Lines;
  add: (id: number, delta: number) => void;
  setServings: (id: number, n: number) => void;
  title: string;
  setTitle: (v: string) => void;
  comment: string;
  setComment: (v: string) => void;
  onCancel: () => void;
  onClose: () => void;
  onDone: (o: Order) => void;
}) {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { bump } = useLive();
  const t = search.trim().toLowerCase();
  const list = dishes
    .filter((d) => !t || d.name.toLowerCase().includes(t) || d.ingredients.some((i) => i.name.toLowerCase().includes(t)))
    .sort((a, b) => Number(b.available) - Number(a.available) || a.name.localeCompare(b.name, 'ru'));
  const entries = Object.entries(lines)
    .map(([id, n]) => ({ dish: dishes.find((d) => d.id === Number(id)), servings: n }))
    .filter((e): e is { dish: Dish; servings: number } => !!e.dish);
  const total = entries.reduce((a, e) => a + e.servings, 0);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const order = await api.post<Order>('/orders', {
        title: title.trim() || null,
        comment: comment.trim() || null,
        lines: entries.map((e) => ({ dishId: e.dish.id, servings: e.servings })),
      });
      onDone(order);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && (e.body as Order | null)?.number) onDone(e.body as Order);
      else setError(e instanceof ApiError ? e.detail : 'Заказ не создан. Повторите попытку.');
    } finally {
      setBusy(false);
      bump();
    }
  };

  return (
    <Modal
      size="md"
      onClose={onClose}
      title={
        <span className="row" style={{ gap: 10 }}>
          Новый заказ <span className="tag">Черновик</span>
        </span>
      }
      footer={
        <>
          <div className="order-total">
            <small>Всего порций</small>
            <b>{total}</b>
          </div>
          <span className="spacer" />
          <button className="btn btn--dark" onClick={onCancel}>
            Отмена
          </button>
          <button className="btn btn--blue" disabled={busy || total === 0} onClick={create}>
            {busy ? 'Создаём…' : 'Создать заказ'}
          </button>
        </>
      }
    >
      <label className="field field--lg">
        Название заказа
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, стол 5 или заказ навынос" maxLength={TITLE_MAX} />
      </label>

      <section className="order-section">
        <header>
          <h3>Добавить блюда</h3>
          <span>
            {dishes.length} {plural(dishes.length, 'блюдо', 'блюда', 'блюд')}
          </span>
        </header>
        <SearchBox value={search} onChange={setSearch} placeholder="Найти блюдо" />
        <div className="pick-list" role="list">
          {list.length === 0 && <div className="pick-list__empty">Блюдо не найдено</div>}
          {list.map((d) => {
            const risk = d.ingredients.filter((i) => i.atRisk).length;
            return (
              <div key={d.id} className="pick-row" role="listitem">
                <div className="pick-row__main">
                  <b>{d.name}</b>
                  <span>{d.category}</span>
                </div>
                <div className="pick-row__info">
                  {d.available ? (
                    <b className="tone-ok">
                      {d.maxServings} {plural(d.maxServings, 'порция', 'порции', 'порций')}
                    </b>
                  ) : (
                    <b className="tone-crit">Стоп-лист</b>
                  )}
                  {d.available ? (
                    risk ? <span className="tone-warn">Истекает: {risk}</span> : <span>Без риска сроков</span>
                  ) : (
                    <span className="tone-crit">Нет: {d.ingredients.filter((i) => i.missing > 0).map((i) => i.name.toLowerCase()).join(', ')}</span>
                  )}
                </div>
                <button className="iconbtn iconbtn--sm" disabled={!d.available} onClick={() => add(d.id, 1)} aria-label={`Добавить «${d.name}»`} title={d.available ? 'Добавить порцию' : 'Блюдо в стоп-листе'}>
                  <Icon name="plus" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="order-section">
        <header>
          <h3>Состав заказа</h3>
          <span>
            {entries.length} {plural(entries.length, 'позиция', 'позиции', 'позиций')}
          </span>
        </header>
        {entries.length === 0 ? (
          <div className="order-empty">
            <b>В заказе пока нет блюд</b>
            <span>Добавьте блюда из списка выше</span>
          </div>
        ) : (
          <div className="pick-list pick-list--plain" role="list">
            {entries.map(({ dish, servings }) => {
              const over = servings > dish.maxServings;
              return (
                <div key={dish.id} className="pick-row" role="listitem">
                  <div className="pick-row__main">
                    <b>{dish.name}</b>
                    <span className={over ? 'tone-crit' : undefined}>
                      {over ? `Хватит только на ${dish.maxServings} ${plural(dish.maxServings, 'порцию', 'порции', 'порций')}` : `Доступно до ${dish.maxServings}`}
                    </span>
                  </div>
                  <div className="stepper" aria-label={`Порций: ${servings}`}>
                    <button onClick={() => add(dish.id, -1)} aria-label="Меньше">
                      <Icon name="minus" />
                    </button>
                    <input
                      value={servings}
                      inputMode="numeric"
                      onChange={(e) => {
                        const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
                        if (!Number.isNaN(n)) setServings(dish.id, n);
                      }}
                      aria-label="Количество порций"
                    />
                    <button onClick={() => add(dish.id, 1)} aria-label="Больше">
                      <Icon name="plus" />
                    </button>
                  </div>
                  <button className="iconbtn iconbtn--sm iconbtn--ghost" onClick={() => setServings(dish.id, 0)} aria-label={`Убрать «${dish.name}»`} title="Убрать из заказа">
                    <Icon name="x" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <label className="field field--lg">
        <span>
          Комментарий <span className="hint">· необязательно</span>
        </span>
        <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Пожелания к приготовлению" maxLength={COMMENT_MAX} />
      </label>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  );
}

// ───────────────────────── Результат, детали, история ─────────────────────────

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
          {order.title && (
            <>
              <dt>Название</dt>
              <dd>{order.title}</dd>
            </>
          )}
          <dt>Создан</dt>
          <dd>{dateShort(order.createdAt, tz)}</dd>
          <dt>Статус</dt>
          <dd>
            <StatusPill tier={order.status === 'completed' ? 'ok' : 'critical'}>{order.status === 'completed' ? 'Выполнен' : 'Отклонён'}</StatusPill>
          </dd>
          <dt>Блюда</dt>
          <dd>{order.lines.map((l) => `${l.dishName} × ${l.servings}`).join(', ')}</dd>
          {order.comment && (
            <>
              <dt>Комментарий</dt>
              <dd>{order.comment}</dd>
            </>
          )}
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
      <Loadable q={q}>{(o) => <OrderBody order={o} />}</Loadable>
    </Modal>
  );
}

function OrderHistory() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useQuery<Order[]>(`/orders?limit=300${status ? `&status=${status}` : ''}`);
  const { navigate } = useUi();
  const tz = useTz();
  const now = useNow();
  const t = search.trim().toLowerCase();

  return (
    <>
      <div className="toolbar">
        <button className="btn btn--sm btn--dark" onClick={() => navigate('orders')}>
          <Icon name="chevron" className="flip" /> К блюдам
        </button>
        <div style={{ width: 300, maxWidth: '100%' }}>
          <SearchBox value={search} onChange={setSearch} placeholder="Номер, название или блюдо" />
        </div>
        <div className="seg" role="group" aria-label="Статус заказа">
          {(
            [
              ['', 'Все'],
              ['completed', 'Выполнены'],
              ['rejected', 'Отклонены'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={status === k ? 'is-active' : ''} onClick={() => setStatus(k)} aria-pressed={status === k}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <LoadingBar active={q.loading} />
      <div className="tray">
        <Loadable q={q}>
          {(all) => {
            const list = all.filter(
              (o) => !t || o.number.toLowerCase().includes(t) || (o.title ?? '').toLowerCase().includes(t) || o.lines.some((l) => l.dishName.toLowerCase().includes(t)),
            );
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
                          {o.title && <span className="uid" style={{ fontFamily: 'inherit' }}>{o.title}</span>}
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
