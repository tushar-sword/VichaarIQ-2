-- 📌 REAL DATABASE: run directly as the test reader, not through the SQL validator.
\set ON_ERROR_STOP on
SELECT current_user AS execution_role;
SELECT 'customers' AS entity, COUNT(*) AS rows FROM public.customers
UNION ALL SELECT 'products', COUNT(*) FROM public.products
UNION ALL SELECT 'orders', COUNT(*) FROM public.orders
UNION ALL SELECT 'order_items', COUNT(*) FROM public.order_items;

-- Deliberately override the read-only default to test actual ACLs, not just the setting.
-- Every attempted mutation is inside a transaction that is always rolled back.
BEGIN READ WRITE;
DO $$
DECLARE operation text; actual integer; attributes record;
BEGIN
  IF current_user <> 'vichaar_test_reader' OR current_database() <> 'vichaar_ecommerce_test' THEN
    RAISE EXCEPTION 'Wrong role or database: refusing verification';
  END IF;
  SELECT * INTO attributes FROM pg_roles WHERE rolname = current_user;
  IF attributes.rolsuper OR attributes.rolcreatedb OR attributes.rolcreaterole OR attributes.rolreplication OR attributes.rolbypassrls THEN
    RAISE EXCEPTION 'Reader has elevated role attributes';
  END IF;
  IF EXISTS (SELECT FROM pg_auth_members WHERE member = attributes.oid) THEN
    RAISE EXCEPTION 'Reader has unexpected role membership';
  END IF;
  IF has_database_privilege(current_user, current_database(), 'CREATE')
     OR has_database_privilege(current_user, current_database(), 'TEMP')
     OR has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Reader can create database objects';
  END IF;

  SELECT COUNT(*) INTO actual FROM public.customers;
  IF actual <> 240 THEN RAISE EXCEPTION 'Expected 240 customers, got %', actual; END IF;
  SELECT COUNT(*) INTO actual FROM public.products;
  IF actual <> 24 THEN RAISE EXCEPTION 'Expected 24 products, got %', actual; END IF;
  SELECT COUNT(*) INTO actual FROM public.orders;
  IF actual <> 1440 THEN RAISE EXCEPTION 'Expected 1440 orders, got %', actual; END IF;
  SELECT COUNT(*) INTO actual FROM public.order_items;
  IF actual <> 4320 THEN RAISE EXCEPTION 'Expected 4320 items, got %', actual; END IF;
  SELECT COUNT(DISTINCT date_trunc('month', created_at)) INTO actual FROM public.orders;
  IF actual <> 12 THEN RAISE EXCEPTION 'Expected 12 months, got %', actual; END IF;
  SELECT COUNT(DISTINCT region) INTO actual FROM public.orders;
  IF actual <> 5 THEN RAISE EXCEPTION 'Expected 5 regions, got %', actual; END IF;
  SELECT COUNT(DISTINCT status) INTO actual FROM public.orders;
  IF actual <> 5 THEN RAISE EXCEPTION 'Expected 5 statuses, got %', actual; END IF;
  SELECT COUNT(DISTINCT category) INTO actual FROM public.products;
  IF actual <> 4 THEN RAISE EXCEPTION 'Expected 4 categories, got %', actual; END IF;
  IF EXISTS (
    SELECT FROM public.orders o JOIN
      (SELECT order_id, SUM(line_total) AS subtotal FROM public.order_items GROUP BY order_id) i ON i.order_id = o.id
    WHERE o.total_amount <> i.subtotal + o.shipping_amount
  ) THEN RAISE EXCEPTION 'Order totals do not reconcile'; END IF;

  FOREACH operation IN ARRAY ARRAY[
    'INSERT INTO public.customers (id, name, email, region, created_at) VALUES (99999, ''Denied'', ''denied@example.invalid'', ''North'', ''2025-01-01'')',
    'UPDATE public.orders SET status = ''cancelled'' WHERE id = 1',
    'DELETE FROM public.order_items WHERE id = 1',
    'CREATE TABLE public.permission_probe (id integer)',
    'CREATE TEMP TABLE permission_probe_temp (id integer)',
    'SELECT pg_catalog.pg_sleep(0)',
    'SELECT pg_catalog.pg_advisory_lock(42)',
    'SELECT pg_catalog.set_config(''application_name'', ''permission-probe'', false)'
  ] LOOP
    BEGIN
      EXECUTE operation;
      RAISE EXCEPTION 'Expected SQLSTATE 42501 but operation succeeded: %', operation;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS denied: %', operation;
    END;
  END LOOP;
END $$;
ROLLBACK;
SELECT 'PASS dataset integrity; SQLSTATE 42501 denied INSERT, UPDATE, DELETE, CREATE TABLE, CREATE TEMP TABLE and restricted functions' AS verification;
