import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddTransactionModal } from '@/components/AddTransactionModal';

// Stub CategoryCombobox with a simple select for testing
vi.mock('@/components/CategoryCombobox', () => ({
  CategoryCombobox: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder ?? 'Category'}
    >
      <option value="">--none--</option>
      <option value="cat-1">Groceries</option>
    </select>
  ),
}));

vi.mock('@/lib/hooks/useCategories', () => ({
  useCategories: () => ({
    data: { data: [{ id: 'cat-1', name: 'Groceries', icon: '🛒', parentId: null }] },
  }),
}));

vi.mock('@/lib/hooks/useAccounts', () => ({
  useAccounts: () => ({
    data: {
      data: [
        { id: 'acc-1', nickname: 'Chase Checking', lastFour: '1234', accountType: 'checking' },
        { id: 'acc-2', nickname: 'Amex', lastFour: '5678', accountType: 'credit_card' },
      ],
    },
  }),
}));

const mockMutate = vi.fn();

vi.mock('@/lib/hooks/useTransactions', () => ({
  useCreateTransaction: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  mockMutate.mockClear();
});

describe('AddTransactionModal', () => {
  it('renders all form fields', () => {
    renderWithQuery(<AddTransactionModal onClose={vi.fn()} />);
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/grocery run/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/account/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add transaction/i })).toBeInTheDocument();
  });

  it('shows validation errors when submitted with empty fields', async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddTransactionModal onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /add transaction/i }));

    expect(screen.getByText(/enter an amount greater than/i)).toBeInTheDocument();
    expect(screen.getByText(/description is required/i)).toBeInTheDocument();
    expect(screen.getByText(/select an account/i)).toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('shows validation error when amount is 0', async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddTransactionModal onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Amount'), '0');
    await user.click(screen.getByRole('button', { name: /add transaction/i }));

    expect(screen.getByText(/enter an amount greater than/i)).toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('does not submit when amount is negative', async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddTransactionModal onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Amount'), '-5');
    await user.click(screen.getByRole('button', { name: /add transaction/i }));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('posts correct body with amountCents on submit', async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddTransactionModal onClose={vi.fn()} />);

    // Fill required fields
    await user.type(screen.getByLabelText('Amount'), '40.50');

    const descInput = screen.getByPlaceholderText(/grocery run/i);
    await user.type(descInput, 'Cash expense');

    await user.selectOptions(screen.getByLabelText(/account/i), 'acc-1');

    await user.click(screen.getByRole('button', { name: /add transaction/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 4050,
        description: 'Cash expense',
        accountId: 'acc-1',
        isCredit: false,
        categoryId: null,
      }),
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('sends isCredit: true when credit toggle is active', async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddTransactionModal onClose={vi.fn()} />);

    // Toggle to credit
    await user.click(screen.getByRole('button', { name: /debit \(expense\)/i }));

    await user.type(screen.getByLabelText('Amount'), '100');
    const descInput = screen.getByPlaceholderText(/grocery run/i);
    await user.type(descInput, 'Salary');
    await user.selectOptions(screen.getByLabelText(/account/i), 'acc-1');

    await user.click(screen.getByRole('button', { name: /add transaction/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ isCredit: true }),
      expect.anything(),
    );
  });

  it('includes categoryId when a category is selected', async () => {
    const user = userEvent.setup();
    renderWithQuery(<AddTransactionModal onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Amount'), '25');
    const descInput = screen.getByPlaceholderText(/grocery run/i);
    await user.type(descInput, 'Trader Joe\'s');
    await user.selectOptions(screen.getByLabelText(/account/i), 'acc-1');
    await user.selectOptions(
      screen.getByLabelText(/select category \(optional\)/i),
      'cat-1',
    );

    await user.click(screen.getByRole('button', { name: /add transaction/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: 'cat-1' }),
      expect.anything(),
    );
  });

  it('calls onClose and shows toast on success', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithQuery(<AddTransactionModal onClose={onClose} />);

    await user.type(screen.getByLabelText('Amount'), '50');
    const descInput = screen.getByPlaceholderText(/grocery run/i);
    await user.type(descInput, 'Lunch');
    await user.selectOptions(screen.getByLabelText(/account/i), 'acc-1');

    await user.click(screen.getByRole('button', { name: /add transaction/i }));

    // Trigger success callback
    const { onSuccess } = mockMutate.mock.calls[0][1];
    onSuccess();

    expect(onClose).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Transaction added');
  });

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithQuery(<AddTransactionModal onClose={onClose} />);

    await user.click(document.querySelector('[aria-hidden="true"]')!);
    expect(onClose).toHaveBeenCalled();
  });
});
