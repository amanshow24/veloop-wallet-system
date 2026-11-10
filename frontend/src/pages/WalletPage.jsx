import { Link } from 'react-router-dom';
import { Alert, EmptyState, LoadingState } from '../components/Feedback.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useWallet } from '../context/WalletContext.jsx';
import { formatAmount, formatDate } from '../hooks/useCurrencyFormat.js';

const BALANCE_CARDS = [
  { field: 'ves', label: 'VEs', symbol: 'V', tone: 'violet' },
  { field: 'sves', label: 'SVEs', symbol: 'S', tone: 'blue' },
  { field: 'gems', label: 'Gems', symbol: 'G', tone: 'pink' },
  { field: 'tokens', label: 'Tokens', symbol: 'T', tone: 'amber' },
  { field: 'spins', label: 'Spins', symbol: '↻', tone: 'green' },
];

const DEBIT_TYPES = new Set(['DEBIT', 'WITHDRAWAL', 'EXCHANGE_DEBIT', 'ADMIN_DEBIT']);

function WalletPage() {
  const { user } = useAuth();
  const {
    wallet,
    transactions,
    pagination,
    loading,
    refreshing,
    error,
    historyError,
    refreshWallet,
    loadTransactions,
  } = useWallet();

  if (loading) {
    return <LoadingState label="Loading your wallet…" />;
  }

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">Your rewards</p>
          <h1>Wallet</h1>
          <p className="muted-copy">
            Welcome{user?.name ? `, ${user.name}` : ''}. Here is your current wallet activity.
          </p>
        </div>
        <div className="welcome-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void refreshWallet(pagination.page || 1)}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <Link className="button button-primary" to="/payout">Redeem rewards</Link>
        </div>
      </section>

      {error ? (
        <Alert>
          <span>{error} </span>
          <button className="alert-action" type="button" onClick={() => void refreshWallet(1)}>
            Try again
          </button>
        </Alert>
      ) : null}

      {wallet ? (
        <section className="balance-grid" aria-label="Wallet balances">
          {BALANCE_CARDS.map(({ field, label, symbol, tone }) => (
            <article className="balance-card" key={field}>
              <div className={`balance-symbol tone-${tone}`} aria-hidden="true">{symbol}</div>
              <p className="balance-label">{label}</p>
              <p className="balance-value">{formatAmount(wallet[field])}</p>
            </article>
          ))}
        </section>
      ) : (
        <section className="panel">
          <EmptyState title="Wallet unavailable">
            Your wallet could not be loaded. Refresh to try again.
          </EmptyState>
        </section>
      )}

      <section className="panel transaction-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Account activity</p>
            <h2>Recent transactions</h2>
          </div>
          <span className="subtle-count">{pagination.total} total</span>
        </div>

        {historyError ? (
          <Alert>
            <span>{historyError} </span>
            <button
              className="alert-action"
              type="button"
              onClick={() => void loadTransactions(pagination.page || 1)}
            >
              Retry
            </button>
          </Alert>
        ) : null}

        {!transactions.length ? (
          <EmptyState title="No transactions yet">
            Your wallet activity will appear here when rewards or redemptions are recorded.
          </EmptyState>
        ) : (
          <>
            <div className="table-scroll">
              <table className="transaction-table">
                <thead>
                  <tr>
                    <th scope="col">Transaction</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Status</th>
                    <th scope="col">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((transaction) => {
                    const isDebit = DEBIT_TYPES.has(transaction.type);
                    return (
                      <tr key={transaction.transactionId}>
                        <td>
                          <span className="transaction-type">{formatType(transaction.type)}</span>
                          <span className="transaction-description">{transaction.description}</span>
                          <span className="transaction-currency">{transaction.currency}</span>
                        </td>
                        <td className={isDebit ? 'amount-negative' : 'amount-positive'}>
                          {isDebit ? '−' : '+'}{formatAmount(transaction.amount)}{' '}
                          <span>{transaction.currency}</span>
                        </td>
                        <td>
                          <span className={`status-badge status-${transaction.status?.toLowerCase()}`}>
                            {formatType(transaction.status)}
                          </span>
                        </td>
                        <td className="date-cell">{formatDate(transaction.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {pagination.pages > 1 ? (
              <div className="pagination">
                <span>Page {pagination.page} of {pagination.pages}</span>
                <div className="pagination-actions">
                  <button
                    className="button button-small button-secondary"
                    type="button"
                    disabled={pagination.page <= 1}
                    onClick={() => void loadTransactions(pagination.page - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="button button-small button-secondary"
                    type="button"
                    disabled={pagination.page >= pagination.pages}
                    onClick={() => void loadTransactions(pagination.page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function formatType(value) {
  if (!value) {
    return 'Unknown';
  }
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default WalletPage;
