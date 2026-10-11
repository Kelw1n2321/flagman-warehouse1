import type { StopList } from '../api/types';
import { ControlPanel } from '../components/ControlPanel';
import { Icon } from '../components/Icon';
import { Workspace } from '../components/Shell';
import { Emoji, EmptyState, Loadable, LoadingBar, Tag } from '../components/ui';
import { humanDate, qty, relative } from '../lib/format';
import { useLive, useNow, useQuery, useTz, useUi } from '../state/store';

export function StopListScreen() {
  const q = useQuery<StopList>('/stop-list');
  const { navigate, openProduct } = useUi();
  const { summary } = useLive();
  const tz = useTz();
  const now = useNow();

  return (
    <Workspace
      rightCount={summary?.activeAlerts}
      sidebar={
        <div className="sidebar__scroll">
          <h3>Стоп-лист</h3>
          <div className="sheet" style={{ padding: 10 }}>
            <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>
              {q.data?.items.length ?? '…'}
              <span style={{ fontSize: 16 }}> / {q.data?.totalDishes ?? '…'}</span>
            </div>
            <div className="ink-muted">блюд недоступно</div>
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: '4px 0' }}>
            Пересчитывается автоматически после поставок, списаний, корректировок, изменения рецептур и выбытия просрочки.
          </p>
          <button className="side-btn side-btn--nav" onClick={() => navigate('supplies', 'recommendations')}>
            <Icon name="truck" /> <span style={{ flex: 1 }}>Что заказать</span>
          </button>
          <button className="side-btn side-btn--nav" onClick={() => navigate('dishes')}>
            <Icon name="chef" /> <span style={{ flex: 1 }}>Рецептуры</span>
          </button>
        </div>
      }
      right={<ControlPanel />}
    >
      <LoadingBar active={q.loading} />
      <div className="tray">
        <Loadable q={q}>
          {(d) => (
            <div className="stack">
              {d.items.length === 0 ? (
                <EmptyState icon="check" title="Стоп-лист пуст" text="Все блюда меню можно приготовить из доступных остатков." />
              ) : (
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
                  {d.items.map((it) => (
                    <div key={it.dishId} className="stop-card">
                      <div className="stop-card__head">
                        <span className="emoji" style={{ fontSize: 40 }}>
                          {it.icon}
                        </span>
                        <div style={{ flex: 1 }}>
                          <b style={{ fontSize: 19 }}>{it.name}</b>
                          <div className="row" style={{ gap: 6, marginTop: 3 }}>
                            <Tag kind="critical">Недоступно</Tag>
                            {it.since && <span className="ink-muted">с {humanDate(it.since, tz, now)}</span>}
                          </div>
                        </div>
                      </div>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Не хватает</th>
                            <th className="num">Нужно</th>
                            <th className="num">Есть</th>
                            <th className="num">Нехватка</th>
                          </tr>
                        </thead>
                        <tbody>
                          {it.missing.map((m) => (
                            <tr key={m.productId} className="is-clickable" onClick={() => openProduct(m.productId)}>
                              <td>
                                <span className="emoji">{m.icon}</span> <b>{m.name}</b>
                                {m.expiredExcluded > 0 && <div className="ink-muted">просрочено {qty(m.expiredExcluded, m.unit)} — не используется</div>}
                              </td>
                              <td className="num">{qty(m.required, m.unit)}</td>
                              <td className="num">{qty(m.available, m.unit)}</td>
                              <td className="num" style={{ color: 'var(--crit)', fontWeight: 700 }}>
                                {qty(m.shortfall, m.unit)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="ink-muted" style={{ fontSize: 12 }}>
                        Норма указана на одну порцию.
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="sheet">
                <h3>Прогноз: блюда, которые скоро попадут в стоп-лист</h3>
                {d.forecast.length === 0 ? (
                  <EmptyState icon="chart" title="В ближайшие 7 дней рисков не видно" text="Прогноз строится по среднему расходу и срокам партий." />
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Блюдо</th>
                          <th className="num">Порций сейчас</th>
                          <th>Ожидаемый стоп</th>
                          <th>Причина</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.forecast.map((f) => (
                          <tr key={f.dishId} className={f.hoursUntil <= 24 ? 'row--critical' : f.hoursUntil <= 72 ? 'row--soon' : ''}>
                            <td>
                              <span className="emoji">{f.icon}</span> {f.name}
                            </td>
                            <td className="num">{f.maxServings}</td>
                            <td>
                              {humanDate(f.predictedAt, tz, now)} ({relative(f.hoursUntil)})
                            </td>
                            <td>
                              <button className="btn btn--sm" onClick={() => openProduct(f.causeProductId)}>
                                {f.causeProductName}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {d.recentlyReturned.length > 0 && (
                <div className="sheet">
                  <h3>Вернулись в меню за сутки</h3>
                  <div className="row">
                    {d.recentlyReturned.map((r) => (
                      <span key={r.dishId} className="tag tag--ok" style={{ fontSize: 13, padding: '4px 10px' }}>
                        <Emoji>{r.icon}</Emoji> {r.name} · {humanDate(r.endedAt, tz, now)}
                      </span>
                    ))}
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
