import type { StopList } from '../api/types';
import { CardHead, Meta, StatusPill, Stats } from '../components/Cards';
import { ControlPanel } from '../components/ControlPanel';
import { Icon } from '../components/Icon';
import { Workspace } from '../components/Shell';
import { EmptyState, Loadable, LoadingBar } from '../components/ui';
import { humanDate, qty, relative } from '../lib/format';
import { useLive, useNow, useQuery, useTz, useUi } from '../state/store';

export function StopListScreen() {
  const q = useQuery<StopList>('/stop-list');
  const { navigate, openProduct } = useUi();
  const { summary } = useLive();
  const tz = useTz();
  const now = useNow();
  const d = q.data;

  return (
    <Workspace
      rightCount={summary?.activeAlerts}
      sidebar={
        <div className="sidebar__scroll">
          <h3>Стоп-лист</h3>
          <Stats
            items={[
              { label: 'Недоступно блюд', value: d ? d.items.length : '…', tone: d?.items.length ? 'crit' : 'muted' },
              { label: 'Всего в меню', value: d?.totalDishes ?? '…', tone: 'neutral' },
              { label: 'Прогноз стопов', value: d ? d.forecast.length : '…', tone: d?.forecast.length ? 'warn' : 'muted', title: 'Блюда, которые попадут в стоп-лист в ближайшие 7 дней' },
            ]}
          />
          <p className="muted" style={{ fontSize: 12.5, margin: '6px 2px' }}>
            Пересчитывается автоматически после поставок, заказов, списаний, корректировок, изменения рецептур и выбытия просрочки.
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
                <div className="grid grid--dishes">
                  {d.items.map((it) => (
                    <article key={it.dishId} className="dcard">
                      <CardHead name={it.name} sub={`${it.category} · не хватает ${it.missing.length}`} tier="critical" status="Стоп-лист" />
                      <div className="dcard__stats">
                        {it.missing.map((m) => (
                          <button
                            key={m.productId}
                            className="dcard__stat dcard__stat--btn"
                            onClick={() => openProduct(m.productId)}
                            title={`Нужно ${qty(m.required, m.unit)} на порцию, есть ${qty(m.available, m.unit)}${m.expiredExcluded > 0 ? `; просрочено ${qty(m.expiredExcluded, m.unit)} — не используется` : ''}`}
                          >
                            <dt>{m.name}</dt>
                            <dd className="tone-crit">
                              {qty(m.available, m.unit)} / {qty(m.required, m.unit)}
                            </dd>
                          </button>
                        ))}
                      </div>
                      <Meta
                        rows={[
                          ['В стоп-листе', it.since ? `с ${humanDate(it.since, tz, now)}` : '—'],
                          ['Есть / нужно', 'на 1 порцию'],
                        ]}
                      />
                      <button className="dcard__action" onClick={() => navigate('supplies', 'recommendations')}>
                        <Icon name="truck" /> Что заказать
                      </button>
                    </article>
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
                          <th>Срочность</th>
                          <th>Причина</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.forecast.map((f) => (
                          <tr key={f.dishId}>
                            <td>
                              <b>{f.name}</b>
                            </td>
                            <td className="num">{f.maxServings}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {humanDate(f.predictedAt, tz, now)} · {relative(f.hoursUntil)}
                            </td>
                            <td>
                              {f.hoursUntil <= 24 ? (
                                <StatusPill tier="critical">До суток</StatusPill>
                              ) : f.hoursUntil <= 72 ? (
                                <StatusPill tier="attention">До 3 дней</StatusPill>
                              ) : (
                                <StatusPill tier="info">Позже</StatusPill>
                              )}
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
                      <StatusPill key={r.dishId} tier="ok">
                        {r.name} · {humanDate(r.endedAt, tz, now)}
                      </StatusPill>
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
