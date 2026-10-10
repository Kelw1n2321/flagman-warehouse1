import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Product, Recommendation, Supply } from '../api/types';
import { ControlPanel } from '../components/ControlPanel';
import { Icon } from '../components/Icon';
import { SearchBox, SectionNav, Workspace } from '../components/Shell';
import { Emoji, EmptyState, ErrorState, Loadable, LoadingBar, Modal, Tag } from '../components/ui';
import { compact, dateShort, EXPIRY_LABEL, hoursLeft, humanDate, qty, relative, toLocalInput, unitLabel } from '../lib/format';
import { useAction, useLive, useNow, useQuery, useTz, useUi, type SupplyDraftLine } from '../state/store';
import { matches } from './StockScreen';

const STATUS_LABEL = { draft: 'Ожидается', received: 'Принята', cancelled: 'Отменена' } as const;

export function SuppliesScreen() {
  const { route, navigate } = useUi();
  const mode = route.param === 'new' ? 'new' : route.param === 'recommendations' ? 'recommendations' : 'list';
  const detailId = mode === 'list' ? route.param : null;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const { summary } = useLive();

  return (
    <Workspace
      rightLabel={mode === 'new' ? 'Состав поставки' : 'Контроль'}
      rightCount={mode === 'new' ? undefined : summary?.activeAlerts}
      sidebar={
        <>
          <SearchBox value={search} onChange={setSearch} placeholder={mode === 'new' ? 'Найти продукт…' : 'Номер, поставщик, продукт…'} />
          <div className="sidebar__scroll">
            <h3>Поставки</h3>
            <button className={`side-btn side-btn--nav ${mode === 'list' ? 'is-active' : ''}`} onClick={() => navigate('supplies')}>
              <Icon name="list" /> <span style={{ flex: 1 }}>Список поставок</span>
            </button>
            <button className={`side-btn side-btn--nav ${mode === 'new' ? 'is-active' : ''}`} onClick={() => navigate('supplies', 'new')}>
              <Icon name="plus" /> <span style={{ flex: 1 }}>Новая поставка</span>
            </button>
            <button className={`side-btn side-btn--nav ${mode === 'recommendations' ? 'is-active' : ''}`} onClick={() => navigate('supplies', 'recommendations')}>
              <Icon name="inbox" /> <span style={{ flex: 1 }}>Что заказать</span>
            </button>
            {mode === 'list' && (
              <>
                <h3>Статус</h3>
                {(
                  [
                    ['', 'Все'],
                    ['draft', 'Ожидаются'],
                    ['received', 'Приняты'],
                    ['cancelled', 'Отменены'],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} className={`side-btn ${status === k ? 'is-active' : ''}`} onClick={() => setStatus(k)} aria-pressed={status === k}>
                    <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
                  </button>
                ))}
              </>
            )}
            <SectionNav />
          </div>
        </>
      }
      right={mode === 'new' ? <SupplyComposer /> : <ControlPanel />}
    >
      {mode === 'list' && <SupplyList search={search} status={status} />}
      {mode === 'new' && <ProductPicker search={search} />}
      {mode === 'recommendations' && <Recommendations />}
      {detailId && <SupplyDetail id={detailId} onClose={() => navigate('supplies')} />}
    </Workspace>
  );
}

function SupplyList({ search, status }: { search: string; status: string }) {
  const q = useQuery<Supply[]>('/supplies');
  const { navigate } = useUi();
  const tz = useTz();
  const now = useNow();
  return (
    <>
      <div className="toolbar">
        <span className="section-title" style={{ margin: 0 }}>
          Журнал поставок
        </span>
        <span className="spacer" />
        <button className="btn btn--green" onClick={() => navigate('supplies', 'new')}>
          <Icon name="plus" /> Зарегистрировать поставку
        </button>
      </div>
      <LoadingBar active={q.loading} />
      <div className="tray">
        <Loadable q={q}>
          {(all) => {
            const list = all.filter(
              (s) =>
                (!status || s.status === status) &&
                (!search.trim() ||
                  [s.supplyNumber, s.supplier, ...s.productNames].some((x) => x.toLowerCase().includes(search.trim().toLowerCase()))),
            );
            if (list.length === 0) return <EmptyState icon="🚚" title="Поставок не найдено" text="Измените поиск или фильтр статуса." />;
            return (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Номер</th>
                      <th>Поставщик</th>
                      <th>Создана</th>
                      <th>Принята</th>
                      <th className="num">Партий</th>
                      <th>Продукты</th>
                      <th>Ближ. срок</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.id} className="is-clickable" onClick={() => navigate('supplies', s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate('supplies', s.id)}>
                        <td>
                          <b>{s.supplyNumber}</b>
                        </td>
                        <td>{s.supplier}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{dateShort(s.createdAt, tz)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{s.receivedAt ? dateShort(s.receivedAt, tz) : '—'}</td>
                        <td className="num">{s.lineCount}</td>
                        <td style={{ maxWidth: 280 }}>{s.productNames.join(', ')}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{s.earliestExpiry ? humanDate(s.earliestExpiry, tz, now) : '—'}</td>
                        <td>
                          <Tag kind={s.status}>{STATUS_LABEL[s.status]}</Tag>
                        </td>
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

function SupplyDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery<Supply>(`/supplies/${id}`);
  const { run, busy } = useAction();
  const { confirm, openProduct } = useUi();
  const tz = useTz();
  const s = q.data;

  const receive = async () => {
    if (!s) return;
    if (!(await confirm({ title: `Принять поставку ${s.supplyNumber}?`, text: `Будет зарегистрировано партий: ${s.lineCount}. Остатки, доступность блюд и стоп-лист пересчитаются.`, confirmLabel: 'Принять' }))) return;
    await run(() => api.post(`/supplies/${s.id}/receive`), 'Поставка принята, партии зарегистрированы');
  };
  const cancel = async () => {
    if (!s) return;
    if (!(await confirm({ title: 'Отменить поставку?', text: 'Поставка не будет принята на склад.', danger: true, confirmLabel: 'Отменить поставку' }))) return;
    await run(() => api.post(`/supplies/${s.id}/cancel`), 'Поставка отменена');
  };

  return (
    <Modal
      title={s ? `Поставка ${s.supplyNumber}` : 'Поставка'}
      icon="🚚"
      onClose={onClose}
      footer={
        s?.status === 'draft' && (
          <>
            <button className="btn btn--red" disabled={busy} onClick={cancel}>
              Отменить
            </button>
            <button className="btn btn--green btn--lg" disabled={busy} onClick={receive}>
              Принять на склад
            </button>
          </>
        )
      }
    >
      <Loadable q={q} dark>
        {(d) => (
          <>
            <div className="sheet">
              <dl className="kv">
                <dt>Идентификатор</dt>
                <dd style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.id}</dd>
                <dt>Номер</dt>
                <dd>{d.supplyNumber}</dd>
                <dt>Поставщик</dt>
                <dd>{d.supplier}</dd>
                <dt>Создана</dt>
                <dd>{dateShort(d.createdAt, tz)}</dd>
                <dt>Принята</dt>
                <dd>{d.receivedAt ? dateShort(d.receivedAt, tz) : '—'}</dd>
                <dt>Статус</dt>
                <dd>
                  <Tag kind={d.status}>{STATUS_LABEL[d.status]}</Tag>
                </dd>
                {d.note && (
                  <>
                    <dt>Комментарий</dt>
                    <dd>{d.note}</dd>
                  </>
                )}
              </dl>
            </div>
            <div className="sheet table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Продукт</th>
                    <th className="num">Количество</th>
                    <th>Годен до</th>
                    <th>Осталось хранить</th>
                    <th>Партия</th>
                    <th className="num">Остаток партии</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.lines ?? []).map((l) => (
                    <tr key={l.id} className={`is-clickable row--${l.batch && l.batch.state !== 'active' ? 'muted' : l.expiry}`} onClick={() => openProduct(l.productId)}>
                      <td>
                        <span className="emoji">{l.icon}</span> {l.productName}
                      </td>
                      <td className="num">{qty(l.quantity, l.unit)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{dateShort(l.expiresAt, tz)}</td>
                      <td>
                        <Tag kind={l.expiry}>{EXPIRY_LABEL[l.expiry]}</Tag> {relative(l.hoursLeft)}
                      </td>
                      <td>{l.batch?.code ?? <span className="ink-muted">после приёмки</span>}</td>
                      <td className="num">{l.batch ? qty(l.batch.quantityRemaining, l.unit) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Loadable>
    </Modal>
  );
}

// ───────── Создание поставки ─────────

interface DraftLine {
  key: number;
  productId: number;
  quantity: string;
  expiresLocal: string;
}

let lineSeq = 1;

/** Общий черновик поставки между сеткой продуктов и правой панелью. */
const draftStore = {
  lines: [] as DraftLine[],
  listeners: new Set<() => void>(),
  set(lines: DraftLine[]) {
    this.lines = lines;
    this.listeners.forEach((l) => l());
  },
};

function useDraft(): [DraftLine[], (lines: DraftLine[]) => void] {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    draftStore.listeners.add(l);
    return () => void draftStore.listeners.delete(l);
  }, []);
  return [draftStore.lines, (lines) => draftStore.set(lines)];
}

function defaultExpiry(p: Product | undefined, shelf: number | null | undefined, tz: string): string {
  const hours = shelf ?? p?.defaultShelfLifeHours ?? 72;
  return toLocalInput(new Date(Date.now() + hours * 3_600_000), tz);
}

function ProductPicker({ search }: { search: string }) {
  const q = useQuery<Product[]>('/stock?sort=name');
  const [lines, setLines] = useDraft();
  const { supplyDraft, clearSupplyDraft } = useUi();
  const tz = useTz();

  // Предзаполнение из рекомендаций / карточки продукта.
  useEffect(() => {
    if (!supplyDraft || !q.data) return;
    const products = q.data;
    setLines(
      supplyDraft.map((d: SupplyDraftLine) => ({
        key: lineSeq++,
        productId: d.productId,
        quantity: String(d.quantity),
        expiresLocal: defaultExpiry(products.find((p) => p.id === d.productId), d.shelfLifeHours, tz),
      })),
    );
    clearSupplyDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplyDraft, q.data]);

  const add = (p: Product) =>
    setLines([...lines, { key: lineSeq++, productId: p.id, quantity: p.unit === 'pcs' ? '30' : '1', expiresLocal: defaultExpiry(p, null, tz) }]);

  return (
    <>
      <div className="toolbar">
        <span className="section-title" style={{ margin: 0 }}>
          Нажмите «+», чтобы добавить партию в поставку
        </span>
        <span className="spacer" />
        <div className="legend">
          <span>
            <i className="sq sq--green" /> Доступно сейчас
          </span>
          <span>
            <i className="sq sq--gray" /> Строк в поставке
          </span>
        </div>
      </div>
      <div className="tray">
        <Loadable q={q}>
          {(all) => {
            const list = all.filter((p) => matches(p, search));
            if (list.length === 0) return <EmptyState icon="🔍" title="Продукт не найден" />;
            return (
              <div className="grid">
                {list.map((p) => {
                  const inDraft = lines.filter((l) => l.productId === p.id).length;
                  return (
                    <div key={p.id} className="card" style={{ cursor: 'default', minHeight: 104 }}>
                      <span className="card__counters">
                        <span className={`counter counter--green ${p.available ? '' : 'is-zero'}`} title={`Доступно: ${qty(p.available, p.unit)}`}>
                          {compact(p.available)}
                        </span>
                        <span className={`counter counter--gray ${inDraft ? '' : 'is-zero'}`} title="Строк этого продукта в поставке">
                          {inDraft}
                        </span>
                      </span>
                      <span className="card__thumb" style={{ minHeight: 86 }}>
                        <Emoji>{p.icon}</Emoji>
                      </span>
                      <span className="card__body">
                        <span className="card__name">{p.name}</span>
                        <span className="card__sub">{p.category}</span>
                        <span className="card__line">Мин. остаток: {qty(p.minStock, p.unit)}</span>
                        <span className="card__line">Срок хранения: {p.defaultShelfLifeHours ? hoursLeft(p.defaultShelfLifeHours) : '—'}</span>
                        <span className="card__foot">
                          <span className="card__big" style={{ fontSize: 20 }}>
                            {unitLabel(p.unit)}
                          </span>
                          <button className="open-btn" onClick={() => add(p)} aria-label={`Добавить ${p.name} в поставку`} title="Добавить партию">
                            <Icon name="plus" />
                          </button>
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          }}
        </Loadable>
      </div>
    </>
  );
}

function SupplyComposer() {
  const products = useQuery<Product[]>('/stock?sort=name');
  const [lines, setLines] = useDraft();
  const [supplier, setSupplier] = useState('');
  const [number, setNumber] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const { run, busy } = useAction();
  const { navigate, toast } = useUi();
  const tz = useTz();
  const now = useNow();
  const byId = new Map((products.data ?? []).map((p) => [p.id, p]));
  const nowLocal = toLocalInput(now, tz);

  const update = (key: number, patch: Partial<DraftLine>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const validate = (): string | null => {
    if (lines.length === 0) return 'Добавьте хотя бы один продукт.';
    for (const l of lines) {
      const p = byId.get(l.productId);
      const v = Number(l.quantity.replace(',', '.'));
      if (!Number.isFinite(v) || v <= 0) return `${p?.name}: количество должно быть больше нуля.`;
      if (p?.unit === 'pcs' && !Number.isInteger(v)) return `${p.name}: штучный продукт — целое число.`;
      if (!l.expiresLocal) return `${p?.name}: укажите срок годности.`;
      if (l.expiresLocal <= nowLocal) return `${p?.name}: срок годности уже истёк.`;
    }
    return null;
  };

  const submit = async (receiveNow: boolean) => {
    const problem = validate();
    if (problem) return toast(problem, 'error');
    setErrors({});
    try {
      const created = await run(async () => {
        try {
          return await api.post<Supply>('/supplies', {
            supplyNumber: number.trim() || null,
            supplier: supplier.trim() || null,
            receiveNow,
            lines: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity.replace(',', '.')), expiresAtLocal: l.expiresLocal })),
          });
        } catch (e) {
          if (e instanceof ApiError) setErrors(e.fieldErrors);
          throw e;
        }
      }, receiveNow ? 'Поставка принята: партии зарегистрированы, остатки обновлены' : 'Черновик поставки сохранён');
      if (created) {
        setLines([]);
        setNumber('');
        navigate('supplies', created.id);
      }
    } catch {
      /* сообщение уже показано */
    }
  };

  return (
    <>
      <div className="rightbar__title">
        <h2>Поставка</h2>
        <span className="tag tag--info">{lines.length} парт.</span>
      </div>
      <div className="rightbar__body">
        <label className="field">
          Поставщик
          <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="ООО «…»" maxLength={120} />
        </label>
        <label className="field">
          Номер поставки <span className="hint">пусто — присвоится автоматически</span>
          <input className="input" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="ПСТ-…" maxLength={40} />
        </label>
        {lines.length === 0 && <EmptyState dark icon="🧺" title="Поставка пуста" text="Добавьте продукты кнопкой «+» в каталоге. Один продукт можно добавить несколько раз — с разными сроками годности." />}
        {lines.map((l, i) => {
          const p = byId.get(l.productId);
          const hrs = l.expiresLocal ? (Date.parse(l.expiresLocal + 'Z') - Date.parse(nowLocal + 'Z')) / 3_600_000 : NaN;
          const err = Object.entries(errors).find(([k]) => k.startsWith(`lines[${i}]`))?.[1]?.[0];
          return (
            <div key={l.key} className="risk risk--info" style={{ padding: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <b>
                  <span className="emoji">{p?.icon}</span> {p?.name ?? '…'}
                </b>
                <button className="btn btn--sm btn--red" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label="Убрать строку">
                  <Icon name="trash" />
                </button>
              </div>
              <div className="row" style={{ marginTop: 6, flexWrap: 'nowrap' }}>
                <label className="field" style={{ width: 96 }}>
                  Кол-во, {p ? unitLabel(p.unit) : ''}
                  <input className="input" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} inputMode="decimal" />
                </label>
                <label className="field" style={{ flex: 1, minWidth: 0 }}>
                  Годен до
                  <input className="input" type="datetime-local" value={l.expiresLocal} min={nowLocal} onChange={(e) => update(l.key, { expiresLocal: e.target.value })} />
                </label>
              </div>
              <div className="risk__meta" style={{ marginTop: 4 }}>
                {Number.isFinite(hrs) ? (hrs > 0 ? `Срок хранения партии: ${hoursLeft(hrs)}` : 'Срок уже истёк — партию нельзя принять') : ''}
              </div>
              {err && <div className="error-text">{err}</div>}
            </div>
          );
        })}
      </div>
      <div className="rightbar__foot" style={{ flexWrap: 'wrap' }}>
        <button className="btn" disabled={busy || lines.length === 0} onClick={() => submit(false)}>
          Черновик
        </button>
        <button className="btn btn--lg btn--green" disabled={busy || lines.length === 0} onClick={() => submit(true)}>
          Принять
        </button>
      </div>
    </>
  );
}

function Recommendations() {
  const q = useQuery<Recommendation[]>('/supplies/recommendations');
  const { startSupply, openProduct } = useUi();
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const { summary } = useLive();

  return (
    <>
      <div className="toolbar">
        <span className="section-title" style={{ margin: 0 }}>
          Анализ и предложение поставок на {summary?.settings.supplyCoverDays ?? 3} дн.
        </span>
        <span className="spacer" />
        {q.data && q.data.length > 0 && (
          <button
            className="btn btn--green"
            onClick={() => {
              const sel = q.data!.filter((r) => (picked ?? new Set(q.data!.map((x) => x.productId))).has(r.productId));
              startSupply(sel.map((r) => ({ productId: r.productId, quantity: r.recommendedQuantity, shelfLifeHours: r.defaultShelfLifeHours })));
            }}
          >
            <Icon name="truck" /> Оформить поставку из выбранных
          </button>
        )}
      </div>
      <LoadingBar active={q.loading} />
      <div className="tray">
        {q.error && !q.data ? (
          <ErrorState text={q.error} onRetry={q.reload} />
        ) : (
          <Loadable q={q}>
            {(list) => {
              if (list.length === 0) return <EmptyState icon="✅" title="Пополнение не требуется" text="Запасов хватает на расчётный период с учётом сроков годности." />;
              const sel = picked ?? new Set(list.map((r) => r.productId));
              return (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>
                          <span className="sr-only">Выбрать</span>
                        </th>
                        <th>Продукт</th>
                        <th>Срочность</th>
                        <th className="num">Доступно</th>
                        <th className="num">Расход/сут</th>
                        <th className="num">Хватит на</th>
                        <th className="num">Рекомендуется</th>
                        <th>Почему</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => (
                        <tr key={r.productId}>
                          <td>
                            <input
                              type="checkbox"
                              checked={sel.has(r.productId)}
                              aria-label={`Включить ${r.name}`}
                              onChange={(e) => {
                                const next = new Set(sel);
                                if (e.target.checked) next.add(r.productId);
                                else next.delete(r.productId);
                                setPicked(next);
                              }}
                            />
                          </td>
                          <td>
                            <button className="btn btn--sm" onClick={() => openProduct(r.productId)}>
                              <span className="emoji">{r.icon}</span> {r.name}
                            </button>
                          </td>
                          <td>
                            <Tag kind={r.urgency === 'critical' ? 'critical' : r.urgency === 'high' ? 'warning' : 'info'}>
                              {r.urgency === 'critical' ? 'Срочно' : r.urgency === 'high' ? 'Высокая' : 'Плановая'}
                            </Tag>
                          </td>
                          <td className="num">{qty(r.available, r.unit)}</td>
                          <td className="num">{r.dailyUsage ? qty(r.dailyUsage, r.unit) : '—'}</td>
                          <td className="num">{r.daysOfCover !== null ? `${r.daysOfCover.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} сут` : '—'}</td>
                          <td className="num">
                            <b>{qty(r.recommendedQuantity, r.unit, { small: false })}</b>
                          </td>
                          <td style={{ fontSize: 12.5, maxWidth: 360 }}>{r.reasons.join(' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }}
          </Loadable>
        )}
      </div>
    </>
  );
}
