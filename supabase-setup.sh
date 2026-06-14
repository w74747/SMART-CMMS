#!/bin/bash
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[ OK ]${NC}  $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
err()     { echo -e "${RED}[ERR ]${NC}  $1"; exit 1; }

echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗"
echo    "║   Smart CMMS — Supabase + Prisma Setup Script           ║"
echo -e "╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: .env ──────────────────────────────────────────────────────────────
info "Step 1 — Checking .env file"
if [ ! -f ".env" ]; then
  [ -f ".env.example" ] && cp .env.example .env || err ".env.example not found. Run smart-cmms-full-install.sh first."
  warn ".env created. Fill in your values now:"
  echo ""
  echo "  DATABASE_URL          → Supabase Dashboard → Settings → Database"
  echo "                          → Transaction pooler string (port 6543)"
  echo "  DIRECT_URL            → Same page → Session pooler string (port 5432)"
  echo "  SUPABASE_URL          → Settings → API → Project URL"
  echo "  SUPABASE_ANON_KEY     → Settings → API → Publishable key"
  echo "  SUPABASE_SERVICE_ROLE_KEY → Settings → API → Secret key"
  echo "  JWT_ACCESS_SECRET     → run: openssl rand -hex 64"
  echo "  JWT_REFRESH_SECRET    → run: openssl rand -hex 64  (different value)"
  echo ""
  echo "  Bucket names to CREATE in Supabase Storage → New bucket:"
  echo "    cmms-asset-documents   (public: OFF)"
  echo "    cmms-work-order-photos (public: OFF)"
  echo "    cmms-bulk-imports      (public: OFF)"
  echo "    cmms-exports           (public: OFF)"
  echo ""
  read -p "Press ENTER after you have filled in .env..." -r
fi

set -o allexport; source .env; set +o allexport
success ".env loaded"

# ── Step 2: Validate ──────────────────────────────────────────────────────────
info "Step 2 — Validating required environment variables"
for var in DATABASE_URL DIRECT_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET \
           SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
           SUPABASE_BUCKET_ASSETS SUPABASE_BUCKET_WORK_ORDERS; do
  val="${!var:-}"
  if [ -z "$val" ] || [[ "$val" == *"REPLACE_WITH"* ]] || [[ "$val" == *"your_"* ]] || [[ "$val" == *"[PASSWORD]"* ]] || [[ "$val" == *"[PROJECT"* ]]; then
    err "$var is missing or still has a placeholder value in .env"
  fi
  echo "      ✓ $var"
done
success "All variables validated"

# ── Step 3: Install psql ──────────────────────────────────────────────────────
info "Step 3 — Checking psql client"
if ! command -v psql &>/dev/null; then
  info "Installing postgresql-client..."
  sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client
fi
success "psql available: $(psql --version | head -1)"

# ── Step 4: Test connection ───────────────────────────────────────────────────
info "Step 4 — Testing Supabase database connection"
if psql "$DIRECT_URL" -c "SELECT 1;" -t 2>/dev/null | grep -q "1"; then
  success "Supabase connection successful!"
else
  echo ""
  err "Cannot connect. Check:
  1. DIRECT_URL uses port 5432 (NOT 6543)
  2. Project is not paused in Supabase dashboard
  3. Password has no unencoded special chars
  4. Supabase → Settings → Network → 'Allow all origins'"
fi

# ── Step 5: Create schemas ────────────────────────────────────────────────────
info "Step 5 — Creating PostgreSQL schemas"
psql "$DIRECT_URL" -v ON_ERROR_STOP=0 << 'SQL'
CREATE SCHEMA IF NOT EXISTS tenant_template;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "pgcrypto"  SCHEMA public;
SELECT schema_name FROM information_schema.schemata
WHERE schema_name IN ('public','tenant_template') ORDER BY schema_name;
SQL
success "Schemas ready: public + tenant_template"

# ── Step 6: Deploy SQL functions ──────────────────────────────────────────────
info "Step 6 — Deploying tenant provisioning SQL functions"
psql "$DIRECT_URL" << 'SQL'
CREATE OR REPLACE FUNCTION public.fn_provision_tenant_schema(p_schema_name TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_table RECORD;
BEGIN
  IF p_schema_name !~ '^tenant_[a-z0-9_]{3,55}$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema_name;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = p_schema_name) THEN
    RAISE EXCEPTION 'Schema % already exists.', p_schema_name;
  END IF;
  EXECUTE format('CREATE SCHEMA %I', p_schema_name);
  FOR v_table IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'tenant_template' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  LOOP
    EXECUTE format('CREATE TABLE %I.%I (LIKE tenant_template.%I INCLUDING ALL)',
      p_schema_name, v_table.table_name, v_table.table_name);
  END LOOP;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO postgres', p_schema_name);
  EXECUTE format('GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA %I TO postgres', p_schema_name);
  EXECUTE format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I TO postgres', p_schema_name);
  RAISE NOTICE 'Tenant schema "%" provisioned.', p_schema_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_deprovision_tenant_schema(p_schema_name TEXT, p_confirm TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_confirm != 'I CONFIRM DELETION OF ' || p_schema_name THEN
    RAISE EXCEPTION 'Confirmation text mismatch. Aborted.';
  END IF;
  EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', p_schema_name);
  RAISE NOTICE 'Schema "%" deleted.', p_schema_name;
END;
$$;
SELECT 'SQL functions deployed' AS status;
SQL
success "SQL functions deployed"

# ── Step 7: Prisma generate ───────────────────────────────────────────────────
info "Step 7 — Generating Prisma Client"
npx prisma generate
success "Prisma Client generated"

# ── Step 8: Push schema ───────────────────────────────────────────────────────
info "Step 8 — Pushing schema to Supabase (prisma db push)"
npx prisma db push --accept-data-loss
success "Database schema pushed"

info "Verifying tables..."
psql "$DIRECT_URL" -c "
SELECT table_schema, COUNT(*) AS table_count
FROM information_schema.tables
WHERE table_schema IN ('public','tenant_template')
  AND table_type = 'BASE TABLE'
GROUP BY table_schema ORDER BY table_schema;"

# ── Step 9: Demo tenant ───────────────────────────────────────────────────────
info "Step 9 — Creating demo tenant schema (tenant_demo)"
psql "$DIRECT_URL" -c "SELECT public.fn_provision_tenant_schema('tenant_demo');" 2>/dev/null \
  && success "Demo schema 'tenant_demo' created" \
  || warn "Demo schema may already exist — skipping"

# ── Step 10: JWT helper ───────────────────────────────────────────────────────
echo ""
info "Step 10 — Fresh JWT secrets (use these in .env if not already set):"
echo ""
echo -n "  JWT_ACCESS_SECRET=";  openssl rand -hex 64
echo -n "  JWT_REFRESH_SECRET="; openssl rand -hex 64
echo ""

# ── Done ─────────────────────────────────────────────────────────────────────
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗"
echo    "║  ✅  Supabase setup complete!                            ║"
echo    "╠══════════════════════════════════════════════════════════╣"
echo    "║  Run now:                                                ║"
echo    "║    npm run start:dev                                     ║"
echo    "║                                                          ║"
echo    "║  Then open:                                              ║"
echo    "║    http://localhost:3000/api-docs  ← Swagger UI          ║"
echo    "║    http://localhost:3000/health    ← Health check        ║"
echo -e "╚══════════════════════════════════════════════════════════╝${NC}"

read -p "Start dev server now? [Y/n] " -n 1 -r; echo
[[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]] && npm run start:dev
