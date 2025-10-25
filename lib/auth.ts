import { createClient } from '@supabase/supabase-js';
import { User as SupabaseUser } from '@supabase/supabase-js';

// Create a separate supabase client for auth to avoid circular dependencies
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ympaupxfiizwgflbomfg.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltcGF1cHhmaWl6d2dmbGJvbWZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEzNTM3MDEsImV4cCI6MjA3NjkyOTcwMX0.j_AsLlRzkh_BlrOskDywnUgyxykaHldVG2rHyDEKkwg';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface User {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResult {
  success: boolean;
  user?: User;
  error?: string;
}

// Simple authentication functions using Supabase Auth
export class AuthService {
  // Login with email and password using Supabase Auth
  static async login(credentials: LoginCredentials): Promise<LoginResult> {
    try {
      const { email, password } = credentials;

      // Use Supabase Auth for login
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        return {
          success: false,
          error: error.message
        };
      }

      if (!data.user) {
        return {
          success: false,
          error: 'Login failed'
        };
      }

      // Get user profile from public.users table
      const { data: userProfile, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('id', data.user.id)
        .single();

      if (profileError && profileError.code !== 'PGRST116') {
        console.error('Profile fetch error:', profileError);
      }

      const user: User = {
        id: data.user.id,
        email: data.user.email || '',
        first_name: userProfile?.first_name || '',
        last_name: userProfile?.last_name || '',
        avatar_url: userProfile?.avatar_url || '',
        created_at: userProfile?.created_at || data.user.created_at,
        updated_at: userProfile?.updated_at || data.user.updated_at
      };

      return {
        success: true,
        user
      };
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: 'Login failed. Please try again.'
      };
    }
  }

  // Register new user using Supabase Auth
  static async register(userData: {
    email: string;
    password: string;
    first_name?: string;
    last_name?: string;
  }): Promise<LoginResult> {
    try {
      const { email, password, first_name, last_name } = userData;

      // Use Supabase Auth for registration
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: first_name || '',
            last_name: last_name || ''
          }
        }
      });

      if (error) {
        return {
          success: false,
          error: error.message
        };
      }

      if (!data.user) {
        return {
          success: false,
          error: 'Registration failed'
        };
      }

      // The user profile will be automatically created by the trigger
      const user: User = {
        id: data.user.id,
        email: data.user.email || '',
        first_name: first_name || '',
        last_name: last_name || '',
        avatar_url: '',
        created_at: data.user.created_at,
        updated_at: data.user.updated_at
      };

      return {
        success: true,
        user
      };
    } catch (error) {
      console.error('Registration error:', error);
      return {
        success: false,
        error: 'Registration failed. Please try again.'
      };
    }
  }

  // Verify session using Supabase Auth
  static async verifySession(): Promise<User | null> {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error || !session) {
        return null;
      }

      // Get user profile from public.users table
      const { data: userProfile, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (profileError && profileError.code !== 'PGRST116') {
        console.error('Profile fetch error:', profileError);
      }

      const user: User = {
        id: session.user.id,
        email: session.user.email || '',
        first_name: userProfile?.first_name || '',
        last_name: userProfile?.last_name || '',
        avatar_url: userProfile?.avatar_url || '',
        created_at: userProfile?.created_at || session.user.created_at,
        updated_at: userProfile?.updated_at || session.user.updated_at
      };

      return user;
    } catch (error) {
      console.error('Session verification error:', error);
      return null;
    }
  }

  // Logout using Supabase Auth
  static async logout(): Promise<boolean> {
    try {
      const { error } = await supabase.auth.signOut();
      return !error;
    } catch (error) {
      console.error('Logout error:', error);
      return false;
    }
  }

  // Get current user
  static async getCurrentUser(): Promise<User | null> {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error || !user) {
        return null;
      }

      // Get user profile from public.users table
      const { data: userProfile, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileError && profileError.code !== 'PGRST116') {
        console.error('Profile fetch error:', profileError);
      }

      const userData: User = {
        id: user.id,
        email: user.email || '',
        first_name: userProfile?.first_name || '',
        last_name: userProfile?.last_name || '',
        avatar_url: userProfile?.avatar_url || '',
        created_at: userProfile?.created_at || user.created_at,
        updated_at: userProfile?.updated_at || user.updated_at
      };

      return userData;
    } catch (error) {
      console.error('Get current user error:', error);
      return null;
    }
  }
}
