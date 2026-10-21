import { useSearchParams } from 'react-router-dom';
import { PageHead, Tabs } from '../../components/ui';
import { useMe } from '../../lib/auth';
import { useTitle } from '../../lib/hooks';
import BranchesTab from './BranchesTab';
import LogsTab from './LogsTab';
import ModelsTab from './ModelsTab';
import ReportsTab from './ReportsTab';
import RouterTab from './RouterTab';
import SettingsTab from './SettingsTab';
import UsersTab from './UsersTab';

type TabId = 'branches' | 'users' | 'models' | 'router' | 'settings' | 'reports' | 'logs';

const ALL_TABS: { value: TabId; label: string; adminOnly: boolean }[] = [
  { value: 'branches', label: 'Cơ sở & hạn mức', adminOnly: false },
  { value: 'users', label: 'Người dùng', adminOnly: false },
  { value: 'models', label: 'Model', adminOnly: true },
  { value: 'router', label: 'Router', adminOnly: true },
  { value: 'settings', label: 'Cài đặt', adminOnly: true },
  { value: 'reports', label: 'Báo cáo', adminOnly: false },
  { value: 'logs', label: 'Nhật ký', adminOnly: false },
];

export default function AdminPage() {
  useTitle('Quản trị');
  const { user } = useMe();
  const isAdmin = user.role === 'admin';
  const tabs = ALL_TABS.filter((t) => isAdmin || !t.adminOnly);
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as TabId | null;
  const tab: TabId = tabs.some((t) => t.value === raw) ? (raw as TabId) : 'branches';

  return (
    <>
      <PageHead
        title="Quản trị"
        subtitle={isAdmin ? 'Hạn mức theo cơ sở và người dùng, model, router, cài đặt' : `Hạn mức, báo cáo và nhật ký · ${user.branch_name ?? 'cơ sở của anh/chị'}`}
      />
      <Tabs label="Mục quản trị" value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} tabs={tabs} />
      {tab === 'branches' && <BranchesTab editable={isAdmin} />}
      {tab === 'users' && <UsersTab editable={isAdmin} />}
      {tab === 'models' && isAdmin && <ModelsTab />}
      {tab === 'router' && isAdmin && <RouterTab />}
      {tab === 'settings' && isAdmin && <SettingsTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'logs' && <LogsTab />}
    </>
  );
}
