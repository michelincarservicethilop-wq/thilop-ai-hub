import { useState } from 'react';
import { Card, Dialog, Empty, ErrorBox, Field, Loading, Table, Tag } from '../../components/ui';
import { api, type LogRow } from '../../lib/api';
import { APP_LABELS, appLabel, money, num } from '../../lib/format';
import { useAsync } from '../../lib/hooks';

const PAGE = 50;
const STATUS: Record<string, string> = { ok: 'Thành công', error: 'Lỗi', blocked: 'Bị chặn' };

function statusTag(s: string) {
  if (s === 'ok') return <Tag kind="ok">{STATUS.ok}</Tag>;
  if (s === 'blocked') return <Tag kind="warn">{STATUS.blocked}</Tag>;
  return <Tag kind="err">{STATUS[s] ?? s}</Tag>;
}

export default function LogsTab() {
  const [app, setApp] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<LogRow | null>(null);
  const logs = useAsync(() => api.logs({ limit: PAGE, offset, app: app || undefined, status: status || undefined }), [app, status, offset]);
  const rows = logs.data ?? [];

  return (
    <Card title="Nhật ký lượt gọi">
      <div className="report-filters">
        <Field label="Mảng">
          <select
            className="field"
            value={app}
            onChange={(e) => {
              setApp(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Tất cả</option>
            {Object.entries(APP_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trạng thái">
          <select
            className="field"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Tất cả</option>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {logs.loading && !logs.data ? (
        <Loading />
      ) : logs.error ? (
        <ErrorBox>{logs.error}</ErrorBox>
      ) : rows.length === 0 ? (
        <Empty />
      ) : (
        <Table minWidth={900}>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Người dùng</th>
              <th>Mảng</th>
              <th>Model</th>
              <th className="num">Token</th>
              <th className="num">Chi phí</th>
              <th className="num">Thời gian chạy</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setOpen(r)}>
                <td className="nowrap">
                  <button type="button" className="linkish" onClick={(e) => (e.stopPropagation(), setOpen(r))}>
                    {r.time}
                  </button>
                </td>
                <td>
                  {r.user}
                  {r.branch && <div className="small muted">{r.branch}</div>}
                </td>
                <td>
                  {appLabel(r.app)}
                  {r.feature && <div className="small muted">{r.feature}</div>}
                </td>
                <td>
                  {r.model_used ?? '—'}
                  {r.cache_hit && (
                    <div>
                      <Tag kind="info">Cache</Tag>
                    </div>
                  )}
                </td>
                <td className="num">{num(r.input_tokens + r.output_tokens)}</td>
                <td className="num">{money(r.cost_vnd)}</td>
                <td className="num">{r.latency_ms !== null ? `${num(r.latency_ms)} ms` : '—'}</td>
                <td>{statusTag(r.status)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <div className="pager">
        <button type="button" className="btn btn-ghost btn-sm" disabled={offset === 0 || logs.loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          ← Trang trước
        </button>
        <span className="small muted">Trang {Math.floor(offset / PAGE) + 1}</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={rows.length < PAGE || logs.loading} onClick={() => setOffset(offset + PAGE)}>
          Trang sau →
        </button>
      </div>

      <Dialog open={!!open} title={open ? `Lượt gọi #${open.id}` : ''} onClose={() => setOpen(null)} wide>
        {open && (
          <div>
            {(
              [
                ['Thời gian', open.time],
                ['Người dùng', open.user + (open.branch ? ' · ' + open.branch : '')],
                ['Mảng', appLabel(open.app) + (open.feature ? ' · ' + open.feature : '')],
                ['Model yêu cầu', open.model_requested ?? '—'],
                ['Model đã dùng', open.model_used ?? '—'],
                ['Loại việc', open.task ?? '—'],
                ['Token vào / ra / cache', `${num(open.input_tokens)} / ${num(open.output_tokens)} / ${num(open.cached_tokens)}`],
                ['Đơn vị khác', open.units !== null ? num(open.units) : '—'],
                ['Chi phí', money(open.cost_vnd)],
                ['Trả từ cache', open.cache_hit ? 'Có' : 'Không'],
                ['Thời gian chạy', open.latency_ms !== null ? `${num(open.latency_ms)} ms` : '—'],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div className="kv" key={k}>
                <div className="muted">{k}</div>
                <div>{v}</div>
              </div>
            ))}
            <div className="kv">
              <div className="muted">Trạng thái</div>
              <div>{statusTag(open.status)}</div>
            </div>
            {open.error && (
              <>
                <h3 className="h3">Lỗi</h3>
                <div className="script err-text">{open.error}</div>
              </>
            )}
            <h3 className="h3">Trích nội dung</h3>
            {open.excerpt ? <div className="script">{open.excerpt}</div> : <Empty>Không lưu nội dung (hoặc đã tắt lưu nội dung).</Empty>}
          </div>
        )}
      </Dialog>
    </Card>
  );
}
