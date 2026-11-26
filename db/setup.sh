#!/usr/bin/env bash
# Run once against the freeclass database as superuser (postgres)
# Usage: DATABASE_URL=postgresql://postgres@localhost/freeclass ./db/setup.sh
set -euo pipefail

DATABASE_URL=${DATABASE_URL:?DATABASE_URL must be set}
cd "$(dirname "$0")"

echo "Running 01_schema.sql..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f 01_schema.sql

echo "Running 03_logic.sql..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f 03_logic.sql

echo "Running 04_seed.sql..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f 04_seed.sql

echo "Running 05_checkin.sql..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f 05_checkin.sql

echo "Database setup completed successfully."
