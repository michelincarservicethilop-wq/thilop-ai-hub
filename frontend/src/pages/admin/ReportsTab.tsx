import { useState } from 'react';
import { BarList, Card, Empty, ErrorBox, Field, Loading, Table } from '../../components/ui';
import { api, type UsageGroup, type UsageReport } from '../../lib/api';
import { appLabel, money, num } from '../../lib/format';
import { useAsync } from '../../lib/hooks';

const GROUPS: { value: UsageGroup; label: string }[] = [
  { value: 'branch', label: 'Theo cơ sở' },
  { value: 'user', label: 'Theo người dùng' },
  { value: 'app', label: 'Theo mảng' },
  { value: 'model', label: 'Theo model' },
  { value: 'day', label: 'Theo ngày' },
  { value: 'feature', label: 'Theo tính năng' },
];

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function rowName(group: UsageGroup, name: string | null): string {
  if (!name) return 'Không rõ';
  return group === 'app' ? appLabel(name) : name;
}

function downloadCsv(report: UsageReport) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = ['Tên', 'Lượt gọi', 'Token vào', 'Token ra', 'Chi phí (đ)', 'Lượt trả từ cache'];
  const lines = [head.map(esc).join(',')];
  for (const r of report.rows) {
    lines.push(
      [rowName(report.group, r.name), r.calls, r.input_tokens, r.output_tokens, Math.round(r.cost_vnd), r.cache_hits].map(esc).join(','),
    );
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bao-cao-${report.group}-${report.from}-${report.to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReportsTab() {
  const today = new Date();
  const [group, setGroup] = useState<UsageGroup>('branch');
  const [from, setFrom] = useState(isoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(isoDate(today));
  const [query, setQuery] = useState({ group, from, to });
  const rep = useAsync(() => api.usage(query.group, query.from, query.to), [query]);

  const r = rep.data;
  const rows = r?.rows ?? [];
  const total = rows.reduce((s, x) => s + x.cost_vnd, 0);
  const totalCalls = rows.reduce((s, x) => s + x.calls, 0);
  const max = Math.max(0, ...rows.map((x) => x.cost_vnd));

  return (
    <div className="stack">
      <Card title="Báo cáo chi phí">
        <form
          className="report-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery({ group, from, to });
          }}
        >
          <Field label="Nhóm theo">
            <select className="field" value={group} onChange={(e) => setGroup(e.target.value as UsageGroup)}>
              {GROUPS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Từ ngày">
            <input className="field" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required />
          </Field>
          <Field label="Đến ngày">
            <input className="field" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required />
          </Field>
          <div className="report-btns">
            <button type="submit" className="btn btn-primary" disabled={rep.loading}>
              Xem báo cáo
            </button>
            <button type="button" className="btn btn-ghost" disabled={!r || rows.length === 0} onClick={() => r && downloadCsv(r)}>
              Tải CSV
            </button>
          </div>
        </form>
      </Card>

      {rep.loading && !r ? (
        <Loading />
      ) : rep.error ? (
        <ErrorBox>{rep.error}</ErrorBox>
      ) : !r || rows.length === 0 ? (
        <Card>
          <Empty>Chưa có dữ liệu trong khoảng thời gian này.</Empty>
        </Card>
      ) : (
        <div className="grid-wide">
          <Card title={`${GROUPS.find((g) => g.value === r.group)?.label ?? ''} · ${r.from} đến ${r.to}`}>
            <Table minWidth={640}>
              <thead>
                <tr>
                  <th>Tên</th>
                  <th className="num">Lượt gọi</th>
                  <th className="num">Token vào</th>
                  <th className="num">Token ra</th>
                  <th className="num">Cache</th>
                  <th className="num">Chi phí</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x, i) => (
                  <tr key={i}>
                    <td>{rowName(r.group, x.name)}</td>
                    <td className="num">{num(x.calls)}</td>
                    <td className="num">{num(x.input_tokens)}</td>
                    <td className="num">{num(x.output_tokens)}</td>
                    <td className="num">{num(x.cache_hits)}</td>
                    <td className="num">{money(x.cost_vnd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Tổng</td>
                  <td className="num">{num(totalCalls)}</td>
                  <td />
                  <td />
                  <td />
                  <td className="num">{money(total)}</td>
                </tr>
              </tfoot>
            </Table>
          </Card>
          <Card title="Chi phí so sánh">
            <BarList
              items={rows.slice(0, 15).map((x, i) => ({
                key: i,
                label: rowName(r.group, x.name),
                value: x.cost_vnd,
                max: max || 1,
                text: money(x.cost_vnd),
              }))}
            />
            {rows.length > 15 && <p className="small muted">Hiện 15 dòng đầu; bảng bên cạnh có đủ.</p>}
          </Card>
        </div>
      )}
    </div>
  );
}
