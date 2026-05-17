// lib/supabase-browser.ts — Browser-only Supabase client
// Safe to import in Client Components. No server-only APIs.
import { createBrowserClient } from '@supabase/ssr';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function createBrowserSupabaseClient() {
  return createBrowserClient(URL, ANON);
}
