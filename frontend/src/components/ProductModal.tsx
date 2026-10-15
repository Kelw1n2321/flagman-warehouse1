import { useState } from 'react';
import { api } from '../api/client';
import type { Batch, Movement, ProductDetail, Unit } from '../api/types';
import { dateShort, EXPIRY_LABEL, humanDate, qty, relative, RISK_LABEL, riskTier, TIER_LABEL, unitLabel } from '../lib/format';
import { useAction, useNow, useQuery, useTz, useUi } from '../state/store';
import { LineChart } from './Charts';
import { Icon } from './Icon';
import { EmptyState, Loadable, Modal, Tag } from './ui';

type Tab = 'batches' | 'history' | 'supplies' | 'dishes' | 'forecast';

export const MOVEMENT_LABEL: Record<Movement['type'], string> = {
  receipt: 'Приёмка',
  consumption: 'Списание на заказ',
  expiredWriteOff: 'Списание просрочки',
  spoilageWriteOff: 'Списание (порча)',
  adjustmentPlus: 'Корректировка +',
  adjustmentMinus: 'Корректировка −',
  restore: 'Возврат из корзины',
};

export function ProductModalHost() {
  const { productId, openProduct } = useUi();
  if (productId === null) return null;
  return <ProductModal id={productId} onClose={() => openProduct(null)} />;
}

function ProductModal({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useQuery<ProductDetail>(`/products/${id}`);
  const [tab, setTab] = useState<Tab>('batches');
  const [editing, setEditing] = useState<{ batch: Batch; mode: 'adjust' | 'writeoff' } | null>(null);
  const { startSupply, navigate } = useUi();
  const tz = useTz();
  const now = useNow();
  const p = q.data?.product;

  return (
    <Modal
      title={p ? p.name : 'Продукт'}
      onClose={onClose}
      footer={
        p && (
          <>
            <button className="btn" onClick={() => (onClose(), navigate('journal', String(p.id)))}>
              <Icon name="list" /> Журнал
            </button>
            <button
              className="btn btn--green"
              onClick={() => startSupply([{ productId: p.id, quantity: Math.max(p.minStock * 2 - p.available, p.minStock || 1), shelfLifeHours: p.defaultShelfLifeHours }])}
            >
              <Icon name="truck" /> Оформить поставку
            </button>
          </>
        )
      }
    >
      <Loadable q={q} dark>
        {(d) => {
          const tier = riskTier(d.product.risk, d.product.blockedDishes.length > 0);
          const active = d.batches.filter((b) => b.state === 'active');
          return (
            <>
              <div className="sheet">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <dl className="kv">
                    <dt>Артикул</dt>
                    <dd>
                      {d.product.sku} · {d.product.category}
                    </dd>
                    <dt>Доступно</dt>
                    <dd>
                      <b style={{ fontSize: 18 }}>{qty(d.product.available, d.product.unit, { small: false })}</b>
                      {d.product.expired > 0 && <span className="ink-muted"> · ещё {qty(d.product.expired, d.product.unit)} просрочено (не используется)</span>}
                    </dd>
                    <dt>Партий</dt>
                    <dd>{d.product.batchCount}</dd>
                    <dt>Истекает</dt>
                    <dd>
                      {d.product.expiringCritical > 0 && <Tag kind="critical">≤24 ч: {qty(d.product.expiringCritical, d.product.unit)}</Tag>}{' '}
                      {d.product.expiringSoon > 0 && <Tag kind="soon">скоро: {qty(d.product.expiringSoon, d.product.unit)}</Tag>}
                      {d.product.expiringCritical + d.product.expiringSoon === 0 && 'нет'}
                    </dd>
                    <dt>Ближ. срок</dt>
                    <dd>{d.product.earliestExpiry ? `${humanDate(d.product.earliestExpiry, tz, now)}` : '—'}</dd>
                    <dt>Минимум</dt>
                    <dd>
                      <MinStockEditor id={d.product.id} value={d.product.minStock} unit={d.product.unit} />
                    </dd>
                  </dl>
                  <div style={{ textAlign: 'right' }}>
                    <Tag kind={tier === 'ok' ? 'ok' : tier}>{TIER_LABEL[tier]}</Tag>
                    <div className="ink-muted" style={{ marginTop: 6 }}>
                      {RISK_LABEL[d.product.risk]}
                    </div>
                    {d.product.blockedDishes.length > 0 && <div style={{ marginTop: 6, color: 'var(--crit)', fontWeight: 700 }}>Стоп-лист: {d.product.blockedDishes.join(', ')}</div>}
                  </div>
                </div>
              </div>

              <div className="tabs" role="tablist">
                {(
                  [
                    ['batches', `Партии (${active.length})`],
                    ['history', 'История движения'],
                    ['supplies', 'Поставки'],
                    ['dishes', `Блюда (${d.dishes.length})`],
                    ['forecast', 'Прогноз'],
                  ] as [Tab, string][]
                ).map(([t, label]) => (
                  <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-active' : ''} onClick={() => setTab(t)}>
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'batches' && (
                <div className="sheet table-wrap">
                  {d.batches.length === 0 ? (
                    <EmptyState title="Партий нет" text="Продукт ещё не поступал на склад." />
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>FEFO</th>
                          <th>Партия</th>
                          <th>Поставка</th>
                          <th>Принята</th>
                          <th>Годен до</th>
                          <th>Осталось</th>
                          <th className="num">Остаток</th>
                          <th>Статус</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {d.batches.map((b) => (
                          <tr key={b.id} className={b.state !== 'active' ? 'row--muted' : `row--${b.expiry}`}>
                            <td className="pill-num">{b.fefoRank ? `№${b.fefoRank}` : '—'}</td>
                            <td>{b.code}</td>
                            <td>{b.supplyNumber}</td>
                            <td>{dateShort(b.receivedAt, tz)}</td>
                            <td>{dateShort(b.expiresAt, tz)}</td>
                            <td>{b.state === 'active' ? relative(b.hoursLeft) : '—'}</td>
                            <td className="num">
                              <b>{qty(b.quantityRemaining, b.unit)}</b>
                              <span className="ink-muted"> / {qty(b.quantityReceived, b.unit)}</span>
                            </td>
                            <td>
                              {b.state === 'active' ? (
                                <Tag kind={b.expiry}>{EXPIRY_LABEL[b.expiry]}</Tag>
                              ) : (
                                <Tag kind={b.state}>{b.state === 'depleted' ? 'Израсходована' : 'Списана'}</Tag>
                              )}
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {b.state === 'active' && (
                                <>
                                  <button className="btn btn--sm" onClick={() => setEditing({ batch: b, mode: 'adjust' })} title="Корректировка остатка">
                                    <Icon name="edit" />
                                  </button>{' '}
                                  <button className="btn btn--sm btn--red" onClick={() => setEditing({ batch: b, mode: 'writeoff' })} title="Списать">
                                    <Icon name="trash" />
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {tab === 'history' && <MovementTable rows={d.movements} tz={tz} />}

              {tab === 'supplies' && (
                <div className="sheet table-wrap">
                  {d.supplies.length === 0 ? (
                    <EmptyState title="Поставок нет" />
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Номер</th>
                          <th>Поставщик</th>
                          <th>Создана</th>
                          <th>Статус</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.supplies.map((s) => (
                          <tr key={s.id} className="is-clickable" onClick={() => (onClose(), navigate('supplies', s.id))}>
                            <td>
                              <b>{s.supplyNumber}</b>
                            </td>
                            <td>{s.supplier}</td>
                            <td>{dateShort(s.createdAt, tz)}</td>
                            <td>
                              <Tag kind={s.status}>{s.status === 'received' ? 'Принята' : s.status === 'draft' ? 'Ожидается' : 'Отменена'}</Tag>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {tab === 'dishes' && (
                <div className="sheet table-wrap">
                  {d.dishes.length === 0 ? (
                    <EmptyState title="Не используется в блюдах" />
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Блюдо</th>
                          <th className="num">На порцию</th>
                          <th className="num">Доступно порций</th>
                          <th>Статус</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.dishes.map((x) => (
                          <tr key={x.dishId}>
                            <td>
                              {x.name}
                            </td>
                            <td className="num">{qty(x.perServing, d.product.unit)}</td>
                            <td className="num">{x.maxServings}</td>
                            <td>{x.available ? <Tag kind="ok">Доступно</Tag> : <Tag kind="critical">Стоп-лист</Tag>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {tab === 'forecast' && (
                <div className="sheet">
                  {d.forecast.hasData ? (
                    <>
                      <p style={{ margin: '0 0 8px' }}>
                        Средний расход: <b>{qty(d.forecast.dailyUsage, d.product.unit)}/сут</b>. Пригодный остаток закончится{' '}
                        <b>{d.forecast.depletionAt ? humanDate(d.forecast.depletionAt, tz, now) : 'не в ближайшие 7 дней'}</b>
                        {d.forecast.hoursToDepletion !== null && ` (${relative(d.forecast.hoursToDepletion)})`}.
                        {d.forecast.expectedLoss > 0 && (
                          <>
                            {' '}
                            Ожидаемые потери по сроку: <b style={{ color: 'var(--crit)' }}>{qty(d.forecast.expectedLoss, d.product.unit)}</b>.
                          </>
                        )}
                      </p>
                      <LineChart
                        ariaLabel="Прогноз пригодного остатка на 7 дней"
                        points={d.forecast.series.map((pt) => ({ label: dateShort(pt.at, tz).slice(0, 5), value: pt.usable }))}
                        format={(v) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${unitLabel(d.product.unit)}`}
                        threshold={d.product.minStock}
                        thresholdLabel="минимум"
                      />
                    </>
                  ) : (
                    <EmptyState icon="chart" title="Недостаточно данных" text="Прогноз появится после первых списаний на заказы." />
                  )}
                </div>
              )}

              {editing && <BatchEditDialog batch={editing.batch} mode={editing.mode} onClose={() => setEditing(null)} />}
            </>
          );
        }}
      </Loadable>
    </Modal>
  );
}

function MinStockEditor({ id, value, unit }: { id: number; value: number; unit: Unit }) {
  const [draft, setDraft] = useState<string | null>(null);
  const { run, busy } = useAction();
  if (draft === null)
    return (
      <span className="row" style={{ gap: 6 }}>
        {qty(value, unit, { small: false })}
        <button className="btn btn--sm" onClick={() => setDraft(String(value))} aria-label="Изменить минимальный остаток">
          <Icon name="edit" />
        </button>
      </span>
    );
  const save = async () => {
    const v = Number(draft.replace(',', '.'));
    if (!Number.isFinite(v) || v < 0) return;
    const ok = await run(() => api.patch(`/products/${id}/min-stock`, { minStock: v }), 'Минимальный остаток обновлён');
    if (ok) setDraft(null);
  };
  return (
    <span className="row" style={{ gap: 6 }}>
      <input className="input" style={{ width: 90 }} value={draft} onChange={(e) => setDraft(e.target.value)} inputMode="decimal" aria-label="Минимальный остаток" />
      {unitLabel(unit)}
      <button className="btn btn--sm btn--blue" disabled={busy} onClick={save}>
        OK
      </button>
      <button className="btn btn--sm" onClick={() => setDraft(null)}>
        Отмена
      </button>
    </span>
  );
}

export function MovementTable({ rows, tz, showProduct }: { rows: Movement[]; tz: string; showProduct?: boolean }) {
  const { navigate, openProduct } = useUi();
  if (rows.length === 0)
    return (
      <div className="sheet">
        <EmptyState title="Движений нет" />
      </div>
    );
  return (
    <div className="sheet table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Время</th>
            {showProduct && <th>Продукт</th>}
            <th>Операция</th>
            <th>Партия</th>
            <th className="num">Количество</th>
            <th className="num">Остаток партии</th>
            <th>Основание</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{dateShort(m.createdAt, tz)}</td>
              {showProduct && (
                <td>
                  <button className="btn btn--sm" onClick={() => openProduct(m.productId)}>
                    {m.productName}
                  </button>
                </td>
              )}
              <td>
                <Tag kind={m.quantity > 0 ? 'ok' : m.type === 'consumption' ? 'info' : 'critical'}>{MOVEMENT_LABEL[m.type]}</Tag>
              </td>
              <td>{m.batchCode ?? '—'}</td>
              <td className="num" style={{ color: m.quantity > 0 ? 'var(--ok)' : 'var(--crit)', fontWeight: 700 }}>
                {m.quantity > 0 ? '+' : '−'}
                {qty(Math.abs(m.quantity), m.unit)}
              </td>
              <td className="num">{qty(m.batchBalanceAfter, m.unit)}</td>
              <td>
                {m.orderNumber ? (
                  <button className="btn btn--sm" onClick={() => navigate('orders', m.orderId)}>
                    {m.orderNumber}
                  </button>
                ) : m.supplyNumber ? (
                  <button className="btn btn--sm" onClick={() => navigate('supplies', m.supplyId)}>
                    {m.supplyNumber}
                  </button>
                ) : (
                  m.reason
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BatchEditDialog({ batch, mode, onClose }: { batch: Batch; mode: 'adjust' | 'writeoff'; onClose: () => void }) {
  const [quantity, setQuantity] = useState(String(mode === 'adjust' ? batch.quantityRemaining : batch.quantityRemaining));
  const [reason, setReason] = useState(mode === 'adjust' ? 'Инвентаризация' : batch.expiry === 'expired' ? 'Списание просрочки' : 'Порча');
  const [error, setError] = useState<string | null>(null);
  const { run, busy } = useAction();
  const u = unitLabel(batch.unit);

  const submit = async () => {
    const v = Number(quantity.replace(',', '.'));
    if (!Number.isFinite(v) || v < 0) return setError('Введите неотрицательное число.');
    if (batch.unit === 'pcs' && !Number.isInteger(v)) return setError('Штучный продукт — только целые числа.');
    if (mode === 'writeoff' && (v <= 0 || v > batch.quantityRemaining)) return setError(`Списать можно от 0 до ${batch.quantityRemaining} ${u}.`);
    if (!reason.trim()) return setError('Укажите причину.');
    const ok =
      mode === 'adjust'
        ? await run(() => api.post(`/batches/${batch.id}/adjust`, { quantity: v, reason }), 'Остаток партии скорректирован')
        : await run(() => api.post(`/batches/${batch.id}/write-off`, { quantity: v, reason }), 'Списано в корзину, вернуть можно в разделе «Корзина»');
    if (ok) onClose();
  };

  return (
    <Modal
      size="sm"
      title={mode === 'adjust' ? 'Корректировка партии' : 'Списание партии'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className={`btn ${mode === 'adjust' ? 'btn--blue' : 'btn--red'}`} disabled={busy} onClick={submit}>
            {mode === 'adjust' ? 'Сохранить' : 'Списать'}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        {batch.productName}, партия <b>{batch.code}</b>. Сейчас: <b>{qty(batch.quantityRemaining, batch.unit)}</b>
      </p>
      <label className="field">
        {mode === 'adjust' ? `Фактический остаток, ${u}` : `Количество к списанию, ${u}`}
        <input className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" autoFocus />
      </label>
      <label className="field">
        Причина
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
      </label>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  );
}
