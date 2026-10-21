import { useEffect, useState, type FormEvent } from 'react';
import { Card, CopyButton, Cost, Empty, ErrorBox, Field, Loading, Note, PageHead, Pills, Tabs } from '../components/ui';
import { api, withToken, type ScriptResult, type TtsResult } from '../lib/api';
import { useAuth, useMe } from '../lib/auth';
import { errMsg, num } from '../lib/format';
import { useAsync, useTitle } from '../lib/hooks';

type Tab = 'script' | 'tts';
type Platform = 'tiktok' | 'fanpage' | 'zalo';

const SERVICES = ['Thay lốp', 'Keo chống đinh', 'Ắc quy', 'Bảo dưỡng', 'Khuyến mãi'];
const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'fanpage', label: 'Fanpage' },
  { value: 'zalo', label: 'Zalo OA' },
];
const LENGTHS = [15, 30, 45, 60];
const MAX_CHARS = 5000;

export default function StudioPage() {
  useTitle('Studio nội dung');
  const [tab, setTab] = useState<Tab>('script');
  return (
    <>
      <PageHead title="Studio nội dung" subtitle="Kịch bản, caption và giọng đọc cho TikTok, fanpage" />
      <Tabs
        label="Công cụ Studio"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'script', label: 'Kịch bản & caption' },
          { value: 'tts', label: 'Giọng đọc' },
        ]}
      />
      {tab === 'script' ? <ScriptTab /> : <TtsTab />}
    </>
  );
}

function ScriptTab() {
  const { user } = useMe();
  const [service, setService] = useState(SERVICES[0]);
  const [platform, setPlatform] = useState<Platform>('tiktok');
  const [length, setLength] = useState(30);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<ScriptResult | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      setRes(
        await api.script({
          service,
          platform,
          length_sec: length,
          branch_id: user.branch_id,
          notes: notes.trim() || undefined,
        }),
      );
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  const tags = res ? res.hashtags.map((h) => (h.startsWith('#') ? h : '#' + h)).join(' ') : '';

  return (
    <div className="grid2">
      <Card title="Viết kịch bản & caption">
        <form className="form" onSubmit={submit}>
          <div>
            <div className="fld-label">Dịch vụ</div>
            <Pills label="Dịch vụ" value={service} onChange={setService} options={SERVICES.map((s) => ({ value: s, label: s }))} />
          </div>
          <div>
            <div className="fld-label">Đăng lên</div>
            <Pills label="Nền tảng" value={platform} onChange={setPlatform} options={PLATFORMS} />
          </div>
          <Field label="Độ dài video">
            <select className="field" value={length} onChange={(e) => setLength(Number(e.target.value))}>
              {LENGTHS.map((l) => (
                <option key={l} value={l}>
                  {l} giây
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ghi chú (không bắt buộc)">
            <textarea
              className="field"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ví dụ: nhấn mạnh tặng cân bằng động, giọng vui vẻ"
            />
          </Field>
          <ErrorBox>{err}</ErrorBox>
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Đang viết…' : 'Viết kịch bản'}
            </button>
          </div>
        </form>
      </Card>
      <Card title="Kết quả">
        {busy ? (
          <Loading text="Đang viết kịch bản…" />
        ) : !res ? (
          <Empty>Kịch bản, caption và hashtag hiện ở đây.</Empty>
        ) : (
          <div className="stack-sm">
            <div>
              <div className="result-head">
                <h3 className="h3">Kịch bản</h3>
                <CopyButton text={res.script} small />
              </div>
              <div className="script">{res.script}</div>
            </div>
            <div>
              <div className="result-head">
                <h3 className="h3">Caption</h3>
                <CopyButton text={res.caption} small />
              </div>
              <div className="script">{res.caption}</div>
            </div>
            <div>
              <div className="result-head">
                <h3 className="h3">Hashtag</h3>
                <CopyButton text={tags} small />
              </div>
              <div className="script">{tags || '—'}</div>
            </div>
            <Cost v={res.cost_vnd} />
          </div>
        )}
      </Card>
    </div>
  );
}

function TtsTab() {
  const { refresh } = useAuth();
  const voices = useAsync(() => api.voices(), []);
  const [text, setText] = useState(
    'Đinh cắm vào lốp giữa đường? Với keo chống đinh của Thi Lốp, lốp tự vá kín lỗ nhỏ, xe vẫn chạy tiếp an toàn tới gara gần nhất.',
  );
  const [voice, setVoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<TtsResult | null>(null);

  useEffect(() => {
    if (!voice && voices.data?.length) {
      const first = voices.data.find((v) => v.available) ?? voices.data[0];
      setVoice(first.id);
    }
  }, [voices.data, voice]);

  const unavailable = (voices.data ?? []).filter((v) => !v.available);
  const over = text.length > MAX_CHARS;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || over || !voice) return;
    setBusy(true);
    setErr('');
    setRes(null);
    try {
      setRes(await api.tts(text.trim(), voice));
      void refresh();
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-wide">
      <Card title="Giọng đọc tiếng Việt">
        <form className="form" onSubmit={submit}>
          <label className="sr" htmlFor="tts-text">
            Văn bản cần đọc
          </label>
          <textarea id="tts-text" className="field" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row-between">
            <span className={'small ' + (over ? 'err-text' : 'muted')} aria-live="polite">
              {num(text.length)} / {num(MAX_CHARS)} ký tự
            </span>
            <button type="submit" className="btn btn-primary" disabled={busy || !text.trim() || over || !voice}>
              {busy ? 'Đang đọc…' : 'Đọc thử'}
            </button>
          </div>
          <ErrorBox>{err}</ErrorBox>
        </form>
        {res && (
          <div className="tts-result">
            <audio controls src={withToken(res.url)} preload="metadata">
              Trình duyệt không phát được âm thanh.
            </audio>
            <div className="row-between">
              <a className="btn btn-ghost btn-sm" href={withToken(res.url)} download>
                Tải file
              </a>
              <span className="small muted">{num(res.chars)} ký tự</span>
            </div>
            {res.cached && <Note>Đoạn này đã đọc trước đó, đã lưu, không tính tiền lại.</Note>}
            <Cost v={res.cost_vnd} />
          </div>
        )}
      </Card>
      <Card title="Chọn giọng">
        {voices.loading && !voices.data ? (
          <Loading />
        ) : voices.error ? (
          <ErrorBox>{voices.error}</ErrorBox>
        ) : (voices.data ?? []).length === 0 ? (
          <Empty />
        ) : (
          <>
            <Pills
              label="Giọng đọc"
              value={voice}
              onChange={setVoice}
              options={(voices.data ?? []).map((v) => ({
                value: v.id,
                label: v.label,
                disabled: !v.available,
                title: v.available ? v.label : 'Chưa dùng được: chưa cấu hình nhà cung cấp',
              }))}
            />
            {unavailable.length > 0 && (
              <p className="small muted" style={{ margin: '10px 0 0' }}>
                Giọng mờ là giọng chưa dùng được vì máy chủ chưa cấu hình key nhà cung cấp. Báo quản trị nếu cần.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
