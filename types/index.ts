// ============================================================
// types/index.ts — App-level TypeScript types
// ============================================================

export interface Customer {
  id: string;
  customer_number: string;
  full_name: string;
  phone_number: string | null;
  street: string | null;
  city: string | null;
  zip_code: string | null;
  points_balance: number;
  created_at: string;
  archived_at: string | null;
}

export type OrderStatus = 'active' | 'void';

export type PaymentMethod = 'cash' | 'card' | 'zelle';
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'zelle'];
export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === 'string' && (PAYMENT_METHODS as string[]).includes(v);
}
export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash:  'Cash',
  card:  'Card',
  zelle: 'Zelle',
};

export interface OrderLogEntry {
  timestamp: string;
  type: 'created' | 'modified' | 'voided' | 'reassigned';
  summary: string;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id: string;
  order_date: string;
  subtotal: number;
  total: number;
  points_earned: number;
  points_redeemed: number;
  redemption_discount: number;
  notes: string | null;
  status: OrderStatus;
  payment_method: PaymentMethod;
  change_log: OrderLogEntry[];
  created_at: string;
  // Who created the order. created_by is the FK to staff_users (nullable on
  // old orders and when the original staff is later deleted). created_by_name
  // is the snapshot of the staff name at create time — admins can also edit
  // it directly on legacy orders that have no FK.
  created_by: string | null;
  created_by_name: string | null;
  // Joined fields (optional — present when queried with select)
  customer?: Pick<Customer, 'id' | 'full_name' | 'customer_number'>;
  order_items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface NewCustomerForm {
  full_name: string;
  phone_number: string;
  street: string;
  city: string;
  zip_code: string;
}

export interface NewOrderItemForm {
  item_name: string;
  quantity: number;
  unit_price: number;
}

export interface NewOrderForm {
  customer_id: string;
  notes: string;
  items: NewOrderItemForm[];
  payment_method: PaymentMethod;
  // Optional points redemption — staff types how many points the customer
  // is using and the dollar discount that applies. Both default to 0.
  points_redeemed?: number;
  redemption_discount?: number;
}

export type StaffRole = 'admin' | 'staff';
// Role baked into the session cookie. 'owner' has no PIN — they sign in via
// the Hero Go password flow and inherit every admin power plus the ability
// to create / reset / revoke admin PINs.
export type SessionRole = StaffRole | 'owner';

export interface StaffUser {
  id: string;
  name: string;
  role: StaffRole;
  active: boolean;
  created_at: string;
  created_by: string | null;
  archived_at: string | null;
}

export interface SessionUser {
  id: string;
  name: string;
  role: SessionRole;
}

export function isAdminOrOwner(role: SessionRole): boolean {
  return role === 'admin' || role === 'owner';
}

export type AuditChanges = Record<string, { from: unknown; to: unknown }> | Record<string, unknown>;

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: StaffRole;
  action: string;
  entity_type: 'customer' | 'order' | 'staff' | 'export' | 'settings';
  entity_id: string | null;
  entity_label: string | null;
  changes: AuditChanges;
  created_at: string;
}
