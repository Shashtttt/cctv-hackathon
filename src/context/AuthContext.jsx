import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('ibvap_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(() => localStorage.getItem('ibvap_token') || null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Set default auth header on axios
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  // Validate active token on initial mount
  useEffect(() => {
    const verifyMe = async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const res = await axios.get('/api/v1/auth/me');
        setUser(res.data);
        localStorage.setItem('ibvap_user', JSON.stringify(res.data));
      } catch (err) {
        console.debug('Session check fallback or expired token:', err?.message);
        // Keep existing user if offline, or clear if 401
        if (err?.response?.status === 401) {
          logout();
        }
      } finally {
        setLoading(false);
      }
    };
    verifyMe();
  }, [token]);

  const login = async (username, password) => {
    setAuthError(null);
    try {
      const res = await axios.post('/api/v1/auth/login', { username, password });
      const { access_token, user: userData } = res.data;
      setToken(access_token);
      setUser(userData);
      localStorage.setItem('ibvap_token', access_token);
      localStorage.setItem('ibvap_user', JSON.stringify(userData));
      return { success: true, user: userData };
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Authentication failed. Invalid clearance.';
      setAuthError(msg);
      return { success: false, error: msg };
    }
  };

  const register = async (formData) => {
    setAuthError(null);
    try {
      const res = await axios.post('/api/v1/auth/register', formData);
      const { access_token, user: userData } = res.data;
      setToken(access_token);
      setUser(userData);
      localStorage.setItem('ibvap_token', access_token);
      localStorage.setItem('ibvap_user', JSON.stringify(userData));
      return { success: true, user: userData };
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Registration failed. Check user details.';
      setAuthError(msg);
      return { success: false, error: msg };
    }
  };

  const demoLogin = async (role = 'COMMANDER') => {
    if (role === 'COMMANDER') {
      return await login('commander', 'password123');
    } else {
      return await login('operator', 'password123');
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('ibvap_token');
    localStorage.removeItem('ibvap_user');
    delete axios.defaults.headers.common['Authorization'];
    axios.post('/api/v1/auth/logout').catch(() => {});
  };

  const value = {
    user,
    token,
    isAuthenticated: !!user,
    loading,
    authError,
    setAuthError,
    login,
    register,
    demoLogin,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
