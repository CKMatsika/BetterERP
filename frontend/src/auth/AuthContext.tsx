import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken as persistToken } from "../api/client";
import type { CurrentUser, LoginResponse } from "../api/types";
import { ApiError } from "../api/client";

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPerm: (perm: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.get<CurrentUser>("/api/auth/me");
        if (!cancelled) setUser(me);
      } catch {
        persistToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    hydrate();
    const onExpired = () => setUser(null);
    window.addEventListener("auth:expired", onExpired);
    return () => {
      cancelled = true;
      window.removeEventListener("auth:expired", onExpired);
    };
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.post<LoginResponse>("/api/auth/login", { username, password });
    persistToken(res.token);
    setUser(res.user);
  };

  const logout = async () => {
    try {
      await api.post("/api/auth/logout");
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    } finally {
      persistToken(null);
      setUser(null);
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await api.post("/api/auth/change-password", { currentPassword, newPassword });
    setUser((current) => current ? { ...current, mustChangePassword: false } : current);
  };

  const hasPerm = (perm: string) => Boolean(user?.permissions.includes(perm));

  return <AuthContext.Provider value={{ user, loading, login, changePassword, logout, hasPerm }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}