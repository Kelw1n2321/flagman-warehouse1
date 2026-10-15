import { useState } from 'react';
import { api } from '../api/client';
import type { Dish, HotOffer, HotOffers } from '../api/types';
import { Icon } from '../components/Icon';
import { Workspace } from '../components/Shell';
import { Bar, EmptyState, Loadable, LoadingBar, Modal, Tag } from '../components/ui';
import { CardHead, memoCard, Meta, Stats } from '../components/Cards';
import { dateShort, hoursLeft, localDateKey, qty } from '../lib/format';
import { useAction, useQuery, useTz, useUi } from '../state/store';

const LEVEL = { high: 'Высокий', medium: 'Средний', low: 'Низкий' } as const;
const LEVEL_TIER = { high: 'critical', medium: 'attention', low: 'info' } as const;

/** Карточка предложения: приоритет, сколько порций продать и какие продукты это спасёт. */
const HotCard = memoCard(function HotCard({ o, rank, selected, onSelect }: { o: HotOffer; rank: number; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`dcard dcard--clickable ${selected ? 'is-selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
      {o.pinned ? (
        <CardHead name={o.name} sub={`№${rank} · закреплено менеджером`} tier="info" status="Выбор менеджера" />
      ) : (
        <CardHead name={o.name} sub={`№${rank} · ${o.score.toLocaleString('ru-RU')} балл.`} tier={LEVEL_TIER[o.level]} status={`Приоритет: ${LEVEL[o.level].toLowerCase()}`} />
      )}
      <Stats
        items={[
          { label: 'Продать порций', value: o.recommendedServings, tone: 'warn', title: 'Сколько порций нужно продать, чтобы использовать продукты до конца срока' },
          { label: 'Доступно порций', value: o.maxServings, tone: o.maxServings > 0 ? 'ok' : 'crit' },
          { label: 'Продуктов под риском', value: o.ingredients.length, tone: 'neutral' },
        ]}
      />
      <Meta rows={o.ingredients.map((ing) => [ing.name, `${qty(ing.atRiskQuantity, ing.unit)} · ${hoursLeft(ing.hoursLeft)}`, ing.state === 'critical' || ing.state === 'expired' ? 'crit' : 'warn'] as [string, string, 'crit' | 'warn'])} />
      <span className="dcard__summary">{o.summary}</span>
    </button>
  );
});

export function HotScreen() {
  const q = useQuery<HotOffers>('/hot-offers');
  const [selected, setSelected] = useState<number | null>(null);
  const [level, setLevel] = useState<'' | HotOffer['level']>('');
  const [pinning, setPinning] = useState(false);
  const { navigate, can, role } = useUi();
  const manager = role === 'manager';
  const { run, busy } = useAction();
  const tz = useTz();
  const offers = (q.data?.offers ?? []).filter((o) => !level || o.level === level);
  const current = q.data?.offers.find((o) => o.dishId === selected) ?? offers[0] ?? null;

  return (
    <Workspace
      rightLabel="Почему"
      sidebar={
        <div className="sidebar__scroll">
          <h3>Приоритет</h3>
          {(
            [
              ['', 'Все'],
              ['high', 'Высокий'],
              ['medium', 'Средний'],
              ['low', 'Низкий'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`side-btn ${level === k ? 'is-active' : ''}`} onClick={() => setLevel(k)}>
              <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
              <span className="count">{(q.data?.offers ?? []).filter((o) => !k || o.level === k).length}</span>
            </button>
          ))}
          <button className="side-btn side-btn--nav" onClick={() => navigate('orders')}>
            <Icon name="receipt" /> <span style={{ flex: 1 }}>Оформить заказ</span>
          </button>
          {can('expiry') && (
            <button className="side-btn side-btn--nav" onClick={() => navigate('expiry')}>
              <Icon name="clock" /> <span style={{ flex: 1 }}>Сроки годности</span>
            </button>
          )}
          {manager && (
            <button className="side-btn side-btn--nav" onClick={() => setPinning(true)}>
              <Icon name="plus" /> <span style={{ flex: 1 }}>Закрепить блюдо</span>
            </button>
          )}
        </div>
      }
      right={<OfferExplain offer={current} formula={q.data?.formula} />}
    >
      <div className="toolbar">
        <span className="section-title" style={{ margin: 0 }}>
          Блюда, которые стоит продвигать, чтобы использовать продукты до окончания срока
        </span>
      </div>
      <LoadingBar active={q.loading} />
      <div className="tray">
        <Loadable q={q}>
          {(d) => (
            <div className="stack">
              {offers.length === 0 ? (
                <EmptyState icon="flame" title="Горячих предложений нет" text="Нет пригодных партий с истекающим сроком, которые можно реализовать через доступные блюда." />
              ) : (
                <div className="grid grid--dishes">
                  {offers.map((o) => (
                    <HotCard key={o.dishId} o={o} rank={(q.data?.offers ?? []).indexOf(o) + 1} selected={current?.dishId === o.dishId} onSelect={() => setSelected(o.dishId)} />
                  ))}
                </div>
              )}
              {d.blocked.length > 0 && (
                <div className="sheet">
                  <h3>Могли бы помочь, но сейчас недоступны</h3>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Блюдо</th>
                          <th>Спасло бы</th>
                          <th>Мешает нехватка</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.blocked.map((b) => (
                          <tr key={b.dishId}>
                            <td>
                              <b>{b.name}</b>
                            </td>
                            <td>{b.atRiskProducts.join(', ')}</td>
                            <td style={{ color: 'var(--crit)', fontWeight: 700 }}>{b.missingProducts.join(', ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {manager && d.hidden.length > 0 && (
                <div className="sheet">
                  <h3>Скрыто менеджером</h3>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Блюдо</th>
                          <th>Пометка</th>
                          <th>Скрыл</th>
                          <th className="num">Баллы по расчёту</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {d.hidden.map((h) => (
                          <tr key={h.dishId}>
                            <td>
                              <b>{h.name}</b>
                            </td>
                            <td>{h.note ?? '—'}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {h.hiddenBy}, {dateShort(h.hiddenAt, tz)}
                            </td>
                            <td className="num">{h.score === null ? 'не в расчёте' : h.score.toLocaleString('ru-RU')}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button className="btn btn--sm" disabled={busy} onClick={() => run(() => api.del(`/hot-offers/overrides/${h.dishId}`), 'Блюдо снова в расчёте')}>
                                Вернуть
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </Loadable>
      </div>
      {pinning && <PinDialog onClose={() => setPinning(false)} />}
    </Workspace>
  );
}

/** Ручное закрепление блюда в горячих предложениях, например сезонного. */
function PinDialog({ onClose, dish }: { onClose: () => void; dish?: { id: number; name: string } }) {
  const dishes = useQuery<Dish[]>(dish ? null : '/dishes');
  const [dishId, setDishId] = useState<number | ''>(dish?.id ?? '');
  const [note, setNote] = useState('Сезонное');
  const [until, setUntil] = useState('');
  const { run, busy } = useAction();
  const tz = useTz();
  const save = async () => {
    if (dishId === '') return;
    const ok = await run(() => api.put(`/hot-offers/overrides/${dishId}`, { mode: 'pin', note, untilLocal: until || null }), 'Блюдо закреплено');
    if (ok) onClose();
  };
  return (
    <Modal
      title="Закрепить блюдо"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn--blue" disabled={busy || dishId === ''} onClick={save}>
            Закрепить
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        Блюдо будет первым в горячих предложениях, даже если у него нет продуктов с истекающим сроком.
      </p>
      {dish ? (
        <b>{dish.name}</b>
      ) : (
        <label className="field">
          Блюдо
          <select className="select" value={dishId} onChange={(e) => setDishId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Выберите блюдо</option>
            {(dishes.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Пометка
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="Например: сезонное меню" />
      </label>
      <label className="field">
        Действует до (необязательно)
        <input className="input" type="date" value={until} min={localDateKey(new Date(), tz)} onChange={(e) => setUntil(e.target.value)} />
      </label>
    </Modal>
  );
}

function OfferExplain({ offer, formula }: { offer: HotOffer | null; formula?: string }) {
  const { openProduct, navigate, role } = useUi();
  const manager = role === 'manager';
  const { run, busy } = useAction();
  const { confirm } = useUi();
  const [pinning, setPinning] = useState(false);
  const tz = useTz();
  const hide = async (o: HotOffer) => {
    if (!(await confirm({ title: `Скрыть «${o.name}»?`, text: 'Блюдо пропадёт из горячих предложений, даже если продукты в нём скоро испортятся. Вернуть можно в разделе «Скрыто менеджером».', confirmLabel: 'Скрыть' }))) return;
    await run(() => api.put(`/hot-offers/overrides/${o.dishId}`, { mode: 'hide' }), 'Блюдо скрыто');
  };
  return (
    <>
      <div className="rightbar__title">
        <h2>Почему</h2>
      </div>
      <div className="rightbar__body">
        {!offer ? (
          <EmptyState dark icon="chevron" title="Выберите блюдо" />
        ) : (
          <>
            <div>
              <div>
                <b style={{ fontSize: 17 }}>{offer.name}</b>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {offer.description}
                </div>
              </div>
            </div>
            {offer.pinned && (
              <div className="row" style={{ gap: 8 }}>
                <Tag kind="info">Выбор менеджера</Tag>
                {offer.pinnedUntil && <span className="muted">до {dateShort(offer.pinnedUntil, tz)}</span>}
              </div>
            )}
            <p style={{ margin: 0 }}>{offer.summary}</p>
            {manager && (
              <div className="row" style={{ gap: 8 }}>
                {offer.pinned ? (
                  <button className="btn btn--sm" disabled={busy} onClick={() => run(() => api.del(`/hot-offers/overrides/${offer.dishId}`), 'Закрепление снято')}>
                    Снять закрепление
                  </button>
                ) : (
                  <button className="btn btn--sm" disabled={busy} onClick={() => setPinning(true)}>
                    Закрепить
                  </button>
                )}
                <button className="btn btn--sm btn--dark" disabled={busy} onClick={() => hide(offer)}>
                  Скрыть
                </button>
              </div>
            )}
            {offer.limitingProductName && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Количество порций ограничивает: <b style={{ color: 'var(--text)' }}>{offer.limitingProductName}</b>
              </p>
            )}
            {offer.ingredients.map((ing) => (
              <div key={ing.productId} className={`risk risk--${ing.state === 'critical' ? 'critical' : 'warning'}`} style={{ padding: 9 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>{ing.name}</b>
                  <span className="pill-num">+{ing.contribution.toLocaleString('ru-RU')}</span>
                </div>
                <ul style={{ margin: '6px 0', paddingLeft: 18, fontSize: 13, color: 'var(--text-2)' }}>
                  {ing.explanation.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                <div className="factors">
                  <Factor label="Срочность" value={ing.urgency} hint={`до конца срока ${hoursLeft(ing.hoursLeft)}`} />
                  <Factor label="Покрытие" value={ing.coverage} hint={`блюдо реализует ${qty(ing.rescuedQuantity, ing.unit)} из ${qty(ing.atRiskQuantity, ing.unit)}`} />
                  <Factor label="Объём" value={ing.volume} hint={`${ing.servingsToClear} порц. до полного расхода`} />
                  <Factor label="Эксклюзивность" value={ing.exclusivity} hint={ing.otherDishCount ? `ещё ${ing.otherDishCount} блюд(а)` : 'только это блюдо'} />
                </div>
                {manager && (
                  <button className="btn btn--sm" style={{ marginTop: 6 }} onClick={() => openProduct(ing.productId)}>
                    Партии продукта
                  </button>
                )}
              </div>
            ))}
            {formula && (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Формула: {formula}.
              </p>
            )}
          </>
        )}
      </div>
      {pinning && offer && <PinDialog dish={{ id: offer.dishId, name: offer.name }} onClose={() => setPinning(false)} />}
      <div className="rightbar__foot">
        <span className="muted">Продавайте в первую очередь</span>
        <button className="btn btn--lg btn--blue" onClick={() => navigate('orders')}>
          К заказу
        </button>
      </div>
    </>
  );
}

function Factor({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="factor" title={hint}>
      <span>{label}</span>
      <Bar value={value} color="var(--primary)" />
      <span className="pill-num">{Math.round(value * 100)}%</span>
      <small>{hint}</small>
    </div>
  );
}
