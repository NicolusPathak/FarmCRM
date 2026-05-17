// lib/supabase-server.ts — Server-only Supabase clients
// ONLY import in Server Components, Route Handlers, middleware.
// Never import in Client Components.
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function createSupabaseServerClient() {
  const jar = await cookies();
  return createServerClient(URL, ANON, {
    cookies: {
      getAll:  ()      => jar.getAll(),
      setAll: (pairs) => {
        try { pairs.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch {}
      },
    },
  });
}

export function createSupabaseAdminClient() {
  return createClient(URL, SVC, { auth: { autoRefreshToken: false, persistSession: false } });
}
