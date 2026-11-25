// Verifies portfolio creation, ledger rendering, and transaction interactions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import PortfolioDashboard from './PortfolioDashboard'
import { api } from '../utils/api'

vi.mock('../utils/api', () => ({
  api: {
    createPortfolio: vi.fn(),
    createTransaction: vi.fn(),
    deletePortfolio: vi.fn(),
    deleteTransaction: vi.fn(),
    draftPortfolio: vi.fn(),
    getHoldings: vi.fn(),
    getPortfolios: vi.fn(),
    getTransactions: vi.fn(),
    updateTransaction: vi.fn(),
  },
}))

const user = {
  signInDetails: {
    loginId: 'tester@example.com',
  },
}

describe('PortfolioDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getHoldings.mockResolvedValue({ holdings: {}, cashBalance: 0 })
    api.getTransactions.mockResolvedValue({ transactions: [] })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows the first-portfolio action when the user has no portfolios', async () => {
    api.getPortfolios.mockResolvedValue({ portfolios: [] })

    render(<PortfolioDashboard user={user} signOut={vi.fn()} />)

    expect(await screen.findByText('No Portfolios Found')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create Your First Portfolio/i })).toBeEnabled()
  })

  it('shows a recoverable error when portfolios cannot be loaded', async () => {
    api.getPortfolios.mockRejectedValue(new Error('network unavailable'))

    render(<PortfolioDashboard user={user} signOut={vi.fn()} />)

    expect(await screen.findByText('Service Unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })

  it('deletes the selected portfolio after explicit confirmation', async () => {
    const portfolio = {
      portfolioId: 'portfolio-1',
      name: 'POC Portfolio',
      baseCurrency: 'EUR',
    }
    api.getPortfolios
      .mockResolvedValueOnce({ portfolios: [portfolio] })
      .mockResolvedValue({ portfolios: [] })
    api.deletePortfolio.mockResolvedValue(null)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<PortfolioDashboard user={user} signOut={vi.fn()} />)

    const deleteButton = await screen.findByRole('button', { name: 'Delete Portfolio' })
    await waitFor(() => expect(deleteButton).toBeEnabled())
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(api.deletePortfolio).toHaveBeenCalledWith('portfolio-1')
    })
    expect(await screen.findByText('No Portfolios Found')).toBeInTheDocument()
  })

  it('calculates mixed-case ledger entries and exposes intermediate chart balances', async () => {
    const portfolio = { portfolioId: 'portfolio-1', name: 'POC Portfolio', baseCurrency: 'EUR' }
    api.getPortfolios.mockResolvedValue({ portfolios: [portfolio] })
    api.getHoldings.mockResolvedValue({ holdings: { AAPL: 2 }, cashBalance: 25 })
    api.getTransactions.mockResolvedValue({
      transactions: [
        { type: 'DEPOSIT', amount: 50, timestamp: '2026-09-09T12:00:00.000Z' },
        {
          type: 'TRANSFER_IN',
          ticker: 'AAPL',
          quantity: 2,
          price: 100,
          amount: 200,
          timestamp: '2026-09-10T12:00:00.000Z',
        },
        { type: 'Withdrawal', amount: 25, timestamp: '2026-09-11T12:00:00.000Z' },
      ],
    })

    render(<PortfolioDashboard user={user} signOut={vi.fn()} />)

    const averageCost = await screen.findByText(/Avg: €100[,.]00/)
    expect(averageCost).toBeInTheDocument()
    expect(averageCost.closest('.holding-item').querySelector('.holding-val')).toHaveTextContent(/€200[,.]00/)
    fireEvent.click(screen.getByText('View chart data'))
    const chart = within(screen.getByRole('table', { name: 'Plotted ledger balances' }))
    expect(chart.getAllByRole('cell').map(cell => cell.textContent)).toEqual([
      expect.stringMatching(/€50[,.]00/),
      expect.stringMatching(/€250[,.]00/),
      expect.stringMatching(/€225[,.]00/),
    ])
  })

  it('preserves existing portfolios when a creation completes before the list request', async () => {
    const existing = { portfolioId: 'existing', name: 'Existing holdings', baseCurrency: 'EUR' }
    const created = { portfolioId: 'created', name: 'New holdings', baseCurrency: 'EUR' }
    const { promise, resolve } = Promise.withResolvers()
    api.getPortfolios.mockReturnValue(promise)
    api.createPortfolio.mockResolvedValue({ portfolio: created })

    render(<PortfolioDashboard user={user} signOut={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /New Portfolio/ }))
    fireEvent.change(screen.getByLabelText('Portfolio Name'), { target: { value: created.name } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Portfolio' }))
    await screen.findByRole('heading', { name: created.name })

    resolve({ portfolios: [existing] })
    await screen.findByRole('option', { name: existing.name })
    expect(screen.getByRole('combobox', { name: 'Portfolio' })).toHaveValue(created.portfolioId)
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it.each(['empty', 'stale'])('keeps a deleted creation hidden when the refresh is %s and the initial list is pending', async refresh => {
    const created = { portfolioId: 'created', name: 'New holdings', baseCurrency: 'EUR' }
    const initial = Promise.withResolvers()
    api.getPortfolios
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValue({ portfolios: refresh === 'stale' ? [created] : [] })
    api.createPortfolio.mockResolvedValue({ portfolio: created })
    api.deletePortfolio.mockResolvedValue(null)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<PortfolioDashboard user={user} signOut={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /New Portfolio/ }))
    fireEvent.change(screen.getByLabelText('Portfolio Name'), { target: { value: created.name } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Portfolio' }))
    const deleteButton = await screen.findByRole('button', { name: 'Delete Portfolio' })
    await waitFor(() => expect(deleteButton).toBeEnabled())
    fireEvent.click(deleteButton)

    expect(await screen.findByText('No Portfolios Found')).toBeInTheDocument()
    expect(api.deletePortfolio).toHaveBeenCalledWith(created.portfolioId)
    await act(async () => initial.resolve({ portfolios: [created] }))
    expect(screen.getByText('No Portfolios Found')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Portfolio' })).not.toBeInTheDocument()
  })

  it('keeps millisecond edit keys and defaults a same-minute sale after the latest opening', async () => {
    const portfolio = { portfolioId: 'portfolio-1', name: 'POC Portfolio', baseCurrency: 'EUR' }
    const first = '2026-09-10T12:00:12.101Z'
    const second = '2026-09-10T12:00:12.102Z'
    api.getPortfolios.mockResolvedValue({ portfolios: [portfolio] })
    api.getTransactions.mockResolvedValue({
      transactions: [
        { type: 'transfer_in', ticker: 'AAPL', quantity: 2, price: 100, amount: 200, timestamp: first },
        { type: 'TRANSFER_IN', ticker: 'MSFT', quantity: 1, price: 100, amount: 100, timestamp: second },
      ],
    })
    api.updateTransaction.mockResolvedValue({})
    api.createTransaction.mockResolvedValue({})

    render(<PortfolioDashboard user={user} signOut={vi.fn()} />)
    const msft = await screen.findByRole('row', { name: /MSFT/ })
    const aapl = screen.getByRole('row', { name: /AAPL/ })
    expect(msft.querySelector('time')).toHaveTextContent(/102/)
    expect(aapl.querySelector('time')).toHaveTextContent(/101/)
    fireEvent.click(within(msft).getByRole('button', { name: 'Edit transaction' }))
    expect(screen.getByLabelText('Date & Time')).toHaveAttribute('step', '0.001')
    expect(screen.getByLabelText('Date & Time').value).toMatch(/:12\.102$/)
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(api.updateTransaction).toHaveBeenCalledWith(
      portfolio.portfolioId, second, expect.objectContaining({ timestamp: second, type: 'transfer_in' }),
    ))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(second))
    fireEvent.click(screen.getByRole('button', { name: /Add Transaction/ }))
    fireEvent.change(screen.getByLabelText('Transaction Type'), { target: { value: 'sell' } })
    fireEvent.change(screen.getByLabelText('Asset Ticker Symbol'), { target: { value: 'AAPL' } })
    fireEvent.change(screen.getByLabelText('Quantity (Shares)'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/Price per Share/), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record Transaction' }))
    await waitFor(() => expect(api.createTransaction).toHaveBeenCalledWith(
      portfolio.portfolioId, expect.objectContaining({ timestamp: '2026-09-10T12:00:12.103Z', type: 'sell' }),
    ))
  })

  it('reviews and corrects AI holdings before creating the portfolio', async () => {
    api.getPortfolios.mockResolvedValue({ portfolios: [] })
    api.draftPortfolio.mockResolvedValue({
      draft: {
        name: 'Long-term holdings',
        description: 'Existing positions',
        baseCurrency: 'USD',
        holdings: [{ ticker: 'AAPL', quantity: 12, costBasis: null }],
        notes: 'Provide the original cost.',
      },
    })
    api.createPortfolio.mockResolvedValue({
      portfolio: { portfolioId: 'saved', name: 'Reviewed holdings', baseCurrency: 'USD' },
    })
    api.getHoldings.mockResolvedValue({ holdings: { AAPL: 12 }, cashBalance: 0 })

    render(<PortfolioDashboard user={user} signOut={vi.fn()} />)
    await screen.findByText('No Portfolios Found')
    fireEvent.click(screen.getByRole('button', { name: 'Use an example' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }))
    expect(await screen.findByText('Provide the original cost.')).toBeInTheDocument()
    expect(api.createPortfolio).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Portfolio name'), { target: { value: 'Reviewed holdings' } })
    fireEvent.change(screen.getByLabelText('Total original cost'), { target: { value: '2040' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save portfolio' }))

    expect(await screen.findByRole('heading', { name: 'Reviewed holdings' })).toBeInTheDocument()
    expect(api.createPortfolio).toHaveBeenCalledWith({
      portfolioId: expect.stringMatching(/^portfolio-/),
      name: 'Reviewed holdings',
      description: 'Existing positions',
      baseCurrency: 'USD',
      holdings: [{ ticker: 'AAPL', quantity: 12, costBasis: 2040 }],
    })
  })

  it.each(['deposit', 'edit'])('keeps an open %s on its original portfolio when an AI save changes the selection', async action => {
    const original = { portfolioId: 'original', name: 'Euro holdings', baseCurrency: 'EUR' }
    const created = { portfolioId: 'created', name: 'US holdings', baseCurrency: 'USD' }
    const timestamp = '2026-09-10T12:00:12.101Z'
    const opening = { type: 'deposit', amount: 100, timestamp }
    const save = Promise.withResolvers()
    api.getPortfolios.mockResolvedValue({ portfolios: [original] })
    api.getTransactions.mockImplementation(async id => ({ transactions: id === original.portfolioId ? [opening] : [] }))
    api.draftPortfolio.mockResolvedValue({
      draft: { name: created.name, description: '', baseCurrency: created.baseCurrency, holdings: [], notes: '' },
    })
    api.createPortfolio.mockReturnValue(save.promise)
    api.createTransaction.mockResolvedValue({})
    api.updateTransaction.mockResolvedValue({})

    render(<PortfolioDashboard user={user} signOut={vi.fn()} />)
    const add = await screen.findByRole('button', { name: /Add Transaction/ })
    fireEvent.click(screen.getByRole('button', { name: 'Use an example' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save portfolio' }))

    fireEvent.click(action === 'edit' ? screen.getByRole('button', { name: 'Edit transaction' }) : add)
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('Amount (€)'), { target: { value: '125' } })
    await act(async () => save.resolve({ portfolio: created }))
    expect(screen.getByRole('combobox', { name: 'Portfolio' })).toHaveValue(created.portfolioId)
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('For Euro holdings')
    expect(dialog.getByLabelText('Amount (€)')).toHaveValue(125)

    fireEvent.click(dialog.getByRole('button', { name: action === 'edit' ? 'Save Changes' : 'Record Transaction' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const transaction = expect.objectContaining({ type: 'deposit', amount: 125 })
    if (action === 'edit') {
      expect(api.updateTransaction).toHaveBeenCalledExactlyOnceWith(original.portfolioId, timestamp, transaction)
    } else {
      expect(api.createTransaction).toHaveBeenCalledExactlyOnceWith(original.portfolioId, transaction)
    }
  })
})
