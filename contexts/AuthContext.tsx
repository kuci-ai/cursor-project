'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { AuthService, User, LoginResult } from '@/lib/auth';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string, firstName?: string, lastName?: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  sessionToken: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  useEffect(() => {
    // Check for existing session on app load using Supabase Auth
    const checkSession = async () => {
      try {
        const user = await AuthService.verifySession();
        if (user) {
          setUser(user);
          setSessionToken('supabase_session'); // Supabase handles session tokens internally
        }
      } catch (error) {
        console.error('Session check error:', error);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, []);

  const signUp = async (email: string, password: string, firstName?: string, lastName?: string) => {
    try {
      const result = await AuthService.register({
        email,
        password,
        first_name: firstName,
        last_name: lastName
      });

      if (result.success) {
        return { error: null };
      } else {
        return { error: { message: result.error || 'Registration failed' } };
      }
    } catch (error) {
      console.error('Sign up error:', error);
      return { error: { message: 'Registration failed. Please try again.' } };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const result: LoginResult = await AuthService.login({ email, password });
      
      if (result.success && result.user) {
        setUser(result.user);
        setSessionToken('supabase_session'); // Supabase handles session tokens internally
        return { error: null };
      } else {
        return { error: { message: result.error || 'Login failed' } };
      }
    } catch (error) {
      console.error('Sign in error:', error);
      return { error: { message: 'Login failed. Please try again.' } };
    }
  };

  const signOut = async () => {
    try {
      await AuthService.logout();
      setUser(null);
      setSessionToken(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signOut, sessionToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
