import { useState } from 'react';
import type { HotOffer, HotOffers } from '../api/types';
import { Icon } from '../components/Icon';
import { Workspace } from '../components/Shell';
import { Bar, EmptyState, Loadable, LoadingBar } from '../components/ui';
import { CardHead, memoCard, Meta, Stats } from '../components/Cards';
import { hoursLeft, qty } from '../lib/format';
import { useQuery, useUi } from '../state/store';

const LEVEL = { high: 'Высокий', medium: 'Средний', low: 'Низкий' } as const;
const LEVEL_TIER = { high: 'critical', medium: 'attention', low: 'info' } as const;

/** Карточка предложения: приоритет, сколько порций продать и какие продукты это спасёт. */
const HotCard = memoCard(function HotCard({ o, rank, selected, onSelect }: { o: HotOffer; rank: number; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`dcard dcard--clickable ${selected ? 'is-selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
      <CardHead name={o.name} sub={`№${rank} · ${o.score.toLocaleString('ru-RU')} балл.`} tier={LEVEL_TIER[o.level]} status={`Приоритет: ${LEVEL[o.level].toLowerCase()}`} />
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
  const { navigate } = useUi();
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
          <button className="side-btn side-btn--nav" onClick={() => navigate('expiry')}>
            <Icon name="clock" /> <span style={{ flex: 1 }}>Сроки годности</span>
          </button>
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
            </div>
          )}
        </Loadable>
      </div>
    </Workspace>
  );
}

function OfferExplain({ offer, formula }: { offer: HotOffer | null; formula?: string }) {
  const { openProduct, navigate } = useUi();
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
            <p style={{ margin: 0 }}>{offer.summary}</p>
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
                <button className="btn btn--sm" style={{ marginTop: 6 }} onClick={() => openProduct(ing.productId)}>
                  Партии продукта
                </button>
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
