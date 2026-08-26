"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  ApiError,
  loginUser,
  registerUser,
  setAuthToken,
  type AuthResponse,
} from "@/lib/api";

interface AuthUser {
  id: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** True while the initial sessionStorage check is running, so pages
   *  can avoid a flash of "logged out" content before it resolves. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "docusense_auth";

function persist(auth: AuthResponse) {
  setAuthToken(auth.access_token);
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      token: auth.access_token,
      id: auth.user_id,
      email: auth.email,
    })
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On first load, restore a session from sessionStorage (survives a
  // page refresh, cleared when the tab closes).
  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setAuthToken(parsed.token);
        setUser({ id: parsed.id, email: parsed.email });
      } catch {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const auth = await loginUser(email, password);
    persist(auth);
    setUser({ id: auth.user_id, email: auth.email });
  };

  const register = async (email: string, password: string) => {
    const auth = await registerUser(email, password);
    persist(auth);
    setUser({ id: auth.user_id, email: auth.email });
  };

  const logout = () => {
    setAuthToken(null);
    sessionStorage.removeItem(STORAGE_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export { ApiError };