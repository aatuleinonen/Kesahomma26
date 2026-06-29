import { fetchAuthSession } from 'aws-amplify/auth';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function getAuthHeaders() {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.accessToken?.toString();
    if (!token) {
      console.warn("No active Cognito access token found in session.");
      return {};
    }
    return {
      'Authorization': `Bearer ${token}`
    };
  } catch (error) {
    console.error("Failed to retrieve auth session tokens:", error);
    return {};
  }
}

async function request(path, options = {}) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Request failed with status ${res.status}`);
  }
  return data;
}

export const api = {
  // Portfolios
  getPortfolios() {
    return request('/api/portfolios');
  },
  createPortfolio(portfolio) {
    return request('/api/portfolios', {
      method: 'POST',
      body: JSON.stringify(portfolio)
    });
  },

  // Holdings
  getHoldings(portfolioId) {
    return request(`/api/portfolios/${portfolioId}/holdings`);
  },

  // Transactions
  getTransactions(portfolioId) {
    return request(`/api/portfolios/${portfolioId}/transactions`);
  },
  createTransaction(portfolioId, txn) {
    return request(`/api/portfolios/${portfolioId}/transactions`, {
      method: 'POST',
      body: JSON.stringify(txn)
    });
  },
  updateTransaction(portfolioId, oldTimestamp, txn) {
    return request(`/api/portfolios/${portfolioId}/transactions/${oldTimestamp}`, {
      method: 'PUT',
      body: JSON.stringify(txn)
    });
  },
  deleteTransaction(portfolioId, timestamp) {
    return request(`/api/portfolios/${portfolioId}/transactions/${timestamp}`, {
      method: 'DELETE'
    });
  }
};
