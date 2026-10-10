import { useState } from 'react';
import type { Stats } from '../api/types';
import { BarChart, SERIES } from '../components/Charts';
import { CategoryList, SectionNav, Workspace } from '../components/Shell';
import { Bar, Emoji, EmptyState, Loadable, LoadingBar, Tag } from '../components/ui';
import { humanDate, qty, relative } from '../lib/format';
import { useNow, useQuery, useTz, useUi } from '../state/store';

const PERIODS = [
  [1, 'Сегодня'],
  [7, '7 дней'],
  [14, '14 дней'],
  [30, '30 дней'],
] as const;

export function StatsScreen() {
  const [days, setDays] = useState(7);
  const [category, setCategory] = useState('');
  const q = useQuery<Stats>(`/stats?days=${days}${category ? `&category=${encodeURIComponent(category)}` : ''}`);
  const { openProduct } = useUi();
  const tz = useTz();
  const now = useNow();

  return (
    <Workspace
      sidebar={
        <div className="sidebar__scroll">
          <h3>Период</h3>
          {PERIODS.map(([d, label]) => (
            <button key={d} className={`side-btn ${days === d ? 'is-active' : ''}`} onClick={() => setDays(d)} aria-pressed={days === d}>
              <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
            </button>
          ))}
          <CategoryList value={category} onChange={setCategory} />
          <SectionNav />
        </div>
      }
    >
      <LoadingBar active={q.loading} />
      <div className="tray" style={{ background: '#a9a9a9' }}>
        <Loadable q={q}>
          {(s) => (
            <div className="stack">
              <div className="ledger">
                <Num label="Продуктов в наличии" value={`${s.totals.productsInStock}/${s.totals.products}`} />
                <Num label="Активных партий" value={s.totals.activeBatches} />
                <Num label="Истекает срок" value={`${s.totals.expiringProducts} прод. / ${s.totals.expiringBatches} парт.`} tone="warn" />
                <Num label="Просрочено на складе" value={`${s.totals.expiredProducts} прод. / ${s.totals.expiredBatches} парт.`} tone="bad" />
                <Num label="Заказов выполнено" value={s.totals.ordersCompleted} />
                <Num label="Заказов отклонено" value={s.totals.ordersRejected} tone={s.totals.ordersRejected ? 'bad' : undefined} />
                <Num label="Поставок / партий принято" value={`${s.totals.supplies} / ${s.totals.batchesReceived}`} />
                <Num label="Операций списания" value={s.totals.writeOffOperations} tone={s.totals.writeOffOperations ? 'warn' : undefined} />
              </div>

              <div className="two-col">
                <div className="sheet">
                  <h3>Заказы по дням</h3>
                  <BarChart
                    ariaLabel="Выполненные и отклонённые заказы по дням"
                    data={s.daily}
                    series={[
                      { key: 'ordersCompleted', label: 'Выполнено', color: SERIES.primary },
                      { key: 'ordersRejected', label: 'Отклонено', color: SERIES.rejected },
                    ]}
                  />
                </div>
                <div className="sheet">
                  <h3>Поступления и списания (партии / операции)</h3>
                  <BarChart
                    ariaLabel="Принятые партии и операции списания по дням"
                    data={s.daily}
                    series={[
                      { key: 'receipts', label: 'Принято партий', color: SERIES.primary },
                      { key: 'writeOffs', label: 'Списаний (просрочка, порча)', color: SERIES.secondary },
                    ]}
                  />
                </div>
              </div>

              <div className="sheet table-wrap">
                <h3>Движение и списания по продуктам</h3>
                {s.flows.length === 0 ? (
                  <EmptyState title="Движений за период нет" />
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Продукт</th>
                        <th className="num">Поступило</th>
                        <th className="num">Израсходовано на блюда</th>
                        <th className="num">Списано (срок)</th>
                        <th className="num">Списано (порча)</th>
                        <th style={{ minWidth: 150 }}>Доля потерь</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.flows.map((f) => (
                        <tr key={f.productId} className="is-clickable" onClick={() => openProduct(f.productId)}>
                          <td>
                            <Emoji>{f.icon}</Emoji> {f.name}
                          </td>
                          <td className="num">{qty(f.received, f.unit)}</td>
                          <td className="num">{qty(f.consumed, f.unit)}</td>
                          <td className="num">{f.expiredWrittenOff ? qty(f.expiredWrittenOff, f.unit) : '—'}</td>
                          <td className="num">{f.spoilageWrittenOff ? qty(f.spoilageWrittenOff, f.unit) : '—'}</td>
                          <td>
                            <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                              <div style={{ flex: 1 }}>
                                <Bar value={f.wasteRatio} color={f.wasteRatio > 0.15 ? '#b3302a' : SERIES.secondary} />
                              </div>
                              <span className="pill-num" style={{ width: 42, textAlign: 'right' }}>
                                {Math.round(f.wasteRatio * 100)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="two-col">
                <div className="sheet table-wrap">
                  <h3>Наиболее дефицитные ингредиенты</h3>
                  {s.deficits.length === 0 ? (
                    <EmptyState title="Дефицита не было" />
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Ингредиент</th>
                          <th className="num">Отказов</th>
                          <th className="num">Не хватало всего</th>
                          <th className="num">Блюд в стопе сейчас</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.deficits.map((d) => (
                          <tr key={d.productId} className="is-clickable" onClick={() => openProduct(d.productId)}>
                            <td>
                              <Emoji>{d.icon}</Emoji> {d.name} {d.belowMinimum && <Tag kind="warning">ниже мин.</Tag>}
                            </td>
                            <td className="num">{d.rejections}</td>
                            <td className="num">{d.missingTotal ? qty(d.missingTotal, d.unit) : '—'}</td>
                            <td className="num">{d.blockedDishesNow}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="sheet table-wrap">
                  <h3>Частота попадания блюд в стоп-лист</h3>
                  {s.stopFrequency.length === 0 ? (
                    <EmptyState title="Блюда не попадали в стоп-лист" />
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Блюдо</th>
                          <th className="num">Раз</th>
                          <th className="num">Часов в стопе</th>
                          <th>Сейчас</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.stopFrequency.map((f) => (
                          <tr key={f.dishId}>
                            <td>
                              <Emoji>{f.icon}</Emoji> {f.name}
                            </td>
                            <td className="num">{f.entries}</td>
                            <td className="num">{f.totalHours.toLocaleString('ru-RU')}</td>
                            <td>{f.currentlyStopped ? <Tag kind="critical">в стопе</Tag> : <Tag kind="ok">доступно</Tag>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className="two-col">
                <div className="sheet table-wrap">
                  <h3>Прогноз дефицита (по расходу и срокам партий)</h3>
                  {!s.forecastHasData ? (
                    <EmptyState icon="📈" title="Недостаточно данных для прогноза" />
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Продукт</th>
                          <th className="num">Доступно</th>
                          <th className="num">Расход/сут</th>
                          <th>Закончится</th>
                          <th className="num">Потери по сроку</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.forecasts.slice(0, 12).map((f) => (
                          <tr
                            key={f.productId}
                            className={`is-clickable ${f.hoursToDepletion !== null && f.hoursToDepletion <= 24 ? 'row--critical' : f.hoursToDepletion !== null && f.hoursToDepletion <= 72 ? 'row--soon' : ''}`}
                            onClick={() => openProduct(f.productId)}
                          >
                            <td>
                              <Emoji>{f.icon}</Emoji> {f.name}
                            </td>
                            <td className="num">{qty(f.available, f.unit)}</td>
                            <td className="num">{qty(f.dailyUsage, f.unit)}</td>
                            <td>{f.depletionAt && f.hoursToDepletion !== null ? `${humanDate(f.depletionAt, tz, now)} (${relative(f.hoursToDepletion)})` : '> 7 дней'}</td>
                            <td className="num">{f.expectedLoss ? qty(f.expectedLoss, f.unit) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="sheet table-wrap">
                  <h3>Прогноз стоп-листа</h3>
                  {s.stopForecast.length === 0 ? (
                    <EmptyState title="Новых стопов в ближайшие 7 дней не ожидается" />
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Блюдо</th>
                          <th>Ожидаемый стоп</th>
                          <th>Из-за</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.stopForecast.map((f) => (
                          <tr key={f.dishId}>
                            <td>
                              <Emoji>{f.icon}</Emoji> {f.name}
                            </td>
                            <td>
                              {humanDate(f.predictedAt, tz, now)} ({relative(f.hoursUntil)})
                            </td>
                            <td>{f.causeProductName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </Loadable>
      </div>
    </Workspace>
  );
}

function Num({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' | 'bad' }) {
  return (
    <div className={`ledger__item ${tone ? `ledger__item--${tone}` : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
