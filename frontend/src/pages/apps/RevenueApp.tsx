import { useState } from 'react';
import { RichText } from '../../components/RichText';
import { BarList, Card, Cost, Empty, ErrorBox, FilePick, Loading } from '../../components/ui';
import { api, type RevenueResult } from '../../lib/api';
import { errMsg, money } from '../../lib/format';

/** share có thể là 0–1 hoặc 0–100; đưa về phần trăm. */
function sharePct(share: number): number {
  return share <= 1 ? share * 100 : share;
}

function PeriodChart({ data }: { data: RevenueResult['by_period'] }) {
  if (!data.length) return <Empty />;
  const max = Math.max(...data.map((d) => d.total), 1);
  const w = 100 / data.length;
  return (
    <div className="period-chart">
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label="Doanh thu theo kỳ">
        {data.map((d, i) => {
          const h = (d.total / max) * 46;
          return (
            <rect key={i} x={i * w + w * 0.15} y={50 - h} width={w * 0.7} height={h} rx={0.8} fill="#1D4ED8">
              <title>
                {d.period}: {money(d.total)}
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="period-labels">
        {data.map((d, i) => (
          <span key={i} style={{ width: w + '%' }} title={`${d.period}: ${money(d.total)}`}>
            {d.period}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function RevenueApp() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<RevenueResult | null>(null);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setErr('');
    setRes(null);
    try {
      setRes(await api.revenue(file));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const maxShare = res ? Math.max(...res.groups.map((g) => sharePct(g.share)), 1) : 1;

  return (
    <div className="stack">
      <div className="grid-io">
        <Card title="File doanh thu">
          <div className="form">
            <FilePick accept=".csv,.xlsx,.xls" file={file} onFile={setFile} hint="Nhận: CSV, Excel (.xlsx)" />
            <ErrorBox>{err}</ErrorBox>
            <div>
              <button type="button" className="btn btn-primary" disabled={!file || busy} onClick={() => void run()}>
                {busy ? 'Đang phân tích…' : 'Phân tích'}
              </button>
            </div>
            {res && res.columns.length > 0 && (
              <p className="small muted" style={{ margin: 0 }}>
                Các cột đọc được: {res.columns.join(', ')}
              </p>
            )}
          </div>
        </Card>
        <Card title="Kết quả">
          {busy ? (
            <Loading text="Đang phân tích…" />
          ) : !res ? (
            <Empty>Kết quả hiện ở đây sau khi phân tích file.</Empty>
          ) : (
            <>
              <div className="grid4 tight">
                <div>
                  <div className="kpi-label">Tổng doanh thu</div>
                  <div className="kpi-val">{money(res.total)}</div>
                </div>
                <div>
                  <div className="kpi-label">Nhóm theo</div>
                  <div className="kpi-sub">{res.group_by ?? '—'}</div>
                </div>
                <div>
                  <div className="kpi-label">Cột giá trị</div>
                  <div className="kpi-sub">{res.value_col ?? '—'}</div>
                </div>
              </div>
              <h3 className="h3">Tỷ trọng theo nhóm</h3>
              <BarList
                items={res.groups.map((g) => ({
                  key: g.name,
                  label: g.name,
                  value: sharePct(g.share),
                  max: maxShare,
                  text: `${money(g.total)} · ${sharePct(g.share).toFixed(1).replace('.', ',')}%`,
                }))}
              />
              {res.by_period.length > 0 && (
                <>
                  <h3 className="h3">Theo kỳ</h3>
                  <PeriodChart data={res.by_period} />
                </>
              )}
              {res.commentary && (
                <>
                  <h3 className="h3">Nhận xét</h3>
                  <RichText text={res.commentary} />
                </>
              )}
              <Cost v={res.cost_vnd} />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
