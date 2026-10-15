-- 📌 MOCK DATA: deterministic fixtures. No random(), now(), or real personal data.
BEGIN;
SET LOCAL TIME ZONE 'UTC';

INSERT INTO public.customers (id, name, email, region, created_at)
SELECT n, 'Sample Customer ' || n, 'customer' || n || '@example.invalid',
       (ARRAY['North', 'South', 'East', 'West', 'Central'])[((n - 1) % 5) + 1],
       TIMESTAMPTZ '2024-01-01 00:00:00+00' + ((n - 1) % 300) * INTERVAL '1 day'
FROM generate_series(1, 240) AS n;

INSERT INTO public.products (id, name, category, price) VALUES
  (1, 'Wireless Headphones', 'Electronics', 2499.00),
  (2, 'Bluetooth Speaker', 'Electronics', 1799.00),
  (3, 'USB-C Hub', 'Electronics', 1299.00),
  (4, 'Mechanical Keyboard', 'Electronics', 3499.00),
  (5, 'Wireless Mouse', 'Electronics', 899.00),
  (6, 'Portable Charger', 'Electronics', 1499.00),
  (7, 'Desk Lamp', 'Home & Living', 1199.00),
  (8, 'Ceramic Mug Set', 'Home & Living', 599.00),
  (9, 'Cotton Cushion', 'Home & Living', 449.00),
  (10, 'Storage Basket', 'Home & Living', 799.00),
  (11, 'Indoor Planter', 'Home & Living', 649.00),
  (12, 'Linen Table Runner', 'Home & Living', 999.00),
  (13, 'Cotton T-Shirt', 'Apparel', 699.00),
  (14, 'Linen Shirt', 'Apparel', 1499.00),
  (15, 'Running Socks', 'Apparel', 299.00),
  (16, 'Canvas Tote', 'Apparel', 499.00),
  (17, 'Lightweight Jacket', 'Apparel', 2499.00),
  (18, 'Everyday Cap', 'Apparel', 399.00),
  (19, 'Business Strategy Handbook', 'Books', 599.00),
  (20, 'Data Storytelling Guide', 'Books', 799.00),
  (21, 'Modern SQL Workbook', 'Books', 899.00),
  (22, 'Design Principles', 'Books', 649.00),
  (23, 'Travel Journal', 'Books', 349.00),
  (24, 'Creative Thinking', 'Books', 499.00);

INSERT INTO public.orders (id, customer_id, region, status, shipping_amount, total_amount, created_at)
SELECT m * 120 + n, c.id, c.region,
       (ARRAY['completed', 'completed', 'completed', 'completed', 'pending', 'shipped', 'cancelled', 'refunded'])[((n + m) % 8) + 1],
       CASE WHEN n % 4 = 0 THEN 0 ELSE 49 END, 0,
       TIMESTAMPTZ '2025-01-01 00:00:00+00' + m * INTERVAL '1 month'
         + ((n - 1) % 28) * INTERVAL '1 day' + ((n * 5) % 24) * INTERVAL '1 hour'
FROM generate_series(0, 11) AS m
CROSS JOIN generate_series(1, 120) AS n
JOIN public.customers AS c ON c.id = ((n * 7 + m * 13 - 1) % 240) + 1;

INSERT INTO public.order_items (id, order_id, product_id, quantity, unit_price, discount_amount)
SELECT (o.id - 1) * 3 + line, o.id, p.id, 1 + ((o.id + line) % 4), p.price,
       round(p.price * (1 + ((o.id + line) % 4)) * ((o.id + line) % 3) * 0.05, 2)
FROM public.orders AS o
CROSS JOIN generate_series(1, 3) AS line
JOIN public.products AS p ON p.id = ((o.id * 5 + line * 7 - 1) % 24) + 1;

UPDATE public.orders AS o
SET total_amount = items.subtotal + o.shipping_amount
FROM (SELECT order_id, SUM(line_total) AS subtotal FROM public.order_items GROUP BY order_id) AS items
WHERE items.order_id = o.id;

ANALYZE public.customers;
ANALYZE public.products;
ANALYZE public.orders;
ANALYZE public.order_items;
COMMIT;
