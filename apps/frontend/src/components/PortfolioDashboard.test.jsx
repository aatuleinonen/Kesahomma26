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
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(api.deletePortfolio).toHaveBeenCalledWith('portfolio-1')
    })
    expect(await screen.findByText('No Portfolios Found')).toBeInTheDocument()
  })
})
