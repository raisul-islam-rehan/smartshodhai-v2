export interface Product {
  id: number
  name: string
  stock_qty: number
  unit: string
  reorder_level: number
  cost_price?: number
  selling_price?: number
  category?: string
  barcode?: string
  created_at?: string
}

export interface BakiRecord {
  id: number
  customer_name: string
  customer_phone?: string
  amount_owed: number
  last_updated: string
  notes?: string
}

export interface SaleLog {
  id: number
  product_name: string
  qty_sold: number
  customer_name?: string
  sale_date: string
  unit_price?: number
  is_baki?: boolean
}

export interface Profile {
  id: string
  business_name: string
  owner_name: string
  role: "owner" | "staff"
}
