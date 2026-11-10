import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { clearStoredToken, getStoredToken, storeToken } from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => getStoredToken());
  const [loading, setLoading] = useState(Boolean(getStoredToken()));
  const [error, setError] = useState('');

  const logout = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setUser(null);
    setError('');
  }, []);

  useEffect(() => {
    const handleUnauthorized = (event) => {
      setToken(null);
      setUser(null);
      setError(event.detail?.message || 'Your session expired. Please sign in again.');
      setLoading(false);
    };
    window.addEventListener('veloop:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('veloop:unauthorized', handleUnauthorized);
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);
    api
      .currentUser()
      .then(({ user: currentUser }) => {
        if (active) {
          setUser(currentUser);
          setError('');
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [token]);

  const login = useCallback(async (credentials) => {
    setError('');
    const result = await api.login(credentials);
    storeToken(result.token);
    setToken(result.token);
    setUser(result.user);
    return result.user;
  }, []);

  const register = useCallback(async (details) => {
    setError('');
    const result = await api.register(details);
    storeToken(result.token);
    setToken(result.token);
    setUser(result.user);
    return result.user;
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, error, login, register, logout }),
    [user, token, loading, error, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
}
