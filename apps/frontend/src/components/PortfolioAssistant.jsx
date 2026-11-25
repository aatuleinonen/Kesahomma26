// Turns a description of existing holdings into a reviewed portfolio.
import { useState } from 'react';
import { api } from '../utils/api';

const example = 'Name this portfolio Long-term holdings, in USD. I own 12 shares of AAPL with a total cost of $2,040 and 8 shares of MSFT with a total cost of $3,120.';
const emptyHolding = { ticker: '', quantity: '', costBasis: '' };

export default function PortfolioAssistant({ onCreated }) {
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState(null);
  const [requestId, setRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { draft: result } = await api.draftPortfolio(description.trim());
      setDraft(result);
      setRequestId(`portfolio-${crypto.randomUUID()}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { name, baseCurrency, description: summary, holdings } = draft;
      const { portfolio } = await api.createPortfolio({
        portfolioId: requestId,
        name,
        baseCurrency,
        description: summary,
        holdings: holdings.map(({ ticker, quantity, costBasis }) => ({
          ticker, quantity: Number(quantity), costBasis: Number(costBasis)
        }))
      });
      setDraft(null);
      setDescription('');
      onCreated(portfolio);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function updateHolding(index, field, value) {
    setDraft(current => ({
      ...current,
      holdings: current.holdings.map((holding, position) => position === index ? { ...holding, [field]: value } : holding)
    }));
  }

  return (
    <aside className="assistant-panel" id="portfolio-assistant" aria-labelledby="assistant-title" tabIndex={-1}>
      <span className="assistant-symbol" aria-hidden="true">✦</span>
      <h2 id="assistant-title">Build with AI</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      {draft ? (
        <form onSubmit={save}>
          <p>Review your portfolio before saving. Enter total original costs in the selected currency.</p>
          {draft.notes && <p className="assistant-note">{draft.notes}</p>}
          <fieldset disabled={busy} className="assistant-fields">
            <label>Portfolio name<input className="form-input" required maxLength={100} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>Description<input className="form-input" maxLength={500} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
            <label>Currency
              <select className="form-input" value={draft.baseCurrency} onChange={e => setDraft({ ...draft, baseCurrency: e.target.value })}>
                {['EUR', 'USD', 'GBP', 'JPY'].map(currency => <option key={currency}>{currency}</option>)}
              </select>
            </label>
            {draft.holdings.map((holding, index) => (
              <div className="draft-holding" key={index}>
                <label>Ticker<input className="form-input" required maxLength={20} value={holding.ticker} onChange={e => updateHolding(index, 'ticker', e.target.value)} /></label>
                <label>Shares<input className="form-input" required type="number" min="0.00000001" max="1000000000000" step="any" value={holding.quantity} onChange={e => updateHolding(index, 'quantity', e.target.value)} /></label>
                <label>Total original cost<input className="form-input" required type="number" min="0" max="1000000000000" step="any" value={holding.costBasis ?? ''} onChange={e => updateHolding(index, 'costBasis', e.target.value)} /></label>
                <button type="button" className="text-button" aria-label={`Remove holding ${index + 1}`} onClick={() => setDraft({ ...draft, holdings: draft.holdings.filter((_, position) => position !== index) })}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn-secondary" disabled={draft.holdings.length >= 20} onClick={() => setDraft({ ...draft, holdings: [...draft.holdings, { ...emptyHolding }] })}>Add holding</button>
            <button type="submit" className="btn-primary full-width">{busy ? 'Saving…' : 'Save portfolio'}</button>
            <button type="button" className="text-button" onClick={() => { setDraft(null); setError(''); }}>Back to description</button>
          </fieldset>
        </form>
      ) : (
        <form onSubmit={generate}>
          <p>Describe the investments you already hold. AI will prepare a draft you can review and edit.</p>
          <label className="form-label" htmlFor="holdings-description">Your holdings</label>
          <textarea id="holdings-description" className="form-textarea" required maxLength={2500} rows={5}
            placeholder="I own 12 shares of AAPL and 8 shares of MSFT…" value={description}
            onChange={e => setDescription(e.target.value)} disabled={busy} />
          <button type="button" className="example-button" disabled={busy} onClick={() => setDescription(example)}>Use an example <span aria-hidden="true">↗</span></button>
          <button type="submit" className="btn-primary full-width" disabled={busy || !description.trim()}>
            {busy ? 'Drafting…' : 'Generate draft'} <span aria-hidden="true">→</span>
          </button>
          <p className="assistant-notice">Amazon Bedrock processes your description using global routing. Leave out account numbers and other personal details.</p>
        </form>
      )}
    </aside>
  );
}
