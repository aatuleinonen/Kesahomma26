// Verifies the invited-user dashboard's empty, error, and deletion states.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('includes transfer-ins in holding value and average-cost metrics', async () => {
    const portfolio = { portfolioId: 'portfolio-1', name: 'POC Portfolio', baseCurrency: 'EUR' }
    api.getPortfolios.mockResolvedValue({ portfolios: [portfolio] })
    api.getHoldings.mockResolvedValue({ holdings: { AAPL: 2 }, cashBalance: 0 })
    api.getTransactions.mockResolvedValue({
      transactions: [{
        type: 'transfer_in',
        ticker: 'AAPL',
        quantity: 2,
        price: 100,
        amount: 200,
        timestamp: '2026-09-10T00:00:00.000Z',
      }],
    })

    render(<PortfolioDashboard user={user} signOut={vi.fn()} />)

    const averageCost = await screen.findByText(/Avg: €100[,.]00/)
    expect(averageCost).toBeInTheDocument()
    expect(averageCost.closest('.holding-item').querySelector('.holding-val')).toHaveTextContent(/€200[,.]00/)
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
})
