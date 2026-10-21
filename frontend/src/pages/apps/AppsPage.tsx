import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IconBack, IconChart, IconMic, IconQuote, IconReceipt, IconSearchDoc } from '../../components/icons';
import { PageHead } from '../../components/ui';
import { useTitle } from '../../lib/hooks';
import AskApp from './AskApp';
import InvoiceApp from './InvoiceApp';
import MeetingApp from './MeetingApp';
import QuoteApp from './QuoteApp';
import RevenueApp from './RevenueApp';

interface AppDef {
  id: string;
  name: string;
  desc: string;
  icon: ReactNode;
  view: () => ReactNode;
}

const APPS: AppDef[] = [
  {
    id: 'hoi-tai-lieu',
    name: 'Hỏi tài liệu nội bộ',
    desc: 'Hỏi về bảng giá, chính sách, quy trình. Trả lời kèm nguồn trong tài liệu.',
    icon: <IconSearchDoc />,
    view: () => <AskApp />,
  },
  {
    id: 'hoa-don',
    name: 'Trích hoá đơn ra Excel',
    desc: 'Chụp hoặc tải hoá đơn, phiếu nhập; nhận bảng số liệu và file Excel.',
    icon: <IconReceipt />,
    view: () => <InvoiceApp />,
  },
  {
    id: 'bao-gia',
    name: 'Soạn báo giá',
    desc: 'Nhập xe, cỡ lốp, dịch vụ; nhận tin báo giá gửi khách theo mẫu Thi Lốp.',
    icon: <IconQuote />,
    view: () => <QuoteApp />,
  },
  {
    id: 'bien-ban-hop',
    name: 'Biên bản cuộc họp',
    desc: 'Tải file ghi âm; nhận tóm tắt, quyết định và việc cần làm.',
    icon: <IconMic />,
    view: () => <MeetingApp />,
  },
  {
    id: 'doanh-thu',
    name: 'Phân tích doanh thu',
    desc: 'Tải file CSV hoặc Excel; xem tổng, tỷ trọng theo nhóm và nhận xét.',
    icon: <IconChart />,
    view: () => <RevenueApp />,
  },
];

export default function AppsPage() {
  const { appId } = useParams();
  const cur = APPS.find((a) => a.id === appId);
  useTitle(cur ? cur.name : 'Ứng dụng AI');

  if (cur)
    return (
      <>
        <PageHead title={cur.name} subtitle={cur.desc} />
        <div>
          <Link to="/apps" className="btn btn-ghost">
            <IconBack /> Tất cả ứng dụng
          </Link>
        </div>
        {cur.view()}
      </>
    );

  return (
    <>
      <PageHead title="Ứng dụng AI" subtitle="Việc làm sẵn: đưa dữ liệu vào, nhận kết quả" />
      <div className="appgrid">
        {APPS.map((a) => (
          <Link key={a.id} to={`/apps/${a.id}`} className="appcard">
            <span className="appicon">{a.icon}</span>
            <span className="appname">{a.name}</span>
            <span className="small muted">{a.desc}</span>
            <span className="small app-open">Mở ứng dụng →</span>
          </Link>
        ))}
      </div>
    </>
  );
}
