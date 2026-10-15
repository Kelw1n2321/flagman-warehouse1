import { useState } from 'react';
import type { TopDish, TopDishes } from '../api/types';
import { Stats } from '../components/Cards';
import { Workspace } from '../components/Shell';
import { Bar, EmptyState, Loadable, LoadingBar, Tag } from '../components/ui';
import { useQuery, useUi } from '../state/store';

const PERIODS = [
  [7, '7 дней'],
  [14, '14 дней'],
  [30, '30 дней'],
] as const;

const pct = (v: number) => `${(v * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;

/** Ходовые блюда: рейтинг продаж за период. Раздел только для менеджера (доступ проверяет и сервер). */
export function TopDishesScreen() {
  const [days, setDays] = useState<number>(7);
  const [category, setCategory] = useState('');
  const q = useQuery<TopDishes>(`/top-dishes?days=${days}${category ? `&category=${encodeURIComponent(category)}` : ''}`);
  const d = q.data;
  const leader = d?.items[0]?.servings ? d.items[0] : null;
  const maxServings = Math.max(1, ...(d?.items.map((i) => i.servings) ?? [1]));

  return (
    <Workspace
      sidebar={
        <div className="sidebar__scroll">
          <h3>Период</h3>
          {PERIODS.map(([value, label]) => (
            <button key={value} className={`side-btn ${days === value ? 'is-active' : ''}`} onClick={() => setDays(value)} aria-pressed={days === value}>
              <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
            </button>
          ))}
          <h3>Раздел меню</h3>
          <button className={`side-btn ${category === '' ? 'is-active' : ''}`} onClick={() => setCategory('')} aria-pressed={category === ''}>
            <span style={{ flex: 1, textAlign: 'left' }}>Все блюда</span>
          </button>
          {(d?.categories ?? []).map((c) => (
            <button key={c} className={`side-btn ${category === c ? 'is-active' : ''}`} onClick={() => setCategory(c)} aria-pressed={category === c}>
              <span style={{ flex: 1, textAlign: 'left' }}>{c}</span>
            </button>
          ))}
          <p className="muted" style={{ fontSize: 12.5, margin: '6px 2px' }}>
            Считаются только выполненные заказы. Динамика показана к предыдущему периоду такой же длины.
          </p>
        </div>
      }
    >
      <div className="toolbar">
        <Stats
          items={[
            { label: 'Продано порций', value: d ? d.totalServings : '…', tone: 'neutral' },
            { label: 'Заказов', value: d ? d.totalOrders : '…', tone: 'neutral' },
            { label: 'Лидер', value: leader ? leader.name : '—', tone: leader ? 'ok' : 'muted' },
          ]}
        />
      </div>
      <LoadingBar active={q.loading} />
      <div className="tray">
        <Loadable q={q}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon="trend" title="Нет блюд" text="В этом разделе меню нет блюд." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="num">№</th>
                      <th>Блюдо</th>
                      <th>Продано</th>
                      <th className="num">Заказов</th>
                      <th>Динамика</th>
                      <th>По дням</th>
                      <th>Сейчас</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((i) => (
                      <TopRow key={i.dishId} i={i} max={maxServings} labels={data.dayLabels} />
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

function TopRow({ i, max, labels }: { i: TopDish; max: number; labels: string[] }) {
  const { navigate } = useUi();
  return (
    <tr className="is-clickable" onClick={() => navigate('dishes')} title="Открыть рецептуры">
      <td className="num pill-num">{i.servings ? i.rank : '—'}</td>
      <td>
        <b>{i.name}</b>
        <div className="muted" style={{ fontSize: 12 }}>
          {i.category || 'Без раздела'}
          {!i.isActive && ' · снято с меню'}
        </div>
      </td>
      <td style={{ minWidth: 150 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <b className="pill-num" style={{ minWidth: 34 }}>{i.servings}</b>
          <div style={{ flex: 1, minWidth: 60 }}>
            <Bar value={i.servings / max} color="var(--ok)" />
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {i.servings ? `${pct(i.share)} всех порций` : 'не продавалось'}
        </div>
      </td>
      <td className="num">{i.orders}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <Trend i={i} />
      </td>
      <td>
        <Spark values={i.daily} labels={labels} />
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {i.inStopList || i.maxServings === 0 ? (
          <Tag kind="critical">Стоп-лист</Tag>
        ) : (
          <span>
            <b>{i.maxServings}</b> <span className="muted">порц.</span>
          </span>
        )}
        {i.limitingProductName && (
          <div className="muted" style={{ fontSize: 12 }}>
            ограничивает: {i.limitingProductName}
          </div>
        )}
      </td>
    </tr>
  );
}

function Trend({ i }: { i: TopDish }) {
  if (i.trendPercent === null) return i.servings ? <Tag kind="info">Новое</Tag> : <span className="muted">—</span>;
  const up = i.trendPercent > 0;
  const flat = i.trendPercent === 0;
  return (
    <span style={{ color: flat ? 'var(--text-2)' : up ? 'var(--ok)' : 'var(--crit)', fontWeight: 700 }} title={`Прошлый период: ${i.prevServings} порц.`}>
      {flat ? '=' : up ? '▲' : '▼'} {up ? '+' : ''}
      {i.trendPercent.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%
    </span>
  );
}

/** Маленький столбчатый график порций по дням. */
function Spark({ values, labels }: { values: number[]; labels: string[] }) {
  const w = 120;
  const h = 28;
  const max = Math.max(1, ...values);
  const step = w / values.length;
  const bw = Math.max(1.5, step - 2);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Порции по дням: ${values.join(', ')}`}>
      {values.map((v, k) => {
        const bh = v === 0 ? 1 : Math.max(2, (v / max) * (h - 2));
        return (
          <rect key={k} x={k * step + (step - bw) / 2} y={h - bh} width={bw} height={bh} rx={1} fill={v === 0 ? 'var(--border-strong)' : 'var(--chart-1)'}>
            <title>{`${labels[k] ?? ''}: ${v} порц.`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
