// ============================================================
// types/database.ts
// Auto-typed Supabase schema — mirrors the SQL schema exactly.
// This gives us full TypeScript safety on every DB query.
// ============================================================

export type Database = {
  public: {
    Tables: {
      customers: {
        Row: {
          id: string;
          customer_number: string;
          full_name: string;
          phone_number: string | null;
          street: string | null;
          city: string | null;
          zip_code: string | null;
          points_balance: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_number: string;
          full_name: string;
          phone_number?: string | null;
          street?: string | null;
          city?: string | null;
          zip_code?: string | null;
          points_balance?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          customer_number?: string;
          full_name?: string;
          phone_number?: string | null;
          street?: string | null;
          city?: string | null;
          zip_code?: string | null;
          points_balance?: number;
          created_at?: string;
        };
      };
      orders: {
        Row: {
          id: string;
          order_number: string;
          customer_id: string;
          order_date: string;
          subtotal: number;
          total: number;
          points_earned: number;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_number: string;
          customer_id: string;
          order_date?: string;
          subtotal: number;
          total: number;
          points_earned: number;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_number?: string;
          customer_id?: string;
          order_date?: string;
          subtotal?: number;
          total?: number;
          points_earned?: number;
          notes?: string | null;
          created_at?: string;
        };
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          item_name: string;
          quantity: number;
          unit_price: number;
          line_total: number;
        };
        Insert: {
          id?: string;
          order_id: string;
          item_name: string;
          quantity: number;
          unit_price: number;
          line_total: number;
        };
        Update: {
          id?: string;
          order_id?: string;
          item_name?: string;
          quantity?: number;
          unit_price?: number;
          line_total?: number;
        };
      };
    };
    Functions: {
      increment_points: {
        Args: { customer_id_input: string; points_to_add: number };
        Returns: void;
      };
      get_next_customer_number: {
        Args: Record<string, never>;
        Returns: string;
      };
      get_next_order_number: {
        Args: Record<string, never>;
        Returns: string;
      };
    };
  };
};
