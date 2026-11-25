// Builds a ledger-based balance history using the dashboard's average-cost calculation.
export function summarizeLedger(transactions) {
  const holdings = new Map();
  const history = [];
  let cash = 0;
  let costBasis = 0;
  const sorted = [...transactions].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  for (const { ticker, type, quantity, price, amount, timestamp } of sorted) {
    const shares = Number(quantity) || 0;
    const total = Number(amount ?? shares * (Number(price) || 0));
    if (type === 'buy' || type === 'transfer_in') {
      const position = holdings.get(ticker) || { quantity: 0, totalCost: 0 };
      const nextQuantity = position.quantity + shares;
      const nextCost = position.totalCost + total;
      holdings.set(ticker, { quantity: nextQuantity, totalCost: nextCost, averageCost: nextCost / nextQuantity });
      costBasis += total;
    } else if (type === 'sell' && holdings.has(ticker)) {
      const position = holdings.get(ticker);
      const remaining = position.quantity - shares;
      const remainingCost = remaining > 1e-9 ? remaining * position.averageCost : 0;
      costBasis += remainingCost - position.totalCost;
      if (remaining > 1e-9) {
        holdings.set(ticker, { ...position, quantity: remaining, totalCost: remainingCost });
      } else {
        holdings.delete(ticker);
      }
    }
    if (['deposit', 'sell', 'dividend'].includes(type)) cash += total;
    if (['withdrawal', 'buy', 'fee'].includes(type)) cash -= total;
    history.push({ timestamp, balance: Number((cash + costBasis).toFixed(2)) });
  }
  return { holdings, history };
}
