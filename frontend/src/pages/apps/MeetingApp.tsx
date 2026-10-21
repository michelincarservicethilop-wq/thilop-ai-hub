import { useEffect, useRef, useState } from 'react';
import { RichText } from '../../components/RichText';
import { Card, Empty, ErrorBox, FilePick, Loading, Table, Tag } from '../../components/ui';
import { api, type JobResult } from '../../lib/api';
import { errMsg } from '../../lib/format';

const STATUS_TXT: Record<string, string> = {
  queued: 'Đang xếp hàng',
  running: 'Đang nghe và tóm tắt',
  done: 'Xong',
  error: 'Lỗi',
};

export default function MeetingApp() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobResult | null>(null);
  const timer = useRef<number | null>(null);

  // Theo dõi việc mỗi 3 giây tới khi xong hoặc lỗi
  useEffect(() => {
    if (jobId === null) return;
    let alive = true;
    const tick = async () => {
      try {
        const j = await api.job(jobId);
        if (!alive) return;
        setJob(j);
        if (j.status === 'done' || j.status === 'error') return;
      } catch (e) {
        if (!alive) return;
        setErr(errMsg(e));
      }
      timer.current = window.setTimeout(() => void tick(), 3000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [jobId]);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setErr('');
    setJob(null);
    setJobId(null);
    try {
      const r = await api.meeting(file);
      setJobId(r.job_id);
      setJob({ status: 'queued', result: null, error: null });
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const working = job && (job.status === 'queued' || job.status === 'running');
  const r = job?.status === 'done' ? job.result : null;

  return (
    <div className="grid-io">
      <Card title="File ghi âm">
        <div className="form">
          <FilePick accept="audio/*,.mp3,.m4a,.wav" file={file} onFile={setFile} hint="Nhận: MP3, M4A, WAV" />
          <ErrorBox>{err}</ErrorBox>
          <div>
            <button type="button" className="btn btn-primary" disabled={!file || busy || !!working} onClick={() => void run()}>
              {busy ? 'Đang tải lên…' : working ? 'Đang xử lý…' : 'Làm biên bản'}
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Chi phí tính theo số phút ghi âm. Ghi âm rõ, ít tiếng ồn thì biên bản chính xác hơn.
          </p>
        </div>
      </Card>
      <Card title="Biên bản" actions={job ? <Tag kind={job.status === 'done' ? 'ok' : job.status === 'error' ? 'err' : 'info'}>{STATUS_TXT[job.status] ?? job.status}</Tag> : null}>
        {working ? (
          <Loading text="Đang nghe ghi âm và tóm tắt. File dài có thể mất vài phút, anh/chị cứ để trang mở." />
        ) : job?.status === 'error' ? (
          <ErrorBox>{job.error || 'Không xử lý được file ghi âm.'}</ErrorBox>
        ) : !r ? (
          <Empty>Biên bản hiện ở đây sau khi xử lý xong.</Empty>
        ) : (
          <>
            <h3 className="h3" style={{ marginTop: 0 }}>
              Tóm tắt
            </h3>
            {r.summary ? <RichText text={r.summary} /> : <Empty />}
            <h3 className="h3">Quyết định</h3>
            {r.decisions && r.decisions.length ? (
              <ul className="list">
                {r.decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : (
              <Empty>Không có quyết định nào được ghi nhận.</Empty>
            )}
            <h3 className="h3">Việc cần làm</h3>
            {r.actions && r.actions.length ? (
              <Table minWidth={480}>
                <thead>
                  <tr>
                    <th>Việc</th>
                    <th>Người làm</th>
                    <th>Hạn</th>
                  </tr>
                </thead>
                <tbody>
                  {r.actions.map((a, i) => (
                    <tr key={i}>
                      <td>{a.task}</td>
                      <td>{a.owner || '—'}</td>
                      <td>{a.due || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Empty>Không có việc nào được giao.</Empty>
            )}
            {r.transcript && (
              <details className="details">
                <summary>Xem lời ghi đầy đủ</summary>
                <div className="script">{r.transcript}</div>
              </details>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
