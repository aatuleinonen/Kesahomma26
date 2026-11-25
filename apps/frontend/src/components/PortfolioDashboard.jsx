import { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import PortfolioAssistant from './PortfolioAssistant';
import { PortfolioHistory } from './PortfolioHistory';
import { summarizeLedger } from '../utils/ledger';

export default function PortfolioDashboard({ signOut, user }) {
  // State
  const [portfolios, setPortfolios] = useState([]);
  const [currentPortfolioId, setCurrentPortfolioId] = useState('');
  const [holdings, setHoldings] = useState({});
  const [cashBalance, setCashBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailsId, setDetailsId] = useState('');
  const latestDetailsRequest = useRef(0);
  const selectedPortfolioId = useRef('');
  const latestListRequest = useRef(0);
  const [error, setError] = useState(null);

  // Modals state
  const [portfolioModalOpen, setPortfolioModalOpen] = useState(false);
  const [transactionModalOpen, setTransactionModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);

  // Form states
  const [portfolioForm, setPortfolioForm] = useState({
    name: '',
    description: '',
    baseCurrency: 'EUR'
  });

  const [transactionForm, setTransactionForm] = useState({
    type: 'deposit',
    ticker: '',
    quantity: '',
    price: '',
    amount: '',
    timestamp: ''
  });

  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const loadPortfolios = async () => {
    const request = ++latestListRequest.current;
    try {
      setLoading(true);
      setError(null);
      const res = await api.getPortfolios();
      if (request !== latestListRequest.current) return;
      const list = res.portfolios || [];
      setPortfolios(list);
      const selected = selectedPortfolioId.current;
      const next = list.some(portfolio => portfolio.portfolioId === selected)
        ? selected
        : list[0]?.portfolioId || '';
      if (selected !== next) {
        latestDetailsRequest.current++;
        selectedPortfolioId.current = next;
        setDetailsId('');
        setCurrentPortfolioId(next);
      }
      if (!next || selected === next) setLoading(false);
    } catch {
      if (request !== latestListRequest.current) return;
      setError('Failed to fetch portfolios. Please check if the API backend is running.');
      setLoading(false);
    }
  };

  const loadPortfolioDetails = async (portfolioId) => {
    if (portfolioId !== selectedPortfolioId.current) return;
    const request = ++latestDetailsRequest.current;
    try {
      setLoading(true);
      setError(null);
      const [holdingsRes, transactionsRes] = await Promise.all([
        api.getHoldings(portfolioId),
        api.getTransactions(portfolioId)
      ]);

      if (request !== latestDetailsRequest.current) return;
      setDetailsId(portfolioId);
      setHoldings(holdingsRes.holdings || {});
      setCashBalance(holdingsRes.cashBalance ?? 0);
      setTransactions(transactionsRes.transactions || []);
    } catch {
      if (request !== latestDetailsRequest.current) return;
      setDetailsId('');
      setError('Failed to load portfolio details.');
    } finally {
      if (request === latestDetailsRequest.current) setLoading(false);
    }
  };

  // Fetch all portfolios on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPortfolios();
  }, []);

  // Fetch holdings and transactions when current portfolio changes
  useEffect(() => {
    if (currentPortfolioId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadPortfolioDetails(currentPortfolioId);
    }
  }, [currentPortfolioId]);

  const { holdings: holdingsMetrics, history } = summarizeLedger(transactions);
  const holdingsTotalCost = [...holdingsMetrics.values()].reduce((sum, holding) => sum + holding.totalCost, 0);
  const ledgerBalance = holdingsTotalCost + cashBalance;
  const currentPortfolio = portfolios.find(p => p.portfolioId === currentPortfolioId);
  const currency = currentPortfolio?.baseCurrency || 'EUR';
  const currencySymbol = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }[currency] || currency;
  const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatMoney = value => `${currencySymbol}${money.format(value)}`;

  function selectPortfolio(portfolioId) {
    if (portfolioId === selectedPortfolioId.current) return;
    latestDetailsRequest.current++;
    selectedPortfolioId.current = portfolioId;
    setError(null);
    setDetailsId('');
    setLoading(true);
    setCurrentPortfolioId(portfolioId);
  }

  function portfolioCreated(portfolio) {
    latestListRequest.current++;
    setPortfolios(previous => [...previous.filter(item => item.portfolioId !== portfolio.portfolioId), portfolio]);
    selectPortfolio(portfolio.portfolioId);
  }

  function openPortfolioForm() {
    setFormError(null);
    setPortfolioModalOpen(true);
  }

  // Portfolio handlers
  const handleCreatePortfolio = async (e) => {
    e.preventDefault();
    if (!portfolioForm.name.trim()) {
      setFormError('Portfolio Name is required');
      return;
    }
    try {
      setFormError(null);
      setFormSubmitting(true);
      const portfolioId = `portfolio-${crypto.randomUUID()}`;
      const res = await api.createPortfolio({
        portfolioId,
        ...portfolioForm
      });

      portfolioCreated(res.portfolio);
      setPortfolioForm({ name: '', description: '', baseCurrency: 'EUR' });
      setPortfolioModalOpen(false);
    } catch (err) {
      setFormError(err.message || 'Failed to create portfolio.');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeletePortfolio = async () => {
    if (!currentPortfolio) return;
    const confirmed = window.confirm(
      `Delete "${currentPortfolio.name}" and all of its transactions? This cannot be undone in the application.`
    );
    if (!confirmed) return;

    try {
      setError(null);
      setLoading(true);
      await api.deletePortfolio(currentPortfolio.portfolioId);
      await loadPortfolios();
    } catch (err) {
      setError(err.message || 'Failed to delete portfolio.');
      setLoading(false);
    }
  };

  // Transaction handlers
  const handleOpenAddTxn = () => {
    setEditingTransaction(null);

    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localNow = new Date(now.getTime() - tzOffset);

    setTransactionForm({
      type: 'deposit',
      ticker: '',
      quantity: '',
      price: '',
      amount: '',
      timestamp: localNow.toISOString().substring(0, 16) // format for datetime-local (local time)
    });
    setFormError(null);
    setTransactionModalOpen(true);
  };

  const handleOpenEditTxn = (txn) => {
    setEditingTransaction(txn);
    // Convert timestamp ISO string to local datetime format (YYYY-MM-DDTHH:mm)
    const localDate = new Date(txn.timestamp);
    // Adjust timezone offset to preserve date/time correctly
    const tzOffset = localDate.getTimezoneOffset() * 60000;
    const adjustedDate = new Date(localDate.getTime() - tzOffset);
    const dateString = adjustedDate.toISOString().substring(0, 16);

    setTransactionForm({
      type: txn.type,
      ticker: txn.ticker || '',
      quantity: txn.quantity !== undefined ? txn.quantity.toString() : '',
      price: txn.price !== undefined ? txn.price.toString() : '',
      amount: txn.amount !== undefined ? txn.amount.toString() : '',
      timestamp: dateString
    });
    setFormError(null);
    setTransactionModalOpen(true);
  };

  const handleDeleteTxn = async (timestamp) => {
    if (!window.confirm('Are you sure you want to delete this transaction?')) return;
    try {
      setError(null);
      setLoading(true);
      await api.deleteTransaction(currentPortfolioId, timestamp);
      await loadPortfolioDetails(currentPortfolioId);
    } catch (err) {
      setError(err.message || 'Failed to delete transaction.');
      setLoading(false);
    }
  };

  const handleTransactionSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    const { type, ticker, quantity, price, amount, timestamp } = transactionForm;

    // Validations
    if (['buy', 'sell', 'transfer_in'].includes(type)) {
      if (!ticker.trim()) return setFormError('Ticker is required for trades');
      if (!quantity || parseFloat(quantity) <= 0) return setFormError('Quantity must be greater than 0');
      if (price === '' || (type === 'transfer_in' ? parseFloat(price) < 0 : parseFloat(price) <= 0)) {
        return setFormError(type === 'transfer_in' ? 'Price must be 0 or greater' : 'Price must be greater than 0');
      }
    } else {
      if (!amount || parseFloat(amount) <= 0) return setFormError('Amount must be greater than 0');
    }

    try {
      setFormSubmitting(true);

      const parsedTxn = {
        type,
        timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString()
      };

      if (['buy', 'sell', 'transfer_in'].includes(type)) {
        parsedTxn.ticker = ticker.toUpperCase().trim();
        parsedTxn.quantity = parseFloat(quantity);
        parsedTxn.price = parseFloat(price);
        parsedTxn.amount = parseFloat((parsedTxn.quantity * parsedTxn.price).toFixed(2));
      } else {
        parsedTxn.amount = parseFloat(amount);
      }

      if (editingTransaction) {
        // Edit flow
        await api.updateTransaction(currentPortfolioId, editingTransaction.timestamp, parsedTxn);
      } else {
        // Add flow
        await api.createTransaction(currentPortfolioId, parsedTxn);
      }

      await loadPortfolioDetails(currentPortfolioId);
      setTransactionModalOpen(false);
    } catch (err) {
      setFormError(err.message || 'Failed to process transaction.');
    } finally {
      setFormSubmitting(false);
    }
  };

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true">▂▅▇</span> PortfolioOverview</div>
        <div className="account">
          <span className="user-email">{user?.signInDetails?.loginId || user?.username}</span>
          <button className="btn-secondary" onClick={signOut}>Sign Out</button>
        </div>
      </header>

      <main className="dashboard-content">
        <div className="workspace-heading">
          <h1>Portfolios</h1>
          <div className="workspace-actions">
            {portfolios.length > 0 && (
              <select className="form-select portfolio-select" aria-label="Portfolio" value={currentPortfolioId} onChange={e => selectPortfolio(e.target.value)}>
                {portfolios.map(portfolio => <option key={portfolio.portfolioId} value={portfolio.portfolioId}>{portfolio.name}</option>)}
              </select>
            )}
            <button className="btn-secondary" onClick={openPortfolioForm}>+ New Portfolio</button>
          </div>
        </div>

        <div className="workspace-grid">
          <div className="workspace-main">
            {loading && !currentPortfolio ? (
              <section className="dashboard-card state-card" role="status">Loading portfolios…</section>
            ) : error && !currentPortfolio ? (
              <section className="dashboard-card state-card" role="alert">
                <h2>Service Unavailable</h2>
                <p>{error}</p>
                <button className="btn-secondary" onClick={loadPortfolios}>Retry</button>
              </section>
            ) : !currentPortfolio ? (
              <section className="dashboard-card empty-state-card">
                <div className="empty-graphic" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
                <h2>No Portfolios Found</h2>
                <p>Track your holdings, cash, and transaction history in one place.</p>
                <div className="workspace-actions">
                  <a className="btn-primary" href="#portfolio-assistant">Build with AI <span aria-hidden="true">→</span></a>
                  <button className="btn-secondary" onClick={openPortfolioForm}>Create Your First Portfolio</button>
                </div>
              </section>
            ) : (
              <>
                <section className="dashboard-card overview">
                  <div className="dashboard-card-header">
                    <div>
                      <h2>{currentPortfolio.name}</h2>
                      {currentPortfolio.description && <p>{currentPortfolio.description}</p>}
                    </div>
                    <span className="currency-tag">{currency}</span>
                  </div>
                  {error && <p className="form-error" role="alert">{error}</p>}
                  {loading ? <p role="status">Loading portfolio data…</p> : detailsId !== currentPortfolioId ? (
                    <button className="btn-secondary" onClick={() => loadPortfolioDetails(currentPortfolioId)}>Retry</button>
                  ) : (
                    <>
                      <div className="balance-label">Ledger balance</div>
                      <div className="balance-value">{formatMoney(ledgerBalance)}</div>
                      <p className="chart-caption">Cash plus holding cost basis, by day with activity</p>
                      <PortfolioHistory history={history} formatMoney={formatMoney} />
                      <dl className="summary-grid">
                        <div><dt>Holding cost basis</dt><dd>{formatMoney(holdingsTotalCost)}</dd></div>
                        <div><dt>Cash balance</dt><dd>{formatMoney(cashBalance)}</dd></div>
                        <div><dt>Positions</dt><dd>{Object.keys(holdings).length}</dd></div>
                      </dl>
                    </>
                  )}
                </section>

                {!loading && detailsId === currentPortfolioId && (
                  <>
                    <section className="dashboard-card">
                      <div className="dashboard-card-header"><h2>Holdings</h2><span className="muted">Allocation by cost</span></div>
                      {!Object.keys(holdings).length && <p className="muted">No positions yet. Record a trade or transfer to add one.</p>}
                      {Object.entries(holdings).map(([ticker, quantity]) => {
                        const metric = holdingsMetrics.get(ticker) || { averageCost: 0, totalCost: 0 };
                        const allocation = holdingsTotalCost > 0 ? metric.totalCost / holdingsTotalCost * 100 : 0;
                        return (
                          <div key={ticker} className="holding-item">
                            <div className="holding-identity">
                              <span className="ticker-icon" aria-hidden="true">{ticker[0]}</span>
                              <div><strong>{ticker}</strong><span className="muted">{quantity.toLocaleString()} shares</span></div>
                            </div>
                            <div className="holding-cost"><strong className="holding-val">{formatMoney(metric.totalCost)}</strong><span className="muted">Avg: {formatMoney(metric.averageCost)}</span></div>
                            <div className="allocation">
                              <div className="allocation-track"><div style={{ width: `${allocation}%` }} /></div>
                              <span>{allocation.toFixed(1)}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </section>

                    <section className="dashboard-card">
                      <div className="dashboard-card-header">
                        <h2>Transaction History</h2>
                        <button className="btn-secondary" onClick={handleOpenAddTxn}>+ Add Transaction</button>
                      </div>
                      {transactions.length === 0 ? <p className="muted">This portfolio has no transactions.</p> : (
                        <div className="table-responsive">
                          <table className="custom-table">
                            <thead><tr><th>Date &amp; time</th><th>Type</th><th>Ticker</th><th>Shares</th><th>Price</th><th>Amount</th><th>Actions</th></tr></thead>
                            <tbody>
                              {[...transactions].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map(t => {
                                const isTrade = ['buy', 'sell', 'transfer_in'].includes(t.type);
                                const total = t.amount ?? (Number(t.quantity) * Number(t.price));
                                return (
                                  <tr key={t.timestamp}>
                                    <td>{new Date(t.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                                    <td><span className={`txn-badge ${t.type}`}>{t.type.replace('_', ' ')}</span></td>
                                    <td>{t.ticker || '—'}</td>
                                    <td>{isTrade ? Number(t.quantity).toLocaleString() : '—'}</td>
                                    <td>{isTrade ? formatMoney(t.price) : '—'}</td>
                                    <td>{formatMoney(total)}</td>
                                    <td><div className="table-actions">
                                      <button type="button" className="text-button" onClick={() => handleOpenEditTxn(t)} aria-label="Edit transaction">Edit</button>
                                      <button type="button" className="text-button danger" onClick={() => handleDeleteTxn(t.timestamp)} aria-label="Delete transaction">Delete</button>
                                    </div></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </>
                )}
                <button type="button" className="text-button danger delete-portfolio" onClick={handleDeletePortfolio} disabled={loading}>Delete Portfolio</button>
              </>
            )}
          </div>
          <PortfolioAssistant onCreated={portfolioCreated} />
        </div>
      </main>

      {/* --- Create/Edit Portfolio Modal --- */}
      {portfolioModalOpen && (
        <div className="modal-overlay">
          <div className="modal-container" role="dialog" aria-modal="true" aria-labelledby="create-portfolio-title">
            <header className="modal-header">
              <h3 id="create-portfolio-title">Create Investment Portfolio</h3>
              <button type="button" className="modal-close-btn" onClick={() => setPortfolioModalOpen(false)} aria-label="Close dialog">×</button>
            </header>
            <form onSubmit={handleCreatePortfolio}>
              <div className="modal-body">
                {formError && <div className="form-error">{formError}</div>}

                <div className="form-group">
                  <label className="form-label" htmlFor="portfolio-name">Portfolio Name</label>
                  <input id="portfolio-name"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Technology Stocks, Retirement Fund"
                    value={portfolioForm.name}
                    onChange={(e) => setPortfolioForm({ ...portfolioForm, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="portfolio-description">Description</label>
                  <textarea id="portfolio-description"
                    className="form-textarea"
                    placeholder="Describe the strategy or goal of this portfolio..."
                    value={portfolioForm.description}
                    onChange={(e) => setPortfolioForm({ ...portfolioForm, description: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="portfolio-currency">Base Currency</label>
                    <select id="portfolio-currency"
                      className="form-select"
                      value={portfolioForm.baseCurrency}
                      onChange={(e) => setPortfolioForm({ ...portfolioForm, baseCurrency: e.target.value })}
                    >
                      <option value="EUR">EUR (€)</option>
                      <option value="USD">USD ($)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="JPY">JPY (¥)</option>
                    </select>
                  </div>

                </div>
              </div>
              <footer className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setPortfolioModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={formSubmitting}>
                  {formSubmitting ? 'Creating...' : 'Create Portfolio'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* --- Add/Edit Transaction Modal (Acceptance Criteria #2) --- */}
      {transactionModalOpen && (
        <div className="modal-overlay">
          <div className="modal-container" role="dialog" aria-modal="true" aria-labelledby="transaction-ledger-title">
            <header className="modal-header">
              <h3 id="transaction-ledger-title">{editingTransaction ? 'Edit Transaction Ledger Entry' : 'Record Transaction Ledger Entry'}</h3>
              <button type="button" className="modal-close-btn" onClick={() => setTransactionModalOpen(false)} aria-label="Close dialog">×</button>
            </header>
            <form onSubmit={handleTransactionSubmit}>
              <div className="modal-body">
                {formError && <div className="form-error">{formError}</div>}

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="transaction-type">Transaction Type</label>
                    <select id="transaction-type"
                      className="form-select"
                      value={transactionForm.type}
                      onChange={(e) => setTransactionForm({ ...transactionForm, type: e.target.value })}
                      disabled={!!editingTransaction} // Lock type on edit to maintain ledger schema consistency
                    >
                      <option value="deposit">Deposit</option>
                      <option value="withdrawal">Withdrawal</option>
                      <option value="buy">Buy Asset</option>
                      <option value="sell">Sell Asset</option>
                      <option value="transfer_in">Transfer In</option>
                      <option value="dividend">Dividend</option>
                      <option value="fee">Fee</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="transaction-time">Date & Time</label>
                    <input id="transaction-time"
                      type="datetime-local"
                      className="form-input"
                      value={transactionForm.timestamp}
                      onChange={(e) => setTransactionForm({ ...transactionForm, timestamp: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {(['buy', 'sell', 'transfer_in'].includes(transactionForm.type)) ? (
                  /* Trade Specific Fields */
                  <>
                    <div className="form-group">
                      <label className="form-label" htmlFor="transaction-ticker">Asset Ticker Symbol</label>
                      <input id="transaction-ticker"
                        type="text"
                        className="form-input"
                        placeholder="e.g. AAPL, MSFT, TSLA"
                        value={transactionForm.ticker}
                        onChange={(e) => setTransactionForm({ ...transactionForm, ticker: e.target.value })}
                        required
                        disabled={!!editingTransaction} // Lock ticker on edit
                      />
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label" htmlFor="transaction-quantity">Quantity (Shares)</label>
                        <input id="transaction-quantity"
                          type="number"
                          step="any"
                          min="0.00000001"
                          className="form-input"
                          placeholder="0.0"
                          value={transactionForm.quantity}
                          onChange={(e) => setTransactionForm({ ...transactionForm, quantity: e.target.value })}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="transaction-price">Price per Share ({currencySymbol})</label>
                        <input id="transaction-price"
                          type="number"
                          step="any"
                          min={transactionForm.type === 'transfer_in' ? '0' : '0.01'}
                          className="form-input"
                          placeholder="0.00"
                          value={transactionForm.price}
                          onChange={(e) => setTransactionForm({ ...transactionForm, price: e.target.value })}
                          required
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  /* Cash Movements Specific Fields */
                  <div className="form-group">
                    <label className="form-label" htmlFor="transaction-amount">Amount ({currencySymbol})</label>
                    <input id="transaction-amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="form-input"
                      placeholder="0.00"
                      value={transactionForm.amount}
                      onChange={(e) => setTransactionForm({ ...transactionForm, amount: e.target.value })}
                      required
                    />
                  </div>
                )}
              </div>
              <footer className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setTransactionModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={formSubmitting}>
                  {formSubmitting ? 'Saving...' : (editingTransaction ? 'Save Changes' : 'Record Transaction')}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
