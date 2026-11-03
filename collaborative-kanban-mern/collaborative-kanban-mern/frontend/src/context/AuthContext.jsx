import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api, { getToken, setToken, setUnauthorizedHandler } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setTokenState] = useState(getToken());
  const [loading, setLoading] = useState(Boolean(getToken()));

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  // Restore the session on page load.
  useEffect(() => {
    if (!token) return;
    api
      .get('/auth/me')
      .then((r) => setUser(r.data.user))
      .catch(logout)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (data) => {
    setToken(data.token);
    setTokenState(data.token);
    setUser(data.user);
  };

  const login = async (email, password) => finish((await api.post('/auth/login', { email, password })).data);
  const register = async (name, email, password) =>
    finish((await api.post('/auth/register', { name, email, password })).data);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
