'use client';

import { createContext, useContext, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { User, UserSettings, Household } from '@moneypulse/shared';

interface MeData {
  user: User;
  settings: UserSettings | null;
  household: Household | null;
  mustChangePassword: boolean;
}

interface AuthContextValue {
  user: User | null;
  settings: UserSettings | null;
  household: Household | null;
  mustChangePassword: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ mustChangePassword: boolean }>;
  logout: () => Promise<void>;
  refetchUser: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ data: MeData }>('/users/me'),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      return api.post<{ data: { user: User; mustChangePassword: boolean } }>(
        '/auth/login',
        { email, password },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => {
      queryClient.clear();
      window.location.href = '/login';
    },
  });

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await loginMutation.mutateAsync({ email, password });
      return { mustChangePassword: result.data.mustChangePassword };
    },
    [loginMutation],
  );

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const meData = data?.data ?? null;

  const value: AuthContextValue = {
    user: meData?.user ?? null,
    settings: meData?.settings ?? null,
    household: meData?.household ?? null,
    mustChangePassword: meData?.mustChangePassword ?? false,
    isLoading,
    isAuthenticated: !!meData?.user,
    login,
    logout,
    refetchUser: refetch,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
