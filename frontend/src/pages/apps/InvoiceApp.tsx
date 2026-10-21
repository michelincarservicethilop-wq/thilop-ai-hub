import { useState } from 'react';
import { Card, Cost, Empty, ErrorBox, FilePick, Loading, Table } from '../../components/ui';
import { api, withToken, type InvoiceResult } from '../../lib/api';
import { errMsg, money } from '../../lib/format';

function val(v: number | string | null | undefined, isMoney = false): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return isMoney ? money(v) : new Intl.NumberFormat('vi-VN').format(v);
  return v;
}

export default function InvoiceApp() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<InvoiceResult | null>(null);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setErr('');
    setRes(null);
    try {
      setRes(await api.invoice(file));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const f = res?.fields;
  return (
    <div className="grid-io">
      <Card title="Hoá đơn">
        <div className="form">
          <FilePick accept="image/*,application/pdf,.pdf" file={file} onFile={setFile} hint="Nhận: ảnh chụp (JPG, PNG) hoặc PDF" />
          <ErrorBox>{err}</ErrorBox>
          <div>
            <button type="button" className="btn btn-primary" disabled={!file || busy} onClick={() => void run()}>
              {busy ? 'Đang đọc…' : 'Đọc hoá đơn'}
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Ảnh rõ, đủ sáng, chụp thẳng thì đọc chính xác hơn. Anh/chị kiểm tra lại số liệu trước khi nhập sổ.
          </p>
        </div>
      </Card>
      <Card title="Kết quả">
        {busy ? (
          <Loading text="Đang đọc hoá đơn…" />
        ) : !res || !f ? (
          <Empty>Kết quả hiện ở đây sau khi đọc hoá đơn.</Empty>
        ) : (
          <>
            <div className="kv">
              <div className="muted">Nhà cung cấp</div>
              <div>{val(f.supplier)}</div>
            </div>
            <div className="kv">
              <div className="muted">Số hoá đơn</div>
              <div>{val(f.invoice_no)}</div>
            </div>
            <div className="kv">
              <div className="muted">Ngày</div>
              <div>{val(f.date)}</div>
            </div>
            <div className="kv">
              <div className="muted">Thuế</div>
              <div>{val(f.tax, true)}</div>
            </div>
            <div className="kv">
              <div className="muted">Tổng cộng</div>
              <div style={{ fontWeight: 600 }}>{val(f.total, true)}</div>
            </div>
            <h3 className="h3">Hàng hoá, dịch vụ</h3>
            {res.items.length === 0 ? (
              <Empty>Không đọc được dòng hàng nào.</Empty>
            ) : (
              <Table minWidth={520}>
                <thead>
                  <tr>
                    <th>Tên</th>
                    <th className="num">SL</th>
                    <th className="num">Đơn giá</th>
                    <th className="num">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {res.items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.name}</td>
                      <td className="num">{val(it.quantity)}</td>
                      <td className="num">{val(it.unit_price, true)}</td>
                      <td className="num">{val(it.amount, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {res.xlsx_url && (
              <div style={{ marginTop: 14 }}>
                <a className="btn btn-primary" href={withToken(res.xlsx_url)} download>
                  Tải file Excel
                </a>
              </div>
            )}
            <Cost v={res.cost_vnd} />
          </>
        )}
      </Card>
    </div>
  );
}
