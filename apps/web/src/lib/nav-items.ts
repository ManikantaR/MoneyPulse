import {
  LayoutDashboard,
  ArrowLeftRight,
  Upload,
  Landmark,
  Tags,
  Settings,
  TrendingUp,
  Wallet,
  FileBarChart,
  Brain,
  RefreshCw,
  Store,
  CalendarClock,
  Repeat,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** 'tab' = shown in mobile bottom tab bar; 'drawer' = shown in More drawer */
  placement: 'tab' | 'drawer';
}

export const navItems: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, placement: 'tab' },
  { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight, placement: 'tab' },
  { href: '/bills', label: 'Bills', icon: CalendarClock, placement: 'tab' },
  // Drawer items
  { href: '/accounts', label: 'Accounts', icon: Landmark, placement: 'drawer' },
  { href: '/investments', label: 'Investments', icon: TrendingUp, placement: 'drawer' },
  { href: '/budgets', label: 'Budgets', icon: Wallet, placement: 'drawer' },
  { href: '/categories', label: 'Categories', icon: Tags, placement: 'drawer' },
  { href: '/merchants', label: 'Merchants', icon: Store, placement: 'drawer' },
  { href: '/subscriptions', label: 'Subscriptions', icon: Repeat, placement: 'drawer' },
  { href: '/imports', label: 'Imports', icon: FileBarChart, placement: 'drawer' },
  { href: '/upload', label: 'Upload', icon: Upload, placement: 'drawer' },
  { href: '/ai-logs', label: 'AI Logs', icon: Brain, placement: 'drawer' },
  { href: '/sync', label: 'Sync', icon: RefreshCw, placement: 'drawer' },
  { href: '/settings', label: 'Settings', icon: Settings, placement: 'drawer' },
];

export const tabItems = navItems.filter((item) => item.placement === 'tab');
export const drawerItems = navItems.filter((item) => item.placement === 'drawer');
