import { useState } from 'react';
import type { HotOffer, HotOffers } from '../api/types';
import { Icon } from '../components/Icon';
import { SectionNav, Workspace } from '../components/Shell';
import { Bar, Emoji, EmptyState, Loadable, LoadingBar, Tag } from '../components/ui';
import { hoursLeft, qty } from '../lib/format';
import { useQuery, useUi } from '../state/store';

const LEVEL = { high: 'Высокий', medium: 'Средний', low: 'Низкий' } as const;

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
          <SectionNav />
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
                <EmptyState icon="🧊" title="Горячих предложений нет" text="Нет пригодных партий с истекающим сроком, которые можно реализовать через доступные блюда." />
              ) : (
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                  {offers.map((o, i) => (
                    <button key={o.dishId} className={`hot-card hot-card--${o.level} ${current?.dishId === o.dishId ? 'is-selected' : ''}`} onClick={() => setSelected(o.dishId)}>
                      <span className="hot-card__rank">#{i + 1}</span>
                      <span className="hot-card__head">
                        <span className="emoji" style={{ fontSize: 44 }}>
                          {o.icon}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <b className="hot-card__name">{o.name}</b>
                          <span className="row" style={{ gap: 6 }}>
                            <Tag kind={o.level}>🔥 {LEVEL[o.level]}</Tag>
                            <span className="hot-card__score" title="Сумма вкладов ингредиентов">
                              {o.score.toLocaleString('ru-RU')} балл.
                            </span>
                          </span>
                        </span>
                      </span>
                      <span className="hot-card__summary">{o.summary}</span>
                      <span className="hot-card__chips">
                        {o.ingredients.map((ing) => (
                          <span key={ing.productId} className={`chip chip--${ing.state}`}>
                            <Emoji>{ing.icon}</Emoji> {ing.name}: {qty(ing.atRiskQuantity, ing.unit)} · {hoursLeft(ing.hoursLeft)}
                          </span>
                        ))}
                      </span>
                      <span className="hot-card__foot">
                        <span>
                          Доступно: <b>{o.maxServings} порц.</b>
                        </span>
                        <span>
                          Рекомендуется продать: <b>{o.recommendedServings}</b>
                        </span>
                      </span>
                    </button>
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
                              <span className="emoji">{b.icon}</span> {b.name}
                            </td>
                            <td>{b.atRiskProducts.join(', ')}</td>
                            <td style={{ color: '#8c231e', fontWeight: 700 }}>{b.missingProducts.join(', ')}</td>
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
          <EmptyState dark icon="👈" title="Выберите блюдо" />
        ) : (
          <>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <span className="emoji" style={{ fontSize: 40 }}>
                {offer.icon}
              </span>
              <div>
                <b style={{ fontSize: 18 }}>{offer.name}</b>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {offer.description}
                </div>
              </div>
            </div>
            <p style={{ margin: 0 }}>{offer.summary}</p>
            {offer.limitingProductName && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Количество порций ограничивает: <b style={{ color: '#ddd' }}>{offer.limitingProductName}</b>
              </p>
            )}
            {offer.ingredients.map((ing) => (
              <div key={ing.productId} className={`risk risk--${ing.state === 'critical' ? 'critical' : 'warning'}`} style={{ padding: 9 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>
                    <Emoji>{ing.icon}</Emoji> {ing.name}
                  </b>
                  <span className="pill-num">+{ing.contribution.toLocaleString('ru-RU')}</span>
                </div>
                <ul style={{ margin: '6px 0', paddingLeft: 18, fontSize: 13, color: '#ccc' }}>
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
      <Bar value={value} color="#6db3ea" />
      <span className="pill-num">{Math.round(value * 100)}%</span>
      <small>{hint}</small>
    </div>
  );
}
