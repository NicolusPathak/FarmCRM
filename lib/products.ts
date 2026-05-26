// lib/products.ts — Server-side product catalog readers / writers.
//
// The catalog drives the new-order UI: staff see fixed prices, admin can
// override per-line during a transaction and can also edit the defaults
// here (which writes back through updateProduct).
//
// `serviceFeeFor(code)` is the canonical lookup the order create path
// uses to validate that staff orders match the published prices —
// keeping the rule in one place so the UI and server can't drift.

import { createSupabaseAdminClient } from './supabase-server';
import type { Product, ProductGroup } from '@/types';
import { clientError } from './api-error';

export async function listProducts(): Promise<Product[]> {
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from('products')
    .select('*')
    .is('archived_at', null)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('[products] list', error);
    throw new Error('Could not load products.');
  }
  return (data as Product[]) ?? [];
}

// Bucket products into the top-level cards shown on the order screen.
// Group label = the `group_label` of the lowest-sorted product in each
// group, so admin renaming the canonical row renames the card too.
export async function listProductGroups(): Promise<ProductGroup[]> {
  const products = await listProducts();
  const byGroup = new Map<string, ProductGroup>();
  for (const p of products) {
    const existing = byGroup.get(p.group_code);
    if (existing) {
      existing.products.push(p);
    } else {
      byGroup.set(p.group_code, {
        code: p.group_code,
        label: p.group_label,
        accent_color: p.accent_color,
        products: [p],
      });
    }
  }
  // Group sort: lowest sort_order in each group wins. After sorting,
  // refresh the group's accent_color from the lowest-sorted product so
  // the admin can change it on the canonical row and the card follows.
  const groups = Array.from(byGroup.values()).sort((a, b) => {
    const aMin = Math.min(...a.products.map((p) => p.sort_order));
    const bMin = Math.min(...b.products.map((p) => p.sort_order));
    return aMin - bMin;
  });
  for (const g of groups) {
    g.products.sort((a, b) => a.sort_order - b.sort_order);
    g.accent_color = g.products[0]?.accent_color ?? g.accent_color;
  }
  return groups;
}

export interface ProductUpdate {
  default_price?: number;
  service_fee?: number;
  accent_color?: string;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export async function updateProduct(id: string, patch: ProductUpdate): Promise<Product> {
  const sb = createSupabaseAdminClient();

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.default_price !== undefined) {
    const v = Number(patch.default_price);
    if (!Number.isFinite(v) || v < 0) clientError('Price must be a number ≥ 0.');
    update.default_price = Math.round(v * 100) / 100;
  }
  if (patch.service_fee !== undefined) {
    const v = Number(patch.service_fee);
    if (!Number.isFinite(v) || v < 0) clientError('Service fee must be a number ≥ 0.');
    update.service_fee = Math.round(v * 100) / 100;
  }
  if (patch.accent_color !== undefined) {
    const v = String(patch.accent_color).trim();
    if (!HEX_RE.test(v)) clientError('Accent color must be a 7-char hex (e.g. #B0322B).');
    update.accent_color = v;
  }

  const { data, error } = await sb
    .from('products')
    .update(update as any)
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error('[products] update', error);
    throw new Error('Could not update product.');
  }
  return data as Product;
}
