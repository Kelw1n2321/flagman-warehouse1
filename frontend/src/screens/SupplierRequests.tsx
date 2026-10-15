import { useState } from 'react';
import { api } from '../api/client';
import type { SupplierRequest } from '../api/types';
import { Icon } from '../components/Icon';
import { EmptyState, Loadable, LoadingBar, Modal, Tag } from '../components/ui';
import { dateShort, humanDate, qty, unitLabel } from '../lib/format';
import { useAction, useNow, useQuery, useTz, useUi } from '../state/store';

export const REQUEST_STATUS = { sent: 'Ждёт решения', accepted: 'Принята', rejected: 'Отклонена' } as const;
const REQUEST_TAG = { sent: 'soon', accepted: 'received', rejected: 'rejected' } as const;

/** Заявки от поставщиков: менеджер принимает фактическое количество или отказывает. */
export function SupplierRequestList({ search }: { search: string }) {
  const q = useQuery<SupplierRequest[]>('/supplier-requests');
  const [open, setOpen] = useState<string | null>(null);
  const tz = useTz();
  const term = search.trim().toLowerCase();
  return (
    <>
      <div className="toolbar">
        <span className="section-title" style={{ margin: 0 }}>
          Заявки, которые поставщики отправили через свой кабинет (/supplier)
        </span>
      </div>
      <LoadingBar active={q.loading} />
      <div className="tray">
        <Loadable q={q}>
          {(all) => {
            const list = all.filter((r) => !term || [r.number, r.supplierName, ...r.lines.map((l) => l.productName)].some((x) => x.toLowerCase().includes(term)));
            if (list.length === 0) return <EmptyState icon="inbox" title="Заявок нет" text="Когда поставщик отправит заявку, она появится здесь." />;
            return (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Номер</th>
                      <th>Поставщик</th>
                      <th>Отправлена</th>
                      <th>Товары</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id} className="is-clickable" onClick={() => setOpen(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(r.id)}>
                        <td>
                          <b>{r.number}</b>
                        </td>
                        <td>{r.supplierName}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{dateShort(r.createdAt, tz)}</td>
                        <td className="cell-products">
                          <span>{r.lines.map((l) => `${l.productName} ${qty(l.requestedQuantity, l.unit)}`).join(', ')}</span>
                        </td>
                        <td>
                          <Tag kind={REQUEST_TAG[r.status]}>{r.partial ? 'Принята частично' : REQUEST_STATUS[r.status]}</Tag>
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
      {open && <RequestReview id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function RequestReview({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery<SupplierRequest>(`/supplier-requests/${id}`);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, busy } = useAction();
  const { navigate } = useUi();
  const tz = useTz();
  const now = useNow();
  const r = q.data;
  const pending = r?.status === 'sent';
  const value = (lineId: number, requested: number) => amounts[lineId] ?? String(requested);

  const accept = async () => {
    if (!r) return;
    const lines = r.lines.map((l) => ({ lineId: l.id, quantity: Number(value(l.id, l.requestedQuantity).replace(',', '.')) }));
    if (lines.some((l) => !Number.isFinite(l.quantity) || l.quantity < 0)) return setError('Количество должно быть числом от нуля.');
    if (lines.every((l) => l.quantity === 0)) return setError('Ничего не принято. Если товар не приехал, отклоните заявку.');
    setError(null);
    await run(() => api.post<SupplierRequest>(`/supplier-requests/${id}/accept`, { lines }), (res) =>
      res.partial ? `Принято частично, партии на складе (${res.supplyNumber})` : `Заявка принята, партии на складе (${res.supplyNumber})`);
  };

  const reject = async () => {
    if (reason.trim().length < 3) return setError('Напишите причину отказа.');
    setError(null);
    const ok = await run(() => api.post(`/supplier-requests/${id}/reject`, { reason }), 'Заявка отклонена');
    if (ok) setRejecting(false);
  };

  return (
    <Modal
      title={r ? `Заявка ${r.number}` : 'Заявка'}
      onClose={onClose}
      size="md"
      footer={
        pending ? (
          rejecting ? (
            <>
              <button className="btn" onClick={() => setRejecting(false)}>
                Назад
              </button>
              <button className="btn btn--red" disabled={busy} onClick={reject}>
                Отклонить заявку
              </button>
            </>
          ) : (
            <>
              <button className="btn btn--red" disabled={busy} onClick={() => setRejecting(true)}>
                Отклонить
              </button>
              <button className="btn btn--green" disabled={busy} onClick={accept}>
                <Icon name="check" /> Принять на склад
              </button>
            </>
          )
        ) : r?.supplyId ? (
          <button className="btn" onClick={() => (onClose(), navigate('supplies', r.supplyId))}>
            Открыть поставку {r.supplyNumber}
          </button>
        ) : undefined
      }
    >
      <Loadable q={q}>
        {(r) => (
          <>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <Tag kind={REQUEST_TAG[r.status]}>{r.partial ? 'Принята частично' : REQUEST_STATUS[r.status]}</Tag>
              <span>
                <b>{r.supplierName}</b>, отправлена {dateShort(r.createdAt, tz)}
              </span>
              {r.decidedAt && (
                <span className="muted">
                  {r.status === 'accepted' ? 'Принял' : 'Отклонил'}: {r.decidedBy}, {dateShort(r.decidedAt, tz)}
                </span>
              )}
            </div>
            {r.comment && <p style={{ margin: 0 }}>Комментарий поставщика: {r.comment}</p>}
            {r.rejectionReason && <p style={{ margin: 0, color: 'var(--crit)' }}>Причина отказа: {r.rejectionReason}</p>}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th className="num">Заявлено</th>
                    <th className="num">{pending ? 'Принять фактически' : 'Принято'}</th>
                    <th>Годен до</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <b>{l.productName}</b>
                      </td>
                      <td className="num">{qty(l.requestedQuantity, l.unit)}</td>
                      <td className="num">
                        {pending ? (
                          <label className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                            <input
                              className="input"
                              style={{ width: 90, textAlign: 'right' }}
                              inputMode="decimal"
                              value={value(l.id, l.requestedQuantity)}
                              disabled={rejecting}
                              onChange={(e) => setAmounts({ ...amounts, [l.id]: e.target.value })}
                              aria-label={`${l.productName}: принято, ${unitLabel(l.unit)}`}
                            />
                            <span className="muted">{unitLabel(l.unit)}</span>
                          </label>
                        ) : l.acceptedQuantity === null ? (
                          '—'
                        ) : (
                          <b style={{ color: l.acceptedQuantity < l.requestedQuantity ? 'var(--warn)' : undefined }}>
                            {qty(l.acceptedQuantity, l.unit)} из {qty(l.requestedQuantity, l.unit)}
                          </b>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{humanDate(l.expiresAt, tz, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pending && !rejecting && (
              <p className="muted" style={{ margin: 0 }}>
                Если привезли меньше, укажите фактическое количество. Поставьте 0, если товар не приехал совсем.
              </p>
            )}
            {rejecting && (
              <label className="field">
                Причина отказа (её увидит поставщик)
                <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus />
              </label>
            )}
            {error && (
              <div className="toast toast--error" role="alert">
                <span>{error}</span>
              </div>
            )}
          </>
        )}
      </Loadable>
    </Modal>
  );
}
