# Backup & restore

## Backup

```bash
npm run backup
```

Produces `backups/YYYY-MM-DD_HHMMSS/` containing one CSV per table plus a `MANIFEST.json` with row counts.

The seven tables snapshotted (in dependency-order for restore):

1. `staff_users` — PINs + roles.
2. `owner_credentials` — owner login.
3. `customers` — customer master data (includes archived rows).
4. `orders` — every order including voided ones.
5. `order_items` — line items, FK to orders.
6. `audit_log` — full mutation history.
7. `app_settings` — retention thresholds + similar tunables.

All CSVs are UTF-8 with BOM (opens cleanly in Excel) and use RFC 4180 quoting (matches `lib/csv.ts`).

### Schedule

The script is intentionally a one-shot CLI invocation. Schedule it however your environment allows:

- **macOS shop terminal:** `crontab -e` → `0 2 * * 0 cd ~/Downloads/meat-shop\ 2 && npm run backup` (Sundays 2 AM).
- **Linux server:** same as macOS but adjust path.
- **GitHub Actions:** workflow with `cron: '0 9 * * 0'`, secrets for `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, commit the resulting backup zip to a private artifact bucket.

Aim for: **weekly minimum**, **daily for first month after launch**, **monthly off-site copy** (different cloud / drive / encrypted USB).

### Retention

Keep the last 12 weekly snapshots + the last 12 monthly. Delete older ones manually or with a `find ... -mtime +N` cron.

### What this does NOT cover

- Supabase storage buckets (none used today, so N/A).
- Database extensions / triggers / functions — those live in the migration SQL files (`scripts/schema.sql` + `scripts/migrations/*.sql`) which are in git.
- Environment variables — stored in Vercel + `.env.local`; never copy these into a backup file.

---

## Restore — full disaster recovery

**Practice this once before you need it.** Restore drills that aren't done routinely don't work in an emergency.

### Step 1 — provision a fresh Supabase project

1. Supabase dashboard → New project.
2. SQL Editor → run, in order:
   - `scripts/schema.sql`
   - `scripts/migrations/01_phase1.sql`
   - `scripts/migrations/04_payment_method.sql`
   - `scripts/migrations/05_owner.sql`
   - `scripts/migrations/06_pin_partial_unique.sql`
   - `scripts/migrations/07_session_version.sql`
   - `scripts/migrations/08_points_redemption.sql`
3. The seed admin (PIN `9851`) gets recreated — **delete it** if your backup has its own admin row that conflicts:
   ```sql
   DELETE FROM staff_users WHERE name = 'Owner' AND pin_hash = '2zCUtBsuvKV8BmjOWxdtB7EANN-Mde19MiAeaKzOfbM';
   ```

### Step 2 — load the CSVs (in dependency order)

Supabase dashboard → Table Editor → each table → "Import data from CSV":

1. `staff_users.csv`
2. `owner_credentials.csv`
3. `customers.csv`
4. `orders.csv`
5. `order_items.csv` *(triggers will fire as items insert; total/subtotal/points_earned will be recomputed by `sync_order_totals`. Match the manifest's row count to confirm none got skipped.)*
6. `audit_log.csv`
7. `app_settings.csv`

### Step 3 — reset sequences

Customer + order numbers come from sequences. After loading, advance them past the max imported value:

```sql
SELECT setval('customer_number_seq',
  (SELECT MAX(CAST(SUBSTRING(customer_number FROM 6) AS bigint))
   FROM customers
   WHERE customer_number LIKE 'CUST-%'));

SELECT setval('order_number_seq',
  (SELECT MAX(CAST(SUBSTRING(order_number FROM 5) AS bigint))
   FROM orders
   WHERE order_number LIKE 'ORD-%'));
```

(Adjust column-name prefixes if your seed numbering differs.)

### Step 4 — repoint the app

Update Vercel env vars (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) to the new project. Redeploy.

### Step 5 — smoke test

1. Log in with an admin PIN — confirm you reach the dashboard.
2. Open a known customer — confirm balance + order history match the backup.
3. Create a test order for $1 — confirm points + total flow.
4. Void it — confirm points reverse.
5. Delete the test order from the database (or just leave it; you'll know).

### Step 6 — verify manifest

Compare row counts in the new DB to `MANIFEST.json`:

```sql
SELECT
  (SELECT COUNT(*) FROM customers)         AS customers,
  (SELECT COUNT(*) FROM orders)            AS orders,
  (SELECT COUNT(*) FROM order_items)       AS order_items,
  (SELECT COUNT(*) FROM audit_log)         AS audit_log,
  (SELECT COUNT(*) FROM staff_users)       AS staff_users,
  (SELECT COUNT(*) FROM owner_credentials) AS owner_credentials,
  (SELECT COUNT(*) FROM app_settings)      AS app_settings;
```

Numbers should match (or be off by one for the manually-deleted seed admin).

---

## RTO / RPO

- **RPO** (recovery point objective): up to one week of data loss between weekly backups. **Move to daily** for first month after launch.
- **RTO** (recovery time objective): ~30 minutes for a practiced operator using the steps above. **Untested**: first restore will likely take 1-2 hours figuring out which step you skipped.

The single biggest reliability investment you can make: **run a restore drill once a quarter.** Without it, the backup is just files.
