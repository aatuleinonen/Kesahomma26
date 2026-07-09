import { useState, useEffect } from 'react';
import { api } from '../utils/api';

export default function PortfolioDashboard({ signOut, user }) {
  // State
  const [portfolios, setPortfolios] = useState([]);
  const [currentPortfolioId, setCurrentPortfolioId] = useState('');
  const [holdings, setHoldings] = useState({});
  const [cashBalance, setCashBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [portfolioMetrics, setPortfolioMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
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
    try {
      setLoading(true);
      setError(null);
      const res = await api.getPortfolios();
      const list = res.portfolios || [];
      setPortfolios(list);
      if (list.length > 0) {
        // Default to first portfolio
        setCurrentPortfolioId(list[0].portfolioId);
      } else {
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to fetch portfolios. Please check if the API backend is running.');
      setLoading(false);
    }
  };

  const loadPortfolioDetails = async (portfolioId) => {
    try {
      setLoading(true);
      setError(null);
      
      const [holdingsRes, transactionsRes] = await Promise.all([
        api.getHoldings(portfolioId),
        api.getTransactions(portfolioId)
      ]);

      setHoldings(holdingsRes.holdings || {});
      setCashBalance(holdingsRes.cashBalance ?? 0);
      setPortfolioMetrics(holdingsRes.metrics || null);
      setTransactions(transactionsRes.transactions || []);
    } catch (err) {
      console.error(err);
      setError('Failed to load portfolio details.');
    } finally {
      setLoading(false);
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

  // Derived metrics from transactions
  const holdingsMetrics = (() => {
    const metrics = {};
    const sorted = [...transactions].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    
    for (const t of sorted) {
      const type = t.type.toLowerCase();
      const ticker = t.ticker;
      const quantity = parseFloat(t.quantity) || 0;
      const price = parseFloat(t.price) || 0;
      let amount = parseFloat(t.amount);
      if (isNaN(amount)) amount = quantity * price;

      if (type === 'buy') {
        if (!metrics[ticker]) {
          metrics[ticker] = { quantity: 0, totalCost: 0, averageCost: 0 };
        }
        metrics[ticker].quantity += quantity;
        metrics[ticker].totalCost += amount;
        metrics[ticker].averageCost = metrics[ticker].totalCost / metrics[ticker].quantity;
      } else if (type === 'sell') {
        if (metrics[ticker]) {
          metrics[ticker].quantity -= quantity;
          if (metrics[ticker].quantity <= 1e-9) {
            delete metrics[ticker];
          } else {
            metrics[ticker].totalCost = metrics[ticker].quantity * metrics[ticker].averageCost;
          }
        }
      }
    }
    return metrics;
  })();

  // Calculate total value of holdings + cash
  const holdingsTotalCost = Object.values(holdingsMetrics).reduce((sum, h) => sum + h.totalCost, 0);
  const portfolioTotalValue = parseFloat((holdingsTotalCost + cashBalance).toFixed(2));
  const currentPortfolio = portfolios.find(p => p.portfolioId === currentPortfolioId);
  const currencySymbol = currentPortfolio?.baseCurrency === 'USD' ? '$' : '€';

  // Integration with backend portfolio calculations
const costBasisTotal = portfolioMetrics?.totals?.costBasis ?? portfolioTotalValue;
const currentValueTotal = portfolioMetrics?.totals?.currentValue ?? portfolioTotalValue;
const unrealizedGainLossTotal = portfolioMetrics?.totals?.unrealizedGainLoss ?? 0;
const unrealizedGainLossPctTotal = portfolioMetrics?.totals?.unrealizedGainLossPct ?? 0;
  // Formatting trends for overview cards
  const totalTrendClass = unrealizedGainLossTotal > 0.01 
    ? 'stat-trend positive' 
    : (unrealizedGainLossTotal < -0.01 ? 'stat-trend negative' : 'stat-trend neutral');
  const totalTrendSign = unrealizedGainLossTotal > 0.01 ? '+' : '';
  const totalTrendText = `${totalTrendSign}${currencySymbol}${unrealizedGainLossTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} (${totalTrendSign}${unrealizedGainLossPctTotal.toFixed(2)}%)`;

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
      const portfolioId = 'portfolio-' + Date.now();
      const res = await api.createPortfolio({
        portfolioId,
        ...portfolioForm
      });
      
      const newPortfolio = res.portfolio;
      setPortfolios(prev => [...prev, newPortfolio]);
      setCurrentPortfolioId(newPortfolio.portfolioId);
      setPortfolioForm({ name: '', description: '', baseCurrency: 'EUR' });
      setPortfolioModalOpen(false);
    } catch (err) {
      setFormError(err.message || 'Failed to create portfolio.');
    } finally {
      setFormSubmitting(false);
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
    if (type === 'buy' || type === 'sell') {
      if (!ticker.trim()) return setFormError('Ticker is required for trades');
      if (!quantity || parseFloat(quantity) <= 0) return setFormError('Quantity must be greater than 0');
      if (!price || parseFloat(price) <= 0) return setFormError('Price must be greater than 0');
    } else {
      if (!amount || parseFloat(amount) <= 0) return setFormError('Amount must be greater than 0');
    }

    try {
      setFormSubmitting(true);
      
      const parsedTxn = {
        type,
        timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString()
      };

      if (type === 'buy' || type === 'sell') {
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
      {/* Header */}
      <header className="dashboard-header">
        <div className="logo-container">
          <span className="logo-icon">💼</span>
          <span className="logo-text">PortfolioOverview</span>
        </div>

        {portfolios.length > 0 && (
          <div className="portfolio-selector-container">
            <span className="form-label" style={{ margin: 0, display: 'inline' }}>Portfolio:</span>
            <select
              className="portfolio-select"
              value={currentPortfolioId}
              onChange={(e) => setCurrentPortfolioId(e.target.value)}
            >
              {portfolios.map(p => (
                <option key={p.portfolioId} value={p.portfolioId}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="user-profile">
          <button className="btn-primary" onClick={() => setPortfolioModalOpen(true)}>
            <span>➕</span> New Portfolio
          </button>
          <span className="user-email" title="Logged in as">
            {user?.signInDetails?.loginId || user?.username || "Authenticated User"}
          </span>
          <button className="sign-out-btn" onClick={signOut}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="dashboard-content">
        {loading && portfolios.length === 0 ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Loading portfolios...</p>
          </div>
        ) : error && portfolios.length === 0 ? (
          <div className="empty-state-card">
            <div className="empty-state-icon">⚠️</div>
            <h2>Service Unavailable</h2>
            <p>{error}</p>
            <button className="btn-primary" onClick={loadPortfolios}>Retry</button>
          </div>
        ) : portfolios.length === 0 ? (
          /* EMPTY STATE (Acceptance Criteria #3) */
          <div className="empty-state-card">
            <div className="empty-state-icon">📈</div>
            <h2>No Portfolios Found</h2>
            <p>Create your first investment portfolio to start tracking your stock holdings, cash movements, and allocation details.</p>
            <button className="btn-primary" onClick={() => setPortfolioModalOpen(true)}>
              <span>➕</span> Create Your First Portfolio
            </button>
          </div>
        ) : (
          /* VIEW DATA STATE (Acceptance Criteria #1) */
          <>
            <section className="welcome-banner">
              <span className="badge">{currentPortfolio?.baseCurrency || 'EUR'} Account</span>
              <h1>{currentPortfolio?.name || 'My Portfolio'}</h1>
              <p>{currentPortfolio?.description || 'No description provided.'}</p>
            </section>

            {/* Statistics Summary */}
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-icon">💰</span>
                <h3>Portfolio Current Value</h3>
                <div className="stat-value">
                  {currencySymbol}{currentValueTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div className={totalTrendClass}>
                  {totalTrendText}
                </div>
              </div>
              <div className="stat-card">
                <span className="stat-icon">📈</span>
                <h3>Total Cost Basis</h3>
                <div className="stat-value">
                  {currencySymbol}{costBasisTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div className="stat-trend neutral">Valued in {currentPortfolio?.baseCurrency}</div>
              </div>
              <div className="stat-card">
                <span className="stat-icon">💶</span>
                <h3>Cash Balance</h3>
                <div className="stat-value">
                  {currencySymbol}{cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div className="stat-trend neutral">Available for trading</div>
              </div>
              <div className="stat-card">
                <span className="stat-icon">📊</span>
                <h3>Total Assets</h3>
                <div className="stat-value">
                  {Object.keys(holdings).length}
                </div>
                <div className="stat-trend neutral">Distinct assets held</div>
              </div>
            </div>

            {loading ? (
              <div className="loading-container">
                <div className="spinner"></div>
                <p>Loading portfolio data...</p>
              </div>
            ) : (
              <div className="dashboard-grid-layout">
                {/* Holdings & Allocation List */}
                <div className="dashboard-card">
                  <div className="dashboard-card-header">
                    <h2><span>📁</span> Asset Allocations</h2>
                  </div>
                  
                  {Object.keys(holdings).length === 0 ? (
                    <p className="no-transactions">No stock holdings yet. Add a deposit and trade transactions to start.</p>
                  ) : (
                    <div className="holdings-list">
                      {Object.entries(holdings).map(([ticker, qty]) => {
                        const metric = holdingsMetrics[ticker] || { averageCost: 0, totalCost: 0 };
                        
                        // Backend calculations integration
                        const assetMetric = portfolioMetrics?.holdings?.[ticker];
                        const currentVal = assetMetric ? assetMetric.currentValue : metric.totalCost;
                        const avgCost = assetMetric ? assetMetric.averageCost : metric.averageCost;
                        const currentPrice = assetMetric ? assetMetric.currentPrice : metric.averageCost;
                        const unrealizedGL = assetMetric ? assetMetric.unrealizedGainLoss : 0;
                        const unrealizedGLPct = assetMetric ? assetMetric.unrealizedGainLossPct : 0;
                        const allocPct = assetMetric 
                          ? assetMetric.allocationPct 
                          : (portfolioTotalValue > 0 ? parseFloat(((metric.totalCost / portfolioTotalValue) * 100).toFixed(2)) : 0);
                        
                        const assetTrendClass = unrealizedGL > 0.01 
                          ? 'stat-trend positive' 
                          : (unrealizedGL < -0.01 ? 'stat-trend negative' : 'stat-trend neutral');
                        const assetTrendSign = unrealizedGL > 0.01 ? '+' : '';

                        return (
                          <div key={ticker} className="holding-item">
                            <div className="holding-info-row">
                              <span className="holding-ticker">{ticker}</span>
                              <span className="holding-val">{currencySymbol}{currentVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="holding-info-row">
                              <span className="holding-qty">{qty.toLocaleString()} shares</span>
                              <span className="holding-avg-cost">Avg: {currencySymbol}{avgCost.toFixed(2)}</span>
                            </div>
                            <div className="holding-info-row" style={{ fontSize: '0.85rem', marginTop: '2px' }}>
                              <span style={{ color: 'var(--text-secondary)' }}>Price: {currencySymbol}{currentPrice.toFixed(2)}</span>
                              <span className={assetTrendClass}>
                                {assetTrendSign}{currencySymbol}{unrealizedGL.toLocaleString(undefined, { minimumFractionDigits: 2 })} ({assetTrendSign}{unrealizedGLPct.toFixed(2)}%)
                              </span>
                            </div>
                            <div className="allocation-bar-container" style={{ marginTop: '6px' }}>
                              <div className="allocation-bar" style={{ width: `${allocPct}%` }}></div>
                            </div>
                            <div className="holding-info-row" style={{ fontSize: '0.75rem', marginTop: '-2px' }}>
                              <span style={{ color: 'var(--text-secondary)' }}>Allocation</span>
                              <span style={{ color: 'var(--accent-color)', fontWeight: 600 }}>{allocPct}%</span>
                            </div>
                          </div>
                        );
                      })}

                      {cashBalance > 0 && (
                        <div className="holding-item" style={{ borderStyle: 'dashed' }}>
                          <div className="holding-info-row">
                            <span className="holding-ticker" style={{ color: 'var(--text-secondary)' }}>CASH</span>
                            <span className="holding-val">{currencySymbol}{cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>
                          <div className="allocation-bar-container">
                            <div className="allocation-bar" style={{ 
                              width: `${portfolioMetrics ? portfolioMetrics.totals.cashAllocationPct : (portfolioTotalValue > 0 ? ((cashBalance / portfolioTotalValue) * 100).toFixed(2) : 0)}%`,
                              background: 'linear-gradient(90deg, #c5c6c7 0%, var(--text-primary) 100%)'
                            }}></div>
                          </div>
                          <div className="holding-info-row" style={{ fontSize: '0.75rem', marginTop: '-2px' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Cash allocation</span>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                              {portfolioMetrics ? portfolioMetrics.totals.cashAllocationPct : (portfolioTotalValue > 0 ? ((cashBalance / portfolioTotalValue) * 100).toFixed(2) : 0)}%
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Transaction Ledger Card */}
                <div className="dashboard-card" style={{ gridColumn: 'span 1' }}>
                  <div className="dashboard-card-header">
                    <h2><span>📝</span> Transaction History</h2>
                    <button className="btn-primary" onClick={handleOpenAddTxn}>
                      <span>➕</span> Add Transaction
                    </button>
                  </div>

                  {transactions.length === 0 ? (
                    <div className="no-transactions">
                      <p>This portfolio has no transactions.</p>
                      <button className="btn-primary" style={{ marginTop: '1rem' }} onClick={handleOpenAddTxn}>
                        Record Deposit
                      </button>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="custom-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Type</th>
                            <th>Ticker</th>
                            <th>Quantity</th>
                            <th>Price</th>
                            <th>Total Cost</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...transactions].reverse().map((t) => {
                            const isTrade = t.type === 'buy' || t.type === 'sell';
                            const totalAmount = t.amount ?? (parseFloat(t.quantity) * parseFloat(t.price));
                            return (
                              <tr key={t.timestamp}>
                                <td>{new Date(t.timestamp).toLocaleDateString()} {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                <td>
                                  <span className={`txn-badge ${t.type.toLowerCase()}`}>
                                    {t.type}
                                  </span>
                                </td>
                                <td style={{ fontWeight: 'bold' }}>{t.ticker || '-'}</td>
                                <td>{isTrade ? parseFloat(t.quantity).toLocaleString() : '-'}</td>
                                <td>{isTrade ? `${currencySymbol}${parseFloat(t.price).toFixed(2)}` : '-'}</td>
                                <td style={{ fontWeight: 600 }}>{currencySymbol}{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                <td style={{ textAlign: 'right' }}>
                                  <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                                    <button 
                                      type="button"
                                      className="action-btn edit" 
                                      onClick={() => handleOpenEditTxn(t)}
                                      aria-label="Edit transaction"
                                      title="Edit entry"
                                    >
                                      ✏️
                                    </button>
                                    <button 
                                      type="button"
                                      className="action-btn delete" 
                                      onClick={() => handleDeleteTxn(t.timestamp)}
                                      aria-label="Delete transaction"
                                      title="Delete entry"
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
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
                  <label className="form-label">Portfolio Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Technology Stocks, Retirement Fund"
                    value={portfolioForm.name}
                    onChange={(e) => setPortfolioForm({ ...portfolioForm, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea
                    className="form-textarea"
                    placeholder="Describe the strategy or goal of this portfolio..."
                    value={portfolioForm.description}
                    onChange={(e) => setPortfolioForm({ ...portfolioForm, description: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Base Currency</label>
                    <select
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
                  
                  <div className="form-group">
                    <label className="form-label">Cost Basis Method</label>
                    <select className="form-select" disabled>
                      <option>FIFO (First In, First Out)</option>
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
                    <label className="form-label">Transaction Type</label>
                    <select
                      className="form-select"
                      value={transactionForm.type}
                      onChange={(e) => setTransactionForm({ ...transactionForm, type: e.target.value })}
                      disabled={!!editingTransaction} // Lock type on edit to maintain ledger schema consistency
                    >
                      <option value="deposit">Deposit</option>
                      <option value="withdrawal">Withdrawal</option>
                      <option value="buy">Buy Asset</option>
                      <option value="sell">Sell Asset</option>
                      <option value="dividend">Dividend</option>
                      <option value="fee">Fee</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Date & Time</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={transactionForm.timestamp}
                      onChange={(e) => setTransactionForm({ ...transactionForm, timestamp: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {(transactionForm.type === 'buy' || transactionForm.type === 'sell') ? (
                  /* Trade Specific Fields */
                  <>
                    <div className="form-group">
                      <label className="form-label">Asset Ticker Symbol</label>
                      <input
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
                        <label className="form-label">Quantity (Shares)</label>
                        <input
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
                        <label className="form-label">Price per Share ({currencySymbol})</label>
                        <input
                          type="number"
                          step="any"
                          min="0.01"
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
                    <label className="form-label">Amount ({currencySymbol})</label>
                    <input
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

      {/* Footer */}
      <footer className="dashboard-footer">
        <p>&copy; 2026 Portfolio App. All rights reserved.</p>
      </footer>
    </div>
  );
}
