import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BottomTabBar } from '@/components/BottomTabBar';
import { MobileMoreDrawer } from '@/components/MobileMoreDrawer';
import { drawerItems, tabItems } from '@/lib/nav-items';

// Mock next/navigation
const mockPathname = vi.fn().mockReturnValue('/');
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

// Mock auth for MobileMoreDrawer
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { displayName: 'Test User', email: 'test@example.com' },
    logout: vi.fn(),
  }),
}));

describe('BottomTabBar', () => {
  it('renders all tab items + Add + More buttons', () => {
    render(
      <BottomTabBar onAddPress={vi.fn()} onMorePress={vi.fn()} />,
    );

    for (const item of tabItems) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Add transaction')).toBeInTheDocument();
    expect(screen.getByLabelText('More navigation')).toBeInTheDocument();
  });

  it('has md:hidden class so it is hidden on desktop', () => {
    render(
      <BottomTabBar onAddPress={vi.fn()} onMorePress={vi.fn()} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(nav.className).toContain('md:hidden');
  });

  it('calls onAddPress when + button is clicked', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<BottomTabBar onAddPress={onAdd} onMorePress={vi.fn()} />);
    await user.click(screen.getByLabelText('Add transaction'));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('calls onMorePress when More button is clicked', async () => {
    const onMore = vi.fn();
    const user = userEvent.setup();
    render(<BottomTabBar onAddPress={vi.fn()} onMorePress={onMore} />);
    await user.click(screen.getByLabelText('More navigation'));
    expect(onMore).toHaveBeenCalledOnce();
  });

  it('marks Dashboard active on /', () => {
    mockPathname.mockReturnValue('/');
    render(<BottomTabBar onAddPress={vi.fn()} onMorePress={vi.fn()} />);
    const dashLink = screen.getByText('Dashboard').closest('a');
    expect(dashLink?.className).toContain('text-[var(--primary)]');
  });

  it('marks More button active when on a drawer route', () => {
    mockPathname.mockReturnValue('/settings');
    render(<BottomTabBar onAddPress={vi.fn()} onMorePress={vi.fn()} />);
    const moreBtn = screen.getByLabelText('More navigation');
    expect(moreBtn.className).toContain('text-[var(--primary)]');
  });

  it('does not mark More active on a tab route', () => {
    mockPathname.mockReturnValue('/transactions');
    render(<BottomTabBar onAddPress={vi.fn()} onMorePress={vi.fn()} />);
    const moreBtn = screen.getByLabelText('More navigation');
    expect(moreBtn.className).toContain('text-[var(--muted-foreground)]');
  });
});

describe('MobileMoreDrawer', () => {
  it('lists all drawer items', () => {
    render(<MobileMoreDrawer onClose={vi.fn()} />);

    for (const item of drawerItems) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    }
  });

  it('does NOT list tab items (Dashboard, Transactions, Bills)', () => {
    render(<MobileMoreDrawer onClose={vi.fn()} />);

    for (const item of tabItems) {
      expect(screen.queryByText(item.label)).not.toBeInTheDocument();
    }
  });

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<MobileMoreDrawer onClose={onClose} />);
    // The backdrop is the first element with aria-hidden
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<MobileMoreDrawer onClose={onClose} />);
    await user.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('marks Settings link active when on /settings', () => {
    mockPathname.mockReturnValue('/settings');
    render(<MobileMoreDrawer onClose={vi.fn()} />);
    const link = screen.getByText('Settings').closest('a');
    expect(link?.className).toContain('text-[var(--primary)]');
  });
});

describe('navItems DRY config', () => {
  it('tab items are Dashboard, Transactions, Bills', () => {
    expect(tabItems.map((i) => i.label)).toEqual(['Dashboard', 'Transactions', 'Bills']);
  });

  it('drawer items do not include tab items', () => {
    const tabHrefs = new Set(tabItems.map((i) => i.href));
    for (const item of drawerItems) {
      expect(tabHrefs.has(item.href)).toBe(false);
    }
  });

  it('all items have placement set', () => {
    const allItems = [...tabItems, ...drawerItems];
    for (const item of allItems) {
      expect(['tab', 'drawer']).toContain(item.placement);
    }
  });
});
