-- 📌 REAL DATABASE: these grants apply only to the disposable test cluster.
-- LOCAL DEVELOPMENT ONLY: this public sample password is not a production secret.
BEGIN;
CREATE ROLE vichaar_test_reader LOGIN PASSWORD 'local_test_reader_only'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;

REVOKE ALL ON DATABASE vichaar_ecommerce_test FROM PUBLIC;
GRANT CONNECT ON DATABASE vichaar_ecommerce_test TO vichaar_test_reader;
REVOKE ALL ON DATABASE postgres, template0, template1 FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO vichaar_test_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
GRANT SELECT ON public.customers, public.products, public.orders, public.order_items TO vichaar_test_reader;

-- New tables are not automatically readable; new admin-created functions are not public.
ALTER DEFAULT PRIVILEGES FOR ROLE vichaar_test_admin REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Revoke PUBLIC too: revoking only the reader cannot override inherited PUBLIC access.
-- Keep ordinary analytical functions (date_trunc, aggregates, casts) usable.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS signature
    FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pg_catalog' AND (
      p.proname IN ('pg_sleep', 'pg_sleep_for', 'pg_sleep_until', 'set_config',
        'pg_read_file', 'pg_read_binary_file', 'pg_stat_file', 'pg_write_file',
        'lo_import', 'lo_export', 'lo_create', 'lo_unlink', 'lo_put', 'lo_from_bytea', 'lowrite',
        'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_rotate_logfile')
      OR p.proname LIKE 'pg_advisory_%' OR p.proname LIKE 'pg_try_advisory_%' OR p.proname LIKE 'pg_ls_%'
    )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, vichaar_test_reader', fn.signature);
  END LOOP;
END $$;

ALTER ROLE vichaar_test_reader IN DATABASE vichaar_ecommerce_test SET default_transaction_read_only = on;
ALTER ROLE vichaar_test_reader IN DATABASE vichaar_ecommerce_test SET statement_timeout = '5s';
ALTER ROLE vichaar_test_reader IN DATABASE vichaar_ecommerce_test SET lock_timeout = '1s';
ALTER ROLE vichaar_test_reader IN DATABASE vichaar_ecommerce_test SET idle_in_transaction_session_timeout = '5s';
ALTER ROLE vichaar_test_reader IN DATABASE vichaar_ecommerce_test SET search_path = pg_catalog, public;
ALTER ROLE vichaar_test_reader IN DATABASE vichaar_ecommerce_test SET timezone = 'UTC';
COMMIT;
