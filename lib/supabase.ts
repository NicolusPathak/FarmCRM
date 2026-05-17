// lib/supabase.ts — Compatibility re-exports
// Server code: createServerClient, createAdminClient
// Browser code: createBrowserClient
//
// NOTE: This file imports next/headers, so it's SERVER-ONLY.
// Client Components must import from '@/lib/supabase-browser' directly.

export { createSupabaseServerClient as createServerClient } from './supabase-server';
export { createSupabaseAdminClient  as createAdminClient  } from './supabase-server';
export { createBrowserSupabaseClient as createBrowserClient } from './supabase-browser';
