#!/bin/bash
# =============================================================================
# Smart CMMS — Supabase + Prisma Full Setup Script
# Run this AFTER install.sh and AFTER filling in your .env file
# =============================================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERR]${NC}  $1"; exit 1; }
step()    { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

# ─── STEP 1: Check .env exists ───────────────────────────────────────────────
step "1 — Check environment file"

if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    warn ".env created from .env.example"
    echo ""
    echo "  Fill in these values in .env before continuing:"
    echo "  ┌─ DATABASE_URL     → Supabase → Settings → Database → Transaction pooler (port 6543)"
    echo "  ├─ DIRECT_URL       → Supabase → Settings → Database → Session pooler    (port 5432)"
    echo "  ├─ SUPABASE_URL     → Supabase → Settings → API → Project URL"
    echo "  ├─ SUPABASE_ANON_KEY"
    echo "  ├─ SUPABASE_SERVICE_ROLE_KEY"
    echo "  ├─ JWT_ACCESS_SECRET  ← run: openssl rand -hex 64"
    echo "  └─ JWT_REFRESH_SECRET ← run: openssl rand -hex 64"
    echo ""
    read -p "Press ENTER after filling in .env..." -r
  else
    error "No .env or .env.example found. Run install.sh first."
  fi
fi

# Load .env
set -o allexport; source .env; set +o allexport
success ".env loaded"

# ─── STEP 2: Validate required vars ──────────────────────────────────────────
step "2 — Validate environment variables"

for var in DATABASE_URL DIRECT_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  val="${!var:-}"
  if [ -z "$val" ] || [[ "$val" == *"REPLACE_WITH"* ]] || [[ "$val" == *"your_"* ]] || [[ "$val" == *"[PASSWORD]"* ]]; then
    error "$var is missing or still has a placeholder value in .env"
  fi
done
success "All required environment variables are set"

# ─── STEP 3: Install psql client ─────────────────────────────────────────────
step "3 — Install PostgreSQL client (psql)"

if ! command -v psql &>/dev/null; then
  info "Installing psql..."
  sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client
fi
success "psql available: $(psql --version)"

# ─── STEP 4: Test Supabase connection ────────────────────────────────────────
step "4 — Test Supabase database connection"

if psql "$DIRECT_URL" -c "SELECT 1 AS connected;" -t 2>/dev/null | grep -q "1"; then
  success "Supabase connection successful!"
else
  echo ""
  error "Cannot connect to Supabase. Check:
  1. DIRECT_URL in .env is correct (port 5432, NOT 6543)
  2. Supabase project is not paused (dashboard → project)
  3. Password is URL-encoded (@ → %40, # → %23, etc.)
  4. Network restrictions: Supabase → Settings → Network → Allow all IPs"
fi

# ─── STEP 5: Create schemas ───────────────────────────────────────────────────
step "5 — Create PostgreSQL schemas"

psql "$DIRECT_URL" << 'SQL'
CREATE SCHEMA IF NOT EXISTS tenant_template;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "pgcrypto"  SCHEMA public;

SELECT schema_name
FROM   information_schema.schemata
WHERE  schema_name IN ('public', 'tenant_template')
ORDER  BY schema_name;
SQL

success "Schemas ready: public + tenant_template"

# ─── STEP 6: Create tenant provisioning functions ────────────────────────────
step "6 — Deploy tenant provisioning SQL functions"

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
    WHERE  table_schema = 'tenant_template' AND table_type = 'BASE TABLE'
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

SELECT 'Provisioning functions deployed' AS status;
SQL

success "SQL functions deployed"

# ─── STEP 7: npm install ─────────────────────────────────────────────────────
step "7 — Install Node.js dependencies"

npm install
success "Dependencies installed"

# ─── STEP 8: Generate Prisma client ──────────────────────────────────────────
step "8 — Generate Prisma Client"

npx prisma generate
success "Prisma client generated"

# ─── STEP 9: Push schema to Supabase ─────────────────────────────────────────
step "9 — Push database schema to Supabase"

# Using db push (no shadow DB needed) — safer for Supabase hosted
npx prisma db push --accept-data-loss
success "Database schema pushed to Supabase"

# Verify tables
info "Verifying tables in Supabase..."
psql "$DIRECT_URL" -c "
SELECT table_schema, COUNT(*) AS tables
FROM   information_schema.tables
WHERE  table_schema IN ('public','tenant_template')
  AND  table_type = 'BASE TABLE'
GROUP  BY table_schema
ORDER  BY table_schema;
"

# ─── STEP 10: Create demo tenant ─────────────────────────────────────────────
step "10 — Create demo tenant schema"

psql "$DIRECT_URL" -c "SELECT public.fn_provision_tenant_schema('tenant_demo');" 2>/dev/null \
  && success "Demo tenant schema 'tenant_demo' created" \
  || warn "Demo tenant may already exist — skipping"

# ─── STEP 11: Generate JWT secrets helper ────────────────────────────────────
step "11 — JWT Secret Generator"

if command -v openssl &>/dev/null; then
  echo ""
  echo "  Use these fresh secrets in your .env:"
  echo -n "  JWT_ACCESS_SECRET=";  openssl rand -hex 64
  echo -n "  JWT_REFRESH_SECRET="; openssl rand -hex 64
  echo ""
fi

# ─── STEP 12: Start dev server ────────────────────────────────────────────────
step "12 — Start development server"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║      Setup Complete! Ready to start 🚀           ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Run: npm run start:dev                          ║${NC}"
echo -e "${GREEN}║  API: http://localhost:3000/api/v1               ║${NC}"
echo -e "${GREEN}║  Docs: http://localhost:3000/api-docs            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
read -p "Start dev server now? [Y/n] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
  npm run start:dev
fi
