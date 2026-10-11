import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Alert, Batch, Dish, Movement, Product, Settings } from '../api/types';
import { ALERT_ICON, ControlPanel } from '../components/ControlPanel';
import { Icon } from '../components/Icon';
import { MOVEMENT_LABEL, MovementTable } from '../components/ProductModal';
import { CategoryList, SearchBox, SectionNav, Workspace } from '../components/Shell';
import { Emoji, EmptyState, Loadable, LoadingBar, LoadingGrid, Modal, Tag } from '../components/ui';
import { dateShort, EXPIRY_LABEL, humanDate, qty, relative, unitLabel } from '../lib/format';
import { useAction, useLive, useNow, useQuery, useTz, useUi } from '../state/store';
import { DishCard } from './OrdersScreen';
import { matches } from './StockScreen';

// ───────────────────────── Сроки годности ─────────────────────────

const EXPIRY_FILTERS = [
  ['', 'Все партии'],
  ['expired', 'Просрочено'],
  ['critical', 'Критический срок'],
  ['soon', 'Скоро истекает'],
  ['normal', 'Норма'],
] as const;

export function ExpiryScreen() {
  const [status, setStatus] = useState<string>('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'expiry' | 'product' | 'qty'>('expiry');
  const q = useQuery<Batch[]>('/batches');
  const { summary } = useLive();
  const { openProduct, confirm } = useUi();
  const { run, busy } = useAction();
  const tz = useTz();
  const now = useNow();
  const all = q.data ?? [];
  const counts = Object.fromEntries(EXPIRY_FILTERS.map(([k]) => [k, all.filter((b) => !k || b.expiry === k).length]));
  const list = all
    .filter((b) => (!status || b.expiry === status) && (!category || b.category === category))
    .filter((b) => !search.trim() || matches({ name: `${b.productName} ${b.code} ${b.supplyNumber}` }, search))
    .sort((a, b) =>
      sort === 'product' ? a.productName.localeCompare(b.productName, 'ru') || a.hoursLeft - b.hoursLeft : sort === 'qty' ? b.quantityRemaining - a.quantityRemaining : a.hoursLeft - b.hoursLeft,
    );
  const s = summary?.settings;

  const writeOffAll = async () => {
    if (!(await confirm({ title: 'Списать всю просрочку?', text: `Партий с истёкшим сроком: ${counts.expired}. Остаток будет списан с записью в журнал.`, danger: true, confirmLabel: 'Списать' }))) return;
    await run(() => api.post<{ writtenOff: number }>('/batches/write-off-expired'), (r) => `Списано партий: ${r.writtenOff}`);
  };

  return (
    <Workspace
      rightCount={summary?.activeAlerts}
      sidebar={
        <>
          <SearchBox value={search} onChange={setSearch} placeholder="Продукт, партия, поставка…" />
          <div className="sidebar__scroll">
            <h3>Состояние партии</h3>
            {EXPIRY_FILTERS.map(([k, label]) => (
              <button key={k} className={`side-btn ${status === k ? 'is-active' : ''}`} onClick={() => setStatus(k)} aria-pressed={status === k}>
                <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
                <span className="count">{counts[k]}</span>
              </button>
            ))}
            <CategoryList value={category} onChange={setCategory} />
            <SectionNav />
          </div>
        </>
      }
      right={<ControlPanel />}
    >
      <div className="toolbar">
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Сортировка">
          <option value="expiry">По ближайшему сроку</option>
          <option value="product">По продукту</option>
          <option value="qty">По количеству</option>
        </select>
        <div className="legend">
          <span>
            <i className="sq sq--green" /> Норма &gt;{s?.soonHours ?? 72} ч
          </span>
          <span>
            <i className="sq sq--yellow" /> Скоро {s?.criticalHours ?? 24}–{s?.soonHours ?? 72} ч
          </span>
          <span>
            <i className="sq sq--red" /> Критично ≤{s?.criticalHours ?? 24} ч / просрочено
          </span>
        </div>
        <span className="spacer" />
        <button className="btn btn--red" disabled={busy || !counts.expired} onClick={writeOffAll}>
          <Icon name="trash" /> Списать просрочку ({counts.expired ?? 0})
        </button>
      </div>
      <LoadingBar active={q.loading} />
      <div className="tray">
        <Loadable q={q}>
          {() =>
            list.length === 0 ? (
              <EmptyState icon="search" title="Партий не найдено" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Продукт</th>
                      <th>Партия</th>
                      <th>Поставка</th>
                      <th className="num">Доступно</th>
                      <th>Поступила</th>
                      <th>Годна до</th>
                      <th>Осталось</th>
                      <th>Статус</th>
                      <th>FEFO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((b) => (
                      <tr key={b.id} className={`is-clickable row--${b.expiry === 'normal' ? '' : b.expiry}`} onClick={() => openProduct(b.productId)}>
                        <td>
                          <Emoji>{b.icon}</Emoji> <b>{b.productName}</b>
                        </td>
                        <td>{b.code}</td>
                        <td>{b.supplyNumber}</td>
                        <td className="num">
                          {b.expiry === 'expired' ? (
                            <span title="Исключено из доступного остатка">
                              0 <span className="ink-muted">({qty(b.quantityRemaining, b.unit)} просроч.)</span>
                            </span>
                          ) : (
                            <b>{qty(b.quantityRemaining, b.unit)}</b>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{dateShort(b.receivedAt, tz)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{humanDate(b.expiresAt, tz, now)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <LiveLeft expiresAt={b.expiresAt} />
                        </td>
                        <td>
                          <Tag kind={b.expiry}>{EXPIRY_LABEL[b.expiry]}</Tag>
                        </td>
                        <td className="pill-num">{b.fefoRank ? `№${b.fefoRank}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loadable>
      </div>
    </Workspace>
  );
}

/** Оставшееся время, тикающее на клиенте между обновлениями данных. */
function LiveLeft({ expiresAt }: { expiresAt: string }) {
  const now = useNow();
  const h = (Date.parse(expiresAt) - now.getTime()) / 3_600_000;
  return <>{h > 0 ? relative(h) : `истёк ${relative(h)}`}</>;
}

// ───────────────────────── Журнал движения ─────────────────────────

export function JournalScreen() {
  const { route } = useUi();
  const [type, setType] = useState('');
  const [productId, setProductId] = useState<string>(route.param ?? '');
  const products = useQuery<Product[]>('/stock?sort=name');
  const q = useQuery<Movement[]>(`/movements?limit=400${productId ? `&productId=${productId}` : ''}${type ? `&type=${type}` : ''}`);
  const tz = useTz();
  useEffect(() => setProductId(route.param ?? ''), [route.param]);

  return (
    <Workspace
      sidebar={
        <div className="sidebar__scroll">
          <h3>Тип операции</h3>
          {(['', ...Object.keys(MOVEMENT_LABEL)] as (Movement['type'] | '')[]).map((t) => (
            <button key={t} className={`side-btn ${type === t ? 'is-active' : ''}`} onClick={() => setType(t)}>
              <span style={{ flex: 1, textAlign: 'left' }}>{t ? MOVEMENT_LABEL[t] : 'Все операции'}</span>
            </button>
          ))}
          <SectionNav />
        </div>
      }
    >
      <div className="toolbar">
        <select className="select" value={productId} onChange={(e) => setProductId(e.target.value)} aria-label="Продукт">
          <option value="">Все продукты</option>
          {(products.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="muted">Каждое изменение остатка партии фиксируется отдельной записью.</span>
      </div>
      <LoadingBar active={q.loading} />
      <div className="tray">
        <Loadable q={q}>{(rows) => <MovementTable rows={rows} tz={tz} showProduct />}</Loadable>
      </div>
    </Workspace>
  );
}

// ───────────────────────── Предупреждения ─────────────────────────

export function AlertsScreen() {
  const [status, setStatus] = useState('open');
  const q = useQuery<Alert[]>(`/alerts?limit=500${status ? `&status=${status}` : ''}`);
  const { run, busy } = useAction();
  const { openProduct, navigate } = useUi();
  const tz = useTz();

  return (
    <Workspace
      sidebar={
        <div className="sidebar__scroll">
          <h3>Предупреждения</h3>
          {(
            [
              ['open', 'Открытые'],
              ['active', 'Новые'],
              ['acknowledged', 'Просмотренные'],
              ['resolved', 'Закрытые (история)'],
              ['', 'Все'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`side-btn ${status === k ? 'is-active' : ''}`} onClick={() => setStatus(k)}>
              <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
            </button>
          ))}
          <SectionNav />
        </div>
      }
    >
      <div className="toolbar">
        <span className="muted">Условные предупреждения закрываются автоматически, когда проблема устранена (поставка, списание, корректировка).</span>
        <span className="spacer" />
        <button className="btn" disabled={busy} onClick={() => run(() => api.post<{ acknowledged: number }>('/alerts/acknowledge', { ids: null }), (r) => `Принято: ${r.acknowledged}`)}>
          <Icon name="check" /> Принять все новые
        </button>
      </div>
      <LoadingBar active={q.loading} />
      <div className="tray">
        <Loadable q={q}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState icon="bell" title="Предупреждений нет" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th />
                      <th>Предупреждение</th>
                      <th>Создано</th>
                      <th>Статус</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((a) => (
                      <tr key={a.id} className={a.status === 'active' ? (a.severity === 'critical' ? 'row--expired' : a.severity === 'warning' ? 'row--soon' : '') : 'row--muted'}>
                        <td className={`risk__icon risk__icon--${a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info'}`} style={{ width: 36 }}>
                          <Icon name={ALERT_ICON[a.type] ?? 'alert'} />
                        </td>
                        <td>
                          <b>{a.title}</b>
                          <div style={{ fontSize: 12.5 }}>{a.message}</div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{dateShort(a.createdAt, tz)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <Tag kind={a.status === 'active' ? a.severity : a.status === 'resolved' ? 'ok' : 'info'}>
                            {a.status === 'active' ? 'Новое' : a.status === 'acknowledged' ? 'Просмотрено' : 'Закрыто'}
                          </Tag>
                          {a.resolvedAt && <div className="ink-muted" style={{ fontSize: 11.5 }}>{dateShort(a.resolvedAt, tz)}</div>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {a.productId && (
                            <button className="btn btn--sm" onClick={() => openProduct(a.productId)}>
                              Продукт
                            </button>
                          )}{' '}
                          {a.orderId && (
                            <button className="btn btn--sm" onClick={() => navigate('orders', a.orderId)}>
                              Заказ
                            </button>
                          )}{' '}
                          {a.status === 'active' && (
                            <button className="btn btn--sm btn--dark" disabled={busy} onClick={() => run(() => api.post('/alerts/acknowledge', { ids: [a.id] }), 'Принято')}>
                              Принять
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loadable>
      </div>
    </Workspace>
  );
}

// ───────────────────────── Блюда и рецептуры ─────────────────────────

export function DishesScreen() {
  const q = useQuery<Dish[]>('/dishes?includeInactive=true');
  const [editing, setEditing] = useState<Dish | 'new' | null>(null);
  const [search, setSearch] = useState('');

  return (
    <Workspace
      sidebar={
        <>
          <SearchBox value={search} onChange={setSearch} placeholder="Найти блюдо…" />
          <div className="sidebar__scroll">
            <button className="side-btn side-btn--nav" onClick={() => setEditing('new')}>
              <Icon name="plus" /> <span style={{ flex: 1 }}>Новое блюдо</span>
            </button>
            <SectionNav />
          </div>
        </>
      }
    >
      <div className="toolbar">
        <span className="section-title" style={{ margin: 0 }}>
          Нажмите на блюдо, чтобы изменить состав. Стоп-лист пересчитается сразу после сохранения.
        </span>
      </div>
      <LoadingBar active={q.loading} />
      <div className="tray">
        <Loadable q={q} skeleton={<LoadingGrid count={12} />}>
          {(list) => (
            <div className="grid">
              {list
                .filter((d) => matches(d, search))
                .map((d) => (
                  <div key={d.id} style={{ opacity: d.isActive ? 1 : 0.6 }}>
                    <DishCard d={d} onOpen={() => setEditing(d)} />
                  </div>
                ))}
            </div>
          )}
        </Loadable>
      </div>
      {editing && <DishEditor dish={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Workspace>
  );
}

function DishEditor({ dish, onClose }: { dish: Dish | null; onClose: () => void }) {
  const products = useQuery<Product[]>('/stock?sort=name');
  const [name, setName] = useState(dish?.name ?? '');
  const [description, setDescription] = useState(dish?.description ?? '');
  const [icon, setIcon] = useState(dish?.icon ?? '🍽️');
  const [category, setCategory] = useState(dish?.category ?? 'Горячее');
  const [active, setActive] = useState(dish?.isActive ?? true);
  const [rows, setRows] = useState<{ productId: number; qty: string }[]>(dish?.ingredients.map((i) => ({ productId: i.productId, qty: String(i.perServing) })) ?? []);
  const [error, setError] = useState<string | null>(null);
  const { run, busy } = useAction();
  const byId = new Map((products.data ?? []).map((p) => [p.id, p]));

  const save = async () => {
    if (!name.trim()) return setError('Укажите название.');
    if (rows.length === 0) return setError('Добавьте хотя бы один ингредиент.');
    const ingredients = rows.map((r) => ({ productId: r.productId, quantityPerServing: Number(r.qty.replace(',', '.')) }));
    if (ingredients.some((i) => !Number.isFinite(i.quantityPerServing) || i.quantityPerServing <= 0)) return setError('Норма на порцию должна быть больше нуля.');
    if (new Set(ingredients.map((i) => i.productId)).size !== ingredients.length) return setError('Продукт указан дважды.');
    const body = { name, description, icon, category, isActive: active, ingredients };
    const ok = dish ? await run(() => api.put(`/dishes/${dish.id}`, body), 'Рецептура сохранена, доступность пересчитана') : await run(() => api.post('/dishes', body), 'Блюдо добавлено в меню');
    if (ok) onClose();
  };

  return (
    <Modal
      title={dish ? `Рецептура: ${dish.name}` : 'Новое блюдо'}
      icon={icon}
      onClose={onClose}
      size="md"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn--blue" disabled={busy} onClick={save}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          Название
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <label className="field">
          Раздел меню
          <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
        </label>
        <label className="field">
          Иконка (эмодзи)
          <input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={8} />
        </label>
        <label className="check" style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> В меню
        </label>
      </div>
      <label className="field">
        Описание
        <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} />
      </label>
      <div className="sheet">
        <h3>Состав на одну порцию</h3>
        <div className="stack" style={{ gap: 6 }}>
          {rows.map((r, i) => {
            const p = byId.get(r.productId);
            return (
              <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                <select className="select" style={{ flex: 1, minWidth: 0 }} value={r.productId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, productId: Number(e.target.value) } : x)))} aria-label="Продукт">
                  {(products.data ?? []).map((p2) => (
                    <option key={p2.id} value={p2.id}>
                      {p2.name}
                    </option>
                  ))}
                </select>
                <input className="input" style={{ width: 90 }} value={r.qty} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} inputMode="decimal" aria-label="Количество на порцию" />
                <span style={{ width: 30 }}>{p ? unitLabel(p.unit) : ''}</span>
                <button className="btn btn--sm btn--red" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Убрать ингредиент">
                  <Icon name="trash" />
                </button>
              </div>
            );
          })}
          <button className="btn btn--sm" style={{ alignSelf: 'flex-start' }} disabled={!products.data?.length} onClick={() => setRows([...rows, { productId: products.data![0].id, qty: '0.1' }])}>
            <Icon name="plus" /> Ингредиент
          </button>
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  );
}

// ───────────────────────── Настройки ─────────────────────────

const ZONES = ['Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka', 'UTC'];

export function SettingsScreen() {
  const q = useQuery<Settings>('/settings');
  const [form, setForm] = useState<Settings | null>(null);
  const { run, busy } = useAction();
  const { confirm } = useUi();
  useEffect(() => {
    if (q.data && !form) setForm(q.data);
  }, [q.data, form]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const save = async () => {
    if (!form) return;
    const r = await run(() => api.put<Settings>('/settings', form), 'Настройки сохранены — статусы партий пересчитаны');
    if (r) setForm(r);
  };
  const reset = async () => {
    if (!(await confirm({ title: 'Сбросить демо-данные?', text: 'Все поставки, заказы, партии и журнал будут пересозданы из демонстрационного сценария.', danger: true, confirmLabel: 'Сбросить' }))) return;
    const r = await run(() => api.post('/demo/reset'), 'Демо-данные пересозданы');
    if (r) setForm(null);
  };

  return (
    <Workspace sidebar={<div className="sidebar__scroll"><SectionNav /></div>}>
      <div className="tray">
        {!form ? (
          <Loadable q={q}>{() => null}</Loadable>
        ) : (
          <div className="stack" style={{ maxWidth: 860 }}>
            <div className="sheet">
              <h3>Пороги сроков годности</h3>
              <div className="form-grid">
                <label className="field field--dark">
                  «Скоро истекает», часов до конца срока
                  <input className="input" type="number" min={2} max={720} value={form.soonHours} onChange={(e) => set('soonHours', Number(e.target.value))} />
                </label>
                <label className="field field--dark">
                  «Критический срок», часов
                  <input className="input" type="number" min={1} max={336} value={form.criticalHours} onChange={(e) => set('criticalHours', Number(e.target.value))} />
                </label>
                <label className="field field--dark">
                  Часовой пояс ресторана
                  <select className="select" value={form.timeZone} onChange={(e) => set('timeZone', e.target.value)}>
                    {[...new Set([form.timeZone, ...ZONES])].map((z) => (
                      <option key={z}>{z}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="ink-muted" style={{ margin: '8px 0 0' }}>
                Норма — больше {form.soonHours} ч; скоро истекает — {form.criticalHours}–{form.soonHours} ч; критический — до {form.criticalHours} ч; после окончания срока — просрочено (не используется для блюд).
              </p>
            </div>
            <div className="sheet">
              <h3>Списание и прогноз</h3>
              <div className="form-grid">
                <label className="check" style={{ color: 'var(--ink)' }}>
                  <input type="checkbox" checked={form.autoWriteOffExpired} onChange={(e) => set('autoWriteOffExpired', e.target.checked)} />
                  Автоматически списывать просрочку
                </label>
                <label className="field field--dark">
                  Окно расчёта среднего расхода, дней
                  <input className="input" type="number" min={1} max={90} value={form.forecastWindowDays} onChange={(e) => set('forecastWindowDays', Number(e.target.value))} />
                </label>
                <label className="field field--dark">
                  Поставка должна покрывать, дней
                  <input className="input" type="number" min={1} max={30} value={form.supplyCoverDays} onChange={(e) => set('supplyCoverDays', Number(e.target.value))} />
                </label>
              </div>
            </div>
            <div className="sheet">
              <h3>Генератор событий (эмуляция поставок и заказов)</h3>
              <div className="form-grid">
                <label className="check" style={{ color: 'var(--ink)' }}>
                  <input type="checkbox" checked={form.generatorEnabled} onChange={(e) => set('generatorEnabled', e.target.checked)} />
                  Включить генератор
                </label>
                <label className="field field--dark">
                  Интервал, секунд
                  <input className="input" type="number" min={5} max={3600} value={form.generatorIntervalSeconds} onChange={(e) => set('generatorIntervalSeconds', Number(e.target.value))} />
                </label>
              </div>
              <p className="ink-muted" style={{ margin: '8px 0 0' }}>
                Генератор создаёт настоящие заказы и поставки через API — так же, как касса и приёмка. Каждое шестое событие — поставка по рекомендациям.
              </p>
            </div>
            <div className="row">
              <button className="btn btn--blue btn--lg" disabled={busy} onClick={save}>
                Сохранить настройки
              </button>
              <span className="spacer" />
              <span className="muted">Хранилище: {form.mode === 'postgres' ? 'PostgreSQL (производственный режим)' : 'SQLite (демонстрационный режим)'}</span>
              <button className="btn btn--red" disabled={busy} onClick={reset}>
                <Icon name="refresh" /> Сбросить демо-данные
              </button>
            </div>
          </div>
        )}
      </div>
    </Workspace>
  );
}

