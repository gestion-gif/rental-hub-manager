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
import { crumb } from "@/src/utils/diag";

WebBrowser.maybeCompleteAuthSession();

type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  role?: string;
  member_role?: string;
  permissions?: string[];
  allowed_property_ids?: string[] | null;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  signingIn: boolean;
  signIn: () => Promise<void>;
  loginWithApple: (identityToken: string, name: string, email: string, authorizationCode?: string) => Promise<void>;
  signOut: () => Promise<void>;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  registerOwner: (name: string, email: string, password: string) => Promise<void>;
  acceptInvite: (token: string, password: string) => Promise<void>;
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
    crumb("exchange:start");
    try {
      const data = await api.post("/auth/session", { session_id: sessionId });
      crumb("exchange:session-ok");
      setToken(data.session_token);
      await storage.secureSet(TOKEN_KEY, data.session_token);
      // Récupère le profil complet (role, permissions, billing…) comme les autres flux de connexion
      try {
        const me = await api.get("/auth/me");
        crumb("exchange:me-ok");
        setUser(me);
      } catch {
        crumb("exchange:me-fail");
        setUser(data.user);
      }
    } catch (e) {
      crumb("exchange:error", String((e as any)?.message || e).slice(0, 200));
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
      crumb("google:open-browser");
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
      crumb(`google:browser-result:${result.type}`);
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

  async function loginWithPassword(email: string, password: string) {
    const data = await api.post("/auth/login", { email, password });
    setToken(data.session_token);
    await storage.secureSet(TOKEN_KEY, data.session_token);
    // Fetch the full profile (permissions, allowed properties) for UI enforcement
    try {
      setUser(await api.get("/auth/me"));
    } catch {
      setUser(data.user);
    }
  }

  async function loginWithApple(identityToken: string, name: string, email: string, authorizationCode = "") {
    const data = await api.post("/auth/apple", { identity_token: identityToken, name, email, authorization_code: authorizationCode });
    setToken(data.session_token);
    await storage.secureSet(TOKEN_KEY, data.session_token);
    try {
      setUser(await api.get("/auth/me"));
    } catch {
      setUser(data.user);
    }
  }

  async function registerOwner(name: string, email: string, password: string) {
    const data = await api.post("/auth/register", { name, email, password });
    setToken(data.session_token);
    await storage.secureSet(TOKEN_KEY, data.session_token);
    try {
      setUser(await api.get("/auth/me"));
    } catch {
      setUser(data.user);
    }
  }

  async function acceptInvite(token: string, password: string) {
    const data = await api.post("/auth/accept-invite", { token, password });
    setToken(data.session_token);
    await storage.secureSet(TOKEN_KEY, data.session_token);
    try {
      setUser(await api.get("/auth/me"));
    } catch {
      setUser(data.user);
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, signingIn, signIn, signOut, loginWithPassword, loginWithApple, acceptInvite, registerOwner }}
    >
      {children}
    </AuthContext.Provider>
  );
}
