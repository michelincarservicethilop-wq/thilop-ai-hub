import { useEffect, useState, type FormEvent } from 'react';
import { Card, CopyButton, ErrorBox, Field, Loading, Note, Switch, Tag } from '../../components/ui';
import { api, type SettingsValues } from '../../lib/api';
import { errMsg, intOrNull } from '../../lib/format';
import { useAsync } from '../../lib/hooks';

const SECRETS: { key: string; label: string }[] = [
  { key: 'anthropic', label: 'Anthropic (Claude)' },
  { key: 'openai', label: 'OpenAI (GPT)' },
  { key: 'gemini', label: 'Google Gemini' },
  { key: 'deepseek', label: 'DeepSeek' },
  { key: 'fpt_tts', label: 'FPT.AI giọng đọc' },
  { key: 'telegram', label: 'Telegram (cảnh báo)' },
  { key: 'messenger', label: 'Messenger (fanpage)' },
  { key: 'zalo', label: 'Zalo OA' },
];

interface Form {
  usd_vnd_rate: string;
  company_monthly_limit_vnd: string;
  company_daily_limit_vnd: string;
  store_content: boolean;
  cache_ttl_hours: string;
  web_rpm_limit: string;
  telegram_admin_chat_id: string;
  tts_price: string;
}

function toForm(v: SettingsValues): Form {
  const s = (x: number | null | undefined) => (x === null || x === undefined ? '' : String(x));
  return {
    usd_vnd_rate: s(v.usd_vnd_rate),
    company_monthly_limit_vnd: s(v.company_monthly_limit_vnd),
    company_daily_limit_vnd: s(v.company_daily_limit_vnd),
    store_content: !!v.store_content,
    cache_ttl_hours: s(v.cache_ttl_hours),
    web_rpm_limit: s(v.web_rpm_limit),
    telegram_admin_chat_id: v.telegram_admin_chat_id ?? '',
    tts_price: s(v.tts?.price_per_1000_chars_vnd),
  };
}

export default function SettingsTab() {
  const s = useAsync(() => api.settings(), []);
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (s.data) setF(toForm(s.data.values));
  }, [s.data]);

  if (s.loading && !s.data) return <Loading />;
  if (!s.data || !f) return <ErrorBox>{s.error}</ErrorBox>;
  const data = s.data;

  const set = (k: keyof Form, v: string | boolean) => {
    setF({ ...f, [k]: v });
    setMsg('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const rate = intOrNull(f.usd_vnd_rate);
    if (!rate || rate < 1000) return setErr('Tỷ giá USD/VND chưa đúng.');
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const r = await api.saveSettings({
        usd_vnd_rate: rate,
        company_monthly_limit_vnd: intOrNull(f.company_monthly_limit_vnd),
        company_daily_limit_vnd: intOrNull(f.company_daily_limit_vnd),
        store_content: f.store_content,
        cache_ttl_hours: intOrNull(f.cache_ttl_hours) ?? 24,
        web_rpm_limit: intOrNull(f.web_rpm_limit) ?? 30,
        telegram_admin_chat_id: f.telegram_admin_chat_id.trim(),
        tts: { ...data.values.tts, price_per_1000_chars_vnd: intOrNull(f.tts_price) ?? 0 },
      });
      s.setData(r);
      setMsg('Đã lưu cài đặt.');
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-wide">
      <Card title="Cài đặt chung">
        <form className="form" onSubmit={submit}>
          <div className="form-row2">
            <Field label="Tỷ giá USD → VND" hint="Dùng đổi giá hãng AI ra tiền Việt">
              <input className="field" inputMode="numeric" value={f.usd_vnd_rate} onChange={(e) => set('usd_vnd_rate', e.target.value)} />
            </Field>
            <Field label="Thời gian giữ cache (giờ)" hint="Câu hỏi trùng trong thời gian này trả lại kết quả cũ, không tốn tiền">
              <input className="field" inputMode="numeric" value={f.cache_ttl_hours} onChange={(e) => set('cache_ttl_hours', e.target.value)} />
            </Field>
          </div>
          <div className="form-row2">
            <Field label="Hạn mức công ty mỗi tháng (đ)" hint="Để trống: không giới hạn">
              <input
                className="field"
                inputMode="numeric"
                value={f.company_monthly_limit_vnd}
                onChange={(e) => set('company_monthly_limit_vnd', e.target.value)}
              />
            </Field>
            <Field label="Hạn mức công ty mỗi ngày (đ)" hint="Để trống: không giới hạn">
              <input
                className="field"
                inputMode="numeric"
                value={f.company_daily_limit_vnd}
                onChange={(e) => set('company_daily_limit_vnd', e.target.value)}
              />
            </Field>
          </div>
          <div className="form-row2">
            <Field label="Số lượt mỗi phút cho mỗi người trên web">
              <input className="field" inputMode="numeric" value={f.web_rpm_limit} onChange={(e) => set('web_rpm_limit', e.target.value)} />
            </Field>
            <Field label="Telegram chat ID của quản trị" hint="Nhận cảnh báo hạn mức toàn công ty">
              <input className="field" value={f.telegram_admin_chat_id} onChange={(e) => set('telegram_admin_chat_id', e.target.value)} />
            </Field>
          </div>
          <div className="form-row2">
            <Field label="Giá giọng đọc (đ / 1.000 ký tự)" hint="Theo bảng giá FPT.AI anh đang dùng; để 0 thì giọng đọc không tính vào hạn mức">
              <input className="field" inputMode="numeric" value={f.tts_price} onChange={(e) => set('tts_price', e.target.value)} />
            </Field>
          </div>
          <div className="mrow-line" style={{ borderBottom: 0 }}>
            <div>
              <div>Lưu trích nội dung vào nhật ký</div>
              <div className="small muted">Giúp tra soát khi có lỗi. Tắt nếu không muốn lưu nội dung người dùng gửi.</div>
            </div>
            <Switch label="Lưu trích nội dung vào nhật ký" checked={f.store_content} onChange={(v) => set('store_content', v)} />
          </div>
          <ErrorBox>{err}</ErrorBox>
          {msg && <Note>{msg}</Note>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Đang lưu…' : 'Lưu cài đặt'}
            </button>
          </div>
        </form>
      </Card>
      <div className="stack">
        <Card title="Kết nối">
          {SECRETS.map((x) => (
            <div className="mrow-line" key={x.key}>
              <span>{x.label}</span>
              {data.secrets_configured?.[x.key] ? <Tag kind="ok">Đã cấu hình</Tag> : <Tag kind="off">Chưa cấu hình</Tag>}
            </div>
          ))}
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            Key hãng AI, token fanpage, Zalo, Telegram đặt trong file <span className="mono">.env</span> trên máy chủ, không nhập ở đây.
          </p>
        </Card>
        <Card title="Địa chỉ webhook">
          <div className="fld-label">Messenger (dán vào Meta for Developers)</div>
          <div className="keybox">
            <div className="codebox mono">{data.webhooks.messenger}</div>
            <CopyButton text={data.webhooks.messenger} small />
          </div>
          <div className="fld-label" style={{ marginTop: 12 }}>
            Zalo OA (dán vào Zalo for Developers)
          </div>
          <div className="keybox">
            <div className="codebox mono">{data.webhooks.zalo}</div>
            <CopyButton text={data.webhooks.zalo} small />
          </div>
        </Card>
      </div>
    </div>
  );
}
