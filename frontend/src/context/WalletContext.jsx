import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api.js';
import { useAuth } from './AuthContext.jsx';

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
  const { user } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');

  const loadTransactions = useCallback(async (page = 1) => {
    setHistoryError('');
    try {
      const result = await api.transactions({ page, limit: pagination.limit });
      setTransactions(result.transactions);
      setPagination(result.pagination);
      return true;
    } catch (requestError) {
      setHistoryError(requestError.message);
      return false;
    }
  }, [pagination.limit]);

  const refreshWallet = useCallback(async (page = 1) => {
    setRefreshing(true);
    setError('');
    setHistoryError('');
    try {
      const [walletResult, transactionResult] = await Promise.all([
        api.wallet(),
        api.transactions({ page, limit: pagination.limit }),
      ]);
      setWallet(walletResult.wallet);
      setTransactions(transactionResult.transactions);
      setPagination(transactionResult.pagination);
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [pagination.limit]);

  useEffect(() => {
    if (user) {
      void refreshWallet(1);
    }
  }, [user, refreshWallet]);

  const value = useMemo(
    () => ({
      wallet,
      transactions,
      pagination,
      loading,
      refreshing,
      error,
      historyError,
      refreshWallet,
      loadTransactions,
    }),
    [
      wallet,
      transactions,
      pagination,
      loading,
      refreshing,
      error,
      historyError,
      refreshWallet,
      loadTransactions,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider.');
  }
  return context;
}
