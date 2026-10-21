import { BarList, Card, Empty, ErrorBox, Loading, PageHead, Progress, Table, Tag } from '../components/ui';
import { api } from '../lib/api';
import { isManagerRole, useMe } from '../lib/auth';
import { appLabel, money, num, pct } from '../lib/format';
import { useAsync, useInterval, useTitle } from '../lib/hooks';

const APP_ORDER = ['chat', 'apps', 'studio', 'inbox', 'api'];

export default function OverviewPage() {
  useTitle('Tổng quan');
  const { user } = useMe();
  const mgr = isManagerRole(user.role);
  const { data: o, error, loading, reload } = useAsync(() => api.overview(), []);
  useInterval(() => void reload(), 30_000);

  const subtitle = o ? `Chi phí và mức dùng AI · ${o.scope}` : 'Chi phí và mức dùng AI';

  if (loading && !o)
    return (
      <>
        <PageHead title="Tổng quan" subtitle={subtitle} />
        <Loading />
      </>
    );
  if (!o)
    return (
      <>
        <PageHead title="Tổng quan" subtitle={subtitle} />
        <ErrorBox>{error}</ErrorBox>
      </>
    );

  const monthPct = pct(o.month_used_vnd, o.month_limit_vnd);
  const order = (k: string) => (APP_ORDER.includes(k) ? APP_ORDER.indexOf(k) : 99);
  const appCalls = Object.entries(o.calls_by_app).sort((a, b) => order(a[0]) - order(b[0]));
  const maxApp = Math.max(0, ...o.by_app.map((a) => a.cost_vnd));
  const totalApp = o.by_app.reduce((s, a) => s + a.cost_vnd, 0);
  const maxBranch = Math.max(0, ...o.by_branch.map((b) => Math.max(b.used_vnd, b.limit_vnd ?? 0)));
  const botRate = o.inbox.messages_today ? Math.round((o.inbox.bot_replies / o.inbox.messages_today) * 100) : 0;

  return (
    <>
      <PageHead title="Tổng quan" subtitle={subtitle} />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="stack">
        <div className="grid4">
          <div className="card">
            <div className="kpi-label">Chi phí AI tháng này</div>
            <div className="kpi-val">{money(o.month_used_vnd)}</div>
            {o.month_limit_vnd ? (
              <>
                <div style={{ marginTop: 10 }}>
                  <Progress value={monthPct} warn={monthPct >= 80} label="Mức dùng hạn mức tháng" />
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  {Math.round(monthPct)}% hạn mức {money(o.month_limit_vnd)}
                </div>
              </>
            ) : (
              <div className="small muted" style={{ marginTop: 6 }}>
                Chưa đặt hạn mức tháng
              </div>
            )}
          </div>
          <div className="card">
            <div className="kpi-label">Lượt gọi hôm nay</div>
            <div className="kpi-val">{num(o.calls_today)}</div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {appCalls.length ? appCalls.map(([k, v]) => `${appLabel(k)} ${num(v)}`).join(' · ') : 'Chưa có lượt nào'}
            </div>
          </div>
          <div className="card">
            <div className="kpi-label">Trả từ cache hôm nay</div>
            <div className="kpi-val">{num(o.cache_rate_today)}%</div>
            <div className="small muted" style={{ marginTop: 6 }}>
              Số lượt không phải gọi lại hãng AI
            </div>
          </div>
          <div className="card">
            <div className="kpi-label">Người dùng hoạt động</div>
            <div className="kpi-val">
              {num(o.active_users_7d)} / {num(o.total_users)}
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              Trong 7 ngày qua
            </div>
          </div>
          {mgr && (
            <div className="card">
              <div className="kpi-label">Tin nhắn khách hôm nay</div>
              <div className="kpi-val">{num(o.inbox.messages_today)}</div>
              <div className="small muted" style={{ marginTop: 6 }}>
                Bot trả lời {num(o.inbox.bot_replies)}
                {o.inbox.messages_today ? ` (${botRate}%)` : ''} · {num(o.inbox.handoffs)} lần chuyển người
              </div>
            </div>
          )}
        </div>

        <div className="grid2">
          {mgr && (
            <Card title="Chi phí theo cơ sở · tháng này">
              <BarList
                items={o.by_branch.map((b) => {
                  const p = pct(b.used_vnd, b.limit_vnd);
                  return {
                    key: b.id,
                    label: b.name,
                    value: b.used_vnd,
                    max: b.limit_vnd || maxBranch || 1,
                    text: money(b.used_vnd) + (b.limit_vnd ? ` / ${Math.round(p)}%` : ''),
                    warn: !!b.limit_vnd && p >= 80,
                  };
                })}
              />
              <p className="small muted" style={{ margin: '10px 0 0' }}>
                Thanh so với hạn mức tháng của từng cơ sở; màu cam khi dùng từ 80%.
              </p>
            </Card>
          )}
          <Card title="Chi phí theo mảng · tháng này">
            <BarList
              items={o.by_app
                .slice()
                .sort((a, b) => b.cost_vnd - a.cost_vnd)
                .map((a) => ({
                  key: a.app,
                  label: appLabel(a.app),
                  value: a.cost_vnd,
                  max: maxApp || 1,
                  text: money(a.cost_vnd) + (totalApp ? ` · ${Math.round((a.cost_vnd / totalApp) * 100)}%` : ''),
                }))}
            />
            {mgr && (
              <>
                <h2 className="h2" style={{ marginTop: 18 }}>
                  Cảnh báo
                </h2>
                {o.alerts.length === 0 ? (
                  <Empty>Không có cảnh báo nào.</Empty>
                ) : (
                  o.alerts.map((a, i) => (
                    <div key={i} className={'alert' + (a.level === 'info' ? ' info' : '')}>
                      <span className="dot" aria-hidden="true" />
                      <div>
                        <div>{a.message}</div>
                        <div className="small muted">{a.time}</div>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </Card>
        </div>

        <Card title="Lượt gọi gần đây">
          {o.recent.length === 0 ? (
            <Empty />
          ) : (
            <Table minWidth={720}>
              <thead>
                <tr>
                  <th>Giờ</th>
                  <th>Người dùng</th>
                  <th>Mảng</th>
                  <th>Model</th>
                  <th className="num">Token</th>
                  <th className="num">Chi phí</th>
                  <th>Cache</th>
                </tr>
              </thead>
              <tbody>
                {o.recent.map((r, i) => (
                  <tr key={i}>
                    <td className="muted">{r.time}</td>
                    <td>{r.user}</td>
                    <td>
                      {appLabel(r.app)}
                      {r.feature && r.feature !== r.app ? <span className="muted"> · {r.feature}</span> : null}
                    </td>
                    <td>{r.model ?? '—'}</td>
                    <td className="num">{num(r.tokens)}</td>
                    <td className="num">{money(r.cost_vnd)}</td>
                    <td>
                      {r.status !== 'ok' ? (
                        <Tag kind="err">Lỗi</Tag>
                      ) : r.cache_hit ? (
                        <Tag kind="ok">Có</Tag>
                      ) : (
                        <Tag kind="off">Không</Tag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
