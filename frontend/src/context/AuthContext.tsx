import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { storage } from "@/src/utils/storage";
import { api, setToken, TOKEN_KEY } from "@/src/api";

WebBrowser.maybeCompleteAuthSession();

type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  signingIn: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({} as AuthState);

export const useAuth = () => useContext(AuthContext);

const AUTH_BASE = "https://auth.emergentagent.com/";

function extractSessionId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const handledIds = useRef<Set<string>>(new Set());

  async function exchange(sessionId: string) {
    if (handledIds.current.has(sessionId)) return;
    handledIds.current.add(sessionId);
    try {
      const data = await api.post("/auth/session", { session_id: sessionId });
      setToken(data.session_token);
      await storage.secureSet(TOKEN_KEY, data.session_token);
      setUser(data.user);
    } catch (e) {
      // silent — user stays on login
    } finally {
      setSigningIn(false);
    }
  }

  async function checkExisting() {
    try {
      const me = await api.get("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Web: process session_id from URL first
    if (Platform.OS === "web") {
      const url =
        typeof window !== "undefined"
          ? window.location.href
          : null;
      const sid = extractSessionId(url);
      if (sid) {
        setSigningIn(true);
        exchange(sid).then(() => {
          setLoading(false);
          if (typeof window !== "undefined") {
            const clean = window.location.origin + window.location.pathname;
            window.history.replaceState(window.history.state, "", clean);
          }
        });
        return;
      }
    }
    checkExisting();

    if (Platform.OS !== "web") {
      const sub = Linking.addEventListener("url", ({ url }) => {
        const sid = extractSessionId(url);
        if (sid) exchange(sid);
      });
      Linking.getInitialURL().then((url) => {
        const sid = extractSessionId(url);
        if (sid) exchange(sid);
      });
      return () => sub.remove();
    }
  }, []);

  async function signIn() {
    setSigningIn(true);
    try {
      if (Platform.OS === "web") {
        const redirect = window.location.origin + "/";
        window.location.href = `${AUTH_BASE}?redirect=${encodeURIComponent(
          redirect,
        )}`;
        return;
      }
      const redirect = Linking.createURL("");
      const authUrl = `${AUTH_BASE}?redirect=${encodeURIComponent(redirect)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
      let sid: string | null = null;
      if (result.type === "success" && result.url) {
        sid = extractSessionId(result.url);
      }
      if (!sid) {
        const initial = await Linking.getInitialURL();
        sid = extractSessionId(initial);
      }
      if (sid) {
        await exchange(sid);
      } else {
        setSigningIn(false);
      }
    } catch {
      setSigningIn(false);
    }
  }

  async function signOut() {
    try {
      await api.post("/auth/logout");
    } catch {}
    setToken(null);
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, signingIn, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
