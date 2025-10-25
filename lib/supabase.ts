import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ympaupxfiizwgflbomfg.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltcGF1cHhmaWl6d2dmbGJvbWZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEzNTM3MDEsImV4cCI6MjA3NjkyOTcwMX0.j_AsLlRzkh_BlrOskDywnUgyxykaHldVG2rHyDEKkwg';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
