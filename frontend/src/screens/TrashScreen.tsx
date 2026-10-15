import { useState } from 'react';
import { api } from '../api/client';
import type { TrashItem } from '../api/types';
import { Icon } from '../components/Icon';
import { SearchBox, Workspace } from '../components/Shell';
import { EmptyState, Loadable, LoadingBar, Tag } from '../components/ui';
import { dateShort, humanDate, qty } from '../lib/format';
import { useAction, useNow, useQuery, useTz, useUi } from '../state/store';
import { matches } from './StockScreen';

const KINDS = [
  ['', 'Все списания'],
  ['spoilage', 'Порча'],
  ['expired', 'Просрочка'],
] as const;

/** Корзина: списанное не пропадает сразу, его можно вернуть на склад или удалить навсегда. */
export function TrashScreen() {
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const q = useQuery<TrashItem[]>('/trash');
  const { openProduct, confirm } = useUi();
  const { run, busy } = useAction();
  const tz = useTz();
  const now = useNow();
  const all = q.data ?? [];
  const counts = Object.fromEntries(KINDS.map(([k]) => [k, all.filter((t) => !k || t.kind === k).length]));
  const list = all
    .filter((t) => !kind || t.kind === kind)
    .filter((t) => !search.trim() || matches({ name: `${t.productName} ${t.batchCode} ${t.reason} ${t.deletedBy}` }, search));

  const restore = async (t: TrashItem) => {
    const text = t.batchExpired
      ? `${t.productName}: ${qty(t.quantity, t.unit)} вернётся в партию ${t.batchCode}. Срок партии уже истёк, поэтому в доступный остаток она не попадёт.`
      : `${t.productName}: ${qty(t.quantity, t.unit)} вернётся в партию ${t.batchCode} и снова будет доступно для блюд.`;
    if (!(await confirm({ title: 'Вернуть на склад?', text, confirmLabel: 'Вернуть' }))) return;
    await run(() => api.post(`/trash/${t.id}/restore`), 'Возвращено на склад');
  };

  const purge = async (t: TrashItem) => {
    if (!(await confirm({
      title: 'Удалить навсегда?',
      text: `${t.productName}, ${qty(t.quantity, t.unit)}. Вернуть это списание будет уже нельзя. В журнале оно останется.`,
      confirmLabel: 'Удалить',
      danger: true,
    }))) return;
    await run(() => api.post(`/trash/${t.id}/purge`), 'Удалено из корзины');
  };

  return (
    <Workspace
      sidebar={
        <>
          <SearchBox value={search} onChange={setSearch} placeholder="Продукт, партия, причина…" />
          <div className="sidebar__scroll">
            <h3>Тип списания</h3>
            {KINDS.map(([k, label]) => (
              <button key={k} className={`side-btn ${kind === k ? 'is-active' : ''}`} onClick={() => setKind(k)} aria-pressed={kind === k}>
                <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
                <span className="count">{counts[k]}</span>
              </button>
            ))}
          </div>
        </>
      }
    >
      <div className="toolbar">
        <span className="ink-muted">Здесь лежит всё списанное. Ошибочное списание можно вернуть на склад.</span>
      </div>
      <LoadingBar active={q.loading} />
      <div className="tray">
        <Loadable q={q}>
          {() =>
            list.length === 0 ? (
              <EmptyState icon="trash" title="Корзина пуста" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Продукт и партия</th>
                      <th className="num">Количество</th>
                      <th>Тип</th>
                      <th>Причина</th>
                      <th>Когда и кто</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((t) => (
                      <tr key={t.id} className="is-clickable" onClick={() => openProduct(t.productId)}>
                        <td>
                          <b>{t.productName}</b>
                          <div className="muted" style={{ fontSize: 12 }}>
                            <span className="mono-cell">{t.batchCode}</span> · годна до {humanDate(t.batchExpiresAt, tz, now)}
                          </div>
                        </td>
                        <td className="num">
                          <b>{qty(t.quantity, t.unit)}</b>
                        </td>
                        <td>
                          <Tag kind={t.kind === 'expired' ? 'expired' : 'critical'}>{t.kind === 'expired' ? 'Просрочка' : 'Порча'}</Tag>
                        </td>
                        <td>{t.reason}</td>
                        <td>
                          {dateShort(t.deletedAt, tz)}
                          <div className="muted" style={{ fontSize: 12 }}>
                            {t.deletedBy}
                          </div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn--sm" disabled={busy} onClick={() => restore(t)}>
                            <Icon name="refresh" /> Вернуть
                          </button>{' '}
                          <button className="btn btn--sm btn--red" disabled={busy} onClick={() => purge(t)} aria-label="Удалить навсегда" title="Удалить навсегда">
                            <Icon name="x" />
                          </button>
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
