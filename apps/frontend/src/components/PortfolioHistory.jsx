// Renders a chart from the latest recorded balance on each active ledger date.
const dateLabel = timestamp => new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function PortfolioHistory({ history, formatMoney }) {
  if (!history.length) {
    return <div className="chart-empty">Record a transaction to see your balance history.</div>;
  }

  // Group by local ledger date, using the closing balance for each day with activity.
  const days = [...new Map(history.map(point => [dateLabel(point.timestamp), point])).values()];
  const displayCount = Math.min(days.length, 32);
  const points = Array.from({ length: displayCount }, (_, index) =>
    days[displayCount === 1 ? 0 : Math.round(index * (days.length - 1) / (displayCount - 1))]
  );
  const min = Math.min(0, ...points.map(point => point.balance));
  const max = Math.max(0, ...points.map(point => point.balance));
  const span = max - min || 1;
  const baseline = -min / span * 100;

  return (
    <>
      <figure className="history-chart">
        <div className="chart-bars" aria-hidden="true">
          <div className="chart-baseline" style={{ bottom: `${baseline}%` }} />
          {points.map(({ timestamp, balance }) => (
            <div className="chart-column" key={timestamp} title={`${dateLabel(timestamp)} · ${formatMoney(balance)}`}>
              <div className={balance < 0 ? 'chart-bar negative' : 'chart-bar'} style={{
                bottom: `${baseline + Math.min(balance, 0) / span * 100}%`,
                height: `${Math.abs(balance) / span * 100}%`
              }} />
            </div>
          ))}
        </div>
        <figcaption><span>{dateLabel(days[0].timestamp)}</span><span>{days.length > 1 ? dateLabel(days.at(-1).timestamp) : ''}</span></figcaption>
      </figure>
      <details className="chart-data">
        <summary>View chart data</summary>
        <div className="table-responsive">
          <table className="custom-table" aria-label="Plotted ledger balances">
            <thead><tr><th scope="col">Date</th><th scope="col">Ledger balance</th></tr></thead>
            <tbody>
              {points.map(({ timestamp, balance }) => (
                <tr key={timestamp}><th scope="row">{dateLabel(timestamp)}</th><td>{formatMoney(balance)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
