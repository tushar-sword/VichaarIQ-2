-- 📌 MOCK DATA: synthetic business schema in the isolated test cluster only.
BEGIN;

CREATE TABLE public.customers (
  id integer PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  region text NOT NULL CHECK (region IN ('North', 'South', 'East', 'West', 'Central')),
  country text NOT NULL DEFAULT 'India',
  created_at timestamptz NOT NULL
);

CREATE TABLE public.products (
  id integer PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  price numeric(12, 2) NOT NULL CHECK (price > 0),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.orders (
  id integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES public.customers(id),
  region text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'pending', 'shipped', 'cancelled', 'refunded')),
  currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  shipping_amount numeric(12, 2) NOT NULL CHECK (shipping_amount >= 0),
  total_amount numeric(12, 2) NOT NULL CHECK (total_amount >= 0),
  created_at timestamptz NOT NULL
);

CREATE TABLE public.order_items (
  id integer PRIMARY KEY,
  order_id integer NOT NULL REFERENCES public.orders(id),
  product_id integer NOT NULL REFERENCES public.products(id),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 4),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price > 0),
  discount_amount numeric(12, 2) NOT NULL CHECK (discount_amount >= 0 AND discount_amount <= quantity * unit_price),
  line_total numeric(12, 2) GENERATED ALWAYS AS (quantity * unit_price - discount_amount) STORED,
  UNIQUE (order_id, product_id)
);

CREATE INDEX orders_created_at_idx ON public.orders(created_at);
CREATE INDEX orders_customer_id_idx ON public.orders(customer_id);
CREATE INDEX order_items_product_id_idx ON public.order_items(product_id);

COMMENT ON TABLE public.customers IS 'Synthetic local-development fixture; no real customer data.';
COMMENT ON TABLE public.orders IS 'Synthetic orders in 2025; revenue questions should explicitly filter statuses and dates.';
COMMENT ON COLUMN public.orders.total_amount IS 'Sum of discounted item line totals plus shipping, in INR; cancelled/refunded orders are not recognized revenue.';
COMMIT;
