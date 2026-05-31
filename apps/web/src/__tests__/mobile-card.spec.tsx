import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileCard, type CardField } from '@/components/MobileCard';

describe('MobileCard', () => {
  it('renders primary field as bold header', () => {
    render(
      <MobileCard
        fields={[{ primary: true, value: 'Electricity Bill' }]}
      />,
    );
    expect(screen.getByText('Electricity Bill')).toBeInTheDocument();
  });

  it('renders amount field in header', () => {
    render(
      <MobileCard
        fields={[
          { primary: true, value: 'Spotify' },
          { amount: true, value: '$9.99', amountColor: 'text-red-500' },
        ]}
      />,
    );
    expect(screen.getByText('$9.99')).toBeInTheDocument();
  });

  it('renders label/value grid fields', () => {
    render(
      <MobileCard
        fields={[
          { primary: true, value: 'Main item' },
          { label: 'Date', value: 'Jan 1' },
          { label: 'Account', value: 'Checking' },
        ]}
      />,
    );
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('Jan 1')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Checking')).toBeInTheDocument();
  });

  it('renders actions slot', () => {
    render(
      <MobileCard
        fields={[{ primary: true, value: 'Item' }]}
        actions={<button>Delete</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('calls onClick when tapped', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <MobileCard
        fields={[{ primary: true, value: 'Tappable' }]}
        onClick={onClick}
      />,
    );
    await user.click(screen.getByText('Tappable'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('actions click does not bubble to card onClick', async () => {
    const user = userEvent.setup();
    const cardClick = vi.fn();
    const actionClick = vi.fn();
    render(
      <MobileCard
        fields={[{ primary: true, value: 'Card' }]}
        onClick={cardClick}
        actions={<button onClick={actionClick}>Action</button>}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Action' }));
    expect(actionClick).toHaveBeenCalledOnce();
    expect(cardClick).not.toHaveBeenCalled();
  });

  it('shows em-dash for null/undefined field value', () => {
    render(
      <MobileCard
        fields={[
          { primary: true, value: 'Item' },
          { label: 'Merchant', value: null as unknown as string },
        ]}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('does not render as button when onClick is absent', () => {
    const { container } = render(
      <MobileCard fields={[{ primary: true, value: 'Static' }]} />,
    );
    const card = container.firstChild as HTMLElement;
    expect(card.getAttribute('role')).toBeNull();
    expect(card.getAttribute('tabindex')).toBeNull();
  });
});
