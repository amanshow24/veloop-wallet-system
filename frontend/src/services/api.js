export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'
).replace(/\/+$/, '');

const TOKEN_KEY = 'veloop.auth.token';

export function getStoredToken() {
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function storeToken(token) {
  window.sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken() {
  window.sessionStorage.removeItem(TOKEN_KEY);
}

async function request(
  path,
  { method = 'GET', body, authenticated = true, headers: additionalHeaders = {} } = {},
) {
  const headers = { Accept: 'application/json', ...additionalHeaders };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const token = authenticated ? getStoredToken() : null;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('Unable to reach the VELoop API. Check that the backend is running.');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The API returned an unreadable response.');
  }

  if (!response.ok) {
    if (
      authenticated &&
      (response.status === 401 || (path === '/auth/me' && response.status === 403))
    ) {
      clearStoredToken();
      window.dispatchEvent(
        new CustomEvent('veloop:unauthorized', {
          detail: { message: payload.message || 'Your session is no longer active.' },
        }),
      );
    }
    throw new Error(payload.message || 'The request could not be completed.');
  }
  return payload;
}

const api = {
  register: (details) =>
    request('/auth/register', { method: 'POST', body: details, authenticated: false }),
  login: (credentials) =>
    request('/auth/login', { method: 'POST', body: credentials, authenticated: false }),
  currentUser: () => request('/auth/me'),
  wallet: () => request('/wallet'),
  transactions: ({ page = 1, limit = 20 } = {}) =>
    request(`/wallet/transactions?page=${page}&limit=${limit}`),
  payoutMethods: () => request('/payout/methods'),
  payoutOptions: (methodId) =>
    request(`/payout/options/?method=${encodeURIComponent(methodId)}`),
  createWithdrawal: ({ method, optionId, payoutDetails, idempotencyKey }) =>
    request('/withdrawals', {
      method: 'POST',
      body: { method, optionId, payoutDetails },
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
};
export default api;
