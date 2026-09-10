import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Currency = 'ILS' | 'THB' | 'USD';

export type Expense = {
  id: string;
  desc: string;
  amount: number;          // always in ILS (converted at entry time)
  original_amount: number; // amount as entered, in `currency`
  currency: Currency;
  rate: number;            // ILS per 1 unit of `currency` at entry time
  date: string;
  category: string;
  created_at: string;
};
