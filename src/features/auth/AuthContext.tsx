import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getDataClient } from '@/data/client';
import type { Profile, SessionUser } from '@/data/types';
import { can as canDo, type Action, type Resource } from '@/domain/permissions';

interface AuthState {
  loading: boolean;
  user: SessionUser | null;
  profile: Profile | null;
  can: (resource: Resource, action?: Action) => boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const client = getDataClient();

  const loadProfile = useCallback(
    async (u: SessionUser | null) => {
      if (!u) {
        setProfile(null);
        return;
      }
      try {
        setProfile(await client.get<Profile>('profiles', u.id));
      } catch {
        setProfile(null);
      }
    },
    [client]
  );

  useEffect(() => {
    let alive = true;
    client.auth.getUser().then(async (u) => {
      if (!alive) return;
      setUser(u);
      await loadProfile(u);
      setLoading(false);
    });
    const off = client.auth.onChange(async (u) => {
      setUser(u);
      await loadProfile(u);
      setLoading(false);
    });
    return () => {
      alive = false;
      off();
    };
  }, [client, loadProfile]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      user,
      profile,
      can: (r, a = 'view') => !!profile?.active && canDo(profile.role, r, a),
      refreshProfile: () => loadProfile(user),
      signOut: () => client.auth.signOut()
    }),
    [loading, user, profile, client, loadProfile]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}
