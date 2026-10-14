# Vulnerability Intelligence Platform

A **Databricks App** for exploring IT asset and vulnerability data that lives in your Lakehouse. It runs live SQL on your
SQL warehouse, so there is no extra database or ETL to maintain.

* **Executive Overview**: headline KPIs, severity / SLA / age charts, top-10 tables, risk by business unit, asset hygiene,
  trends and "ask your own question" summary cards. Global filters apply to every widget, and any chart or row drills into a
  pre-filled query.
* **Query builders** for Assets and Vulnerabilities: nested `AND` / `OR` / `NOT` groups with explicit brackets, per-connector
  AND/OR, multi-value `is` / `is not`, typed operators, live match count, a live **Final SQL** panel, column chooser,
  sorting, paging, CSV export, saved views, shareable URLs and quick-filter presets.
* **Summary (GROUP BY) mode**: "assets per business unit", "open findings by severity per business unit", averages, totals,
  chart view, click a row to see its records.
* **Custom SQL** page: read-only SQL editor with a schema browser, examples and CSV download.
* **Chatbot** powered by a Databricks **Genie** space, with streamed status, SQL and result tables.
* **Adapts to your data**: columns, types and filter values are discovered from the warehouse; table names, key columns and
  business values are configurable (see [Adapting to your data](#adapting-to-your-data)).

> Stack: Node 20+, Express, `@databricks/sql`, React 19, Vite, Tailwind, TanStack Query / Table / Virtual, Recharts, dnd-kit.

---

## Contents

1. [How it works](#how-it-works)
2. [Quick start (local)](#quick-start-local)
3. [Configure Databricks](#configure-databricks)
4. [Configuration reference](#configuration-reference)
5. [Adapting to your data](#adapting-to-your-data)
6. [Deploy to Databricks Apps](#deploy-to-databricks-apps)
7. [Using the app](#using-the-app)
8. [Security model](#security-model)
9. [Cost considerations](#cost-considerations)
10. [Troubleshooting](#troubleshooting)
11. [Development](#development)

---

## How it works

```
 Browser (React SPA)  ──►  Express server  ──►  Databricks SQL warehouse  ──►  your gold tables
   /dashboard/*, /chat       /api/*  (this repo)      (serverless or pro)        gold_assets
                               │                                                 gold_vulnerabilities
                               └──────────────►  Genie Conversation API          gold_kpi_metrics
```

* The browser never talks to Databricks. The server holds the credentials and generates every statement.
* The dashboards and builders **never run hand-written SQL**. They send a typed filter tree to the server, which generates a
  parameterized statement from a field whitelist (`server/sqlBuilder.ts`).
* Only the **Custom SQL** page accepts free-form SQL (read-only, see [Security model](#security-model)).
* Column names, data types and filter values are **discovered live** (`DESCRIBE TABLE` and `SELECT DISTINCT`).

```
server/              Express API
  sqlBuilder.ts      filter tree → parameterized SQL (unit tested)
  fieldCatalog.ts    field whitelist + live schema discovery
  overviewWidgets.ts one-table-per-widget SQL for the Overview
  customSql.ts       guard for the read-only SQL page
  semantics.ts       env-driven table / column / value configuration
  cache.ts           short result cache + de-duplication (cost control)
  routes/            query, overview, meta, kpis, genie, custom
shared/              types and helpers used by both sides (filters, summaries, semantics)
client/src/          React app (pages: overview, builder, sql, chat)
app.yaml             Databricks Apps runtime config
databricks.yml       optional Databricks Asset Bundle
```

---

## Quick start (local)

You need **Node 20+**, the **Databricks CLI**, and access to a Databricks workspace with a SQL warehouse and the three tables.

```bash
git clone https://github.com/neerajvijeth/VIP-demo.git
cd VIP-demo
npm install

# 1) sign in once (opens a browser; no token is stored in the project)
databricks auth login --host https://<your-workspace-host> --profile vip

# 2) configure
cp .env.example .env        # then edit: host, warehouse id, catalog, schema, profile name

# 3) run
npm run dev                 # API on :8000 + UI on http://localhost:5173
```

Production-like run (what Databricks Apps executes): `npm run build && npm start`, then open http://localhost:8000.

> The first query after the warehouse has been idle can take 10-30 s while a serverless warehouse starts. That is normal.

---

## Configure Databricks

### 1. Install the CLI and sign in

```bash
# macOS:  brew tap databricks/tap && brew install databricks
# other:  https://docs.databricks.com/dev-tools/cli/install.html
databricks auth login --host https://<workspace-host> --profile vip
databricks auth profiles            # confirm it shows "Valid: YES"
```

### 2. Find the ids you need

```bash
databricks warehouses list --profile vip              # SQL warehouse id
databricks catalogs list --profile vip                # catalog
databricks schemas list <catalog> --profile vip       # schema
databricks tables list <catalog> <schema> --profile vip
databricks genie list-spaces --profile vip            # Genie space id (optional, for the Chatbot)
```

### 3. Provide the data

The app reads three tables from `<catalog>.<schema>` (names are configurable):

| Table | Used for |
|---|---|
| `gold_assets` | Assets page, asset widgets |
| `gold_vulnerabilities` | Vulnerabilities page, vulnerability widgets (denormalized: it already carries asset columns) |
| `gold_kpi_metrics` | Trend cards (`metric_name`, `metric_value`, `snapshot_date`) |

The two big tables are snapshot-style (`snapshot_date`, `is_valid`). By default the app shows the latest snapshot and valid rows,
and the switches can be turned off. Tables that do not have these columns still work (the switches are disabled).
See [Adapting to your data](#adapting-to-your-data) for different names.

### 4. Authentication options

| Where | How | Notes |
|---|---|---|
| Local (recommended) | `DATABRICKS_CONFIG_PROFILE=vip` | Uses your CLI login; tokens are fetched on demand and never written to disk. Runs as **you**. |
| Local (alternative) | `DATABRICKS_TOKEN=dapi...` | Personal access token. |
| Databricks Apps | automatic | The app's **service principal** (`DATABRICKS_CLIENT_ID` / `_SECRET` are injected). |
| Databricks Apps (per-user) | `USE_OBO=true` | Queries run as the signed-in user via the forwarded token. |

### 5. Permissions

The identity that runs the queries needs (replace the principal with your user, or the app's service principal client id):

```sql
GRANT USE CATALOG ON CATALOG <catalog> TO `<principal>`;
GRANT USE SCHEMA  ON SCHEMA  <catalog>.<schema> TO `<principal>`;
GRANT SELECT ON TABLE <catalog>.<schema>.gold_assets          TO `<principal>`;
GRANT SELECT ON TABLE <catalog>.<schema>.gold_vulnerabilities TO `<principal>`;
GRANT SELECT ON TABLE <catalog>.<schema>.gold_kpi_metrics     TO `<principal>`;
```

Plus **CAN USE** on the SQL warehouse, and **CAN RUN** on the Genie space (and CAN USE on the warehouse that space uses)
if you want the Chatbot.

### 6. Genie space (optional)

Create a Genie space over the same three tables in the Databricks UI, then set `GENIE_SPACE_ID`. Without it, everything except
the Chatbot works and the Chatbot page explains what is missing.

---

## Configuration reference

All settings are environment variables (`.env` locally, `app.yaml` on Databricks Apps).

**Connection**

| Variable | Description |
|---|---|
| `DATABRICKS_HOST` | Workspace host, without `https://` (injected on Databricks Apps) |
| `DATABRICKS_WAREHOUSE_ID` | SQL warehouse id (use the `sql-warehouse` resource on Apps) |
| `DATABRICKS_CATALOG`, `DATABRICKS_SCHEMA` | Where the tables live |
| `DATABRICKS_CONFIG_PROFILE` | Local CLI profile to authenticate with |
| `DATABRICKS_TOKEN` | Local personal access token (alternative) |
| `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET` | Service principal OAuth (injected on Apps) |
| `GENIE_SPACE_ID` | Genie space for the Chatbot (use the `genie-space` resource on Apps) |
| `USE_OBO` | `true` = run as the signed-in user |
| `PORT` | Default `8000` |

**Limits and cost controls**

| Variable | Default | Description |
|---|---|---|
| `STATEMENT_TIMEOUT_SECONDS` | `120` | Warehouse statement timeout |
| `EXPORT_MAX_ROWS` | `1000000` | CSV export cap |
| `CACHE_TTL_SECONDS` | `300` | Result cache for dashboard queries; `0` disables |

**Adapting to your data** (all optional)

| Variable | Description |
|---|---|
| `TABLE_ASSETS`, `TABLE_VULNERABILITIES`, `TABLE_KPI_METRICS` | Table names (defaults `gold_assets`, `gold_vulnerabilities`, `gold_kpi_metrics`) |
| `COLUMN_MAP` | JSON `{"logical_name":"your_column"}` for columns the Overview logic relies on |
| `CLOSED_STATES` | Comma list of finding states that mean *closed* (default `FIXED`); everything else is "open" |
| `HIGH_SEVERITIES` | Severities counted as critical/high (default `Critical,High`) |
| `STALE_STATUS`, `AGING_STATUS` | Asset aging labels (defaults `Stale`, `Aging`) |
| `EOS_STATUS`, `UPCOMING_EOS_STATUS` | End-of-support labels (defaults `EOS`, `Upcoming EOS`) |

---

## Adapting to your data

**Automatic (no configuration).** On first use (and at most every 30 minutes while in use, or when you click *Refresh* next to the
column count) the server runs `DESCRIBE TABLE` and:

* makes **every column filterable**, typed from its real warehouse data type (curated labels and groups are kept for known columns);
* drops known fields whose column no longer exists, and offers new columns under "Other columns";
* uses the real data type of every column so offered operators always match the data;
* loads filter values live with `SELECT DISTINCT` as you type.

**Configurable.** The Overview widgets, presets and drill-downs rely on a small set of *logical* columns. If yours are named
differently, map them:

```bash
COLUMN_MAP='{"kev_flag":"is_known_exploited","te_state":"status","gold_asset_id":"asset_key"}'
CLOSED_STATES='Closed,Resolved'
HIGH_SEVERITIES='Sev1,Sev2'
```

| Logical column | Used for |
|---|---|
| `gold_asset_id`, `finding_id` | distinct counts and row keys |
| `te_state` + `CLOSED_STATES` | "open" findings |
| `severity` + `HIGH_SEVERITIES` | critical/high counts, severity charts |
| `kev_flag`, `sla_breached`, `sla_status`, `overdue_days`, `vulnerability_age_days`, `final_score` | KEV / SLA / age / risk widgets |
| `hostname`, `criticality`, `cve`, `vulnerability_name`, `software_name`, `recommended_version` | top-10 tables |
| `business_unit`, `region`, `country`, `asset_class`, `device_type`, `internet_exposed` | global filters, charts |
| `te_has_agent`, `asset_aging_status`, `tool_visibility`, `df_end_of_support_status` | coverage and hygiene |
| `snapshot_date`, `is_valid` | snapshot / validity scope |
| `metric_name`, `metric_value` | trend cards |

**Graceful degradation.** If a widget needs a column your data does not have, that widget shows
"Not available: no column …" and the rest of the page keeps working. Global filters on missing columns are ignored for that table.
A **data check** banner on the Overview warns when configured values do not match the data
(for example none of `HIGH_SEVERITIES` appear in the severity column).

---

## Deploy to Databricks Apps

1. **Edit `app.yaml`**: set `DATABRICKS_CATALOG` and `DATABRICKS_SCHEMA` (and any optional overrides).
2. **Create the app** with the warehouse (and Genie space) attached as resources:

   ```bash
   databricks apps create --profile vip --json '{
     "name": "vuln-intel-platform",
     "description": "Vulnerability Intelligence Platform",
     "resources": [
       {"name":"sql-warehouse","sql_warehouse":{"id":"<warehouse-id>","permission":"CAN_USE"}},
       {"name":"genie-space","genie_space":{"name":"<space title>","space_id":"<space-id>","permission":"CAN_RUN"}}
     ]}'
   ```
   (App names are limited to 30 characters. Drop the `genie-space` resource and the `GENIE_SPACE_ID` env entry if you skip the Chatbot.)
3. **Grant the app's service principal read access.** Get its client id with
   `databricks apps get vuln-intel-platform --profile vip`, then run the `GRANT` statements from
   [Permissions](#5-permissions) using that client id.
4. **Upload and deploy:**

   ```bash
   databricks sync . /Workspace/Users/<you>/vuln-intel-platform --profile vip \
     --exclude node_modules --exclude dist --exclude .env --exclude .databricks
   databricks apps start  vuln-intel-platform --profile vip      # if the app compute is stopped
   databricks apps deploy vuln-intel-platform --profile vip \
     --source-code-path /Workspace/Users/<you>/vuln-intel-platform
   ```
   Databricks Apps runs `npm install`, `npm run build`, then `npm start`. Build tools are listed under `dependencies` on purpose.
5. Open the app URL from `databricks apps get`. Use the `/api/health?deep=1` endpoint to confirm the warehouse connection.

**Alternative: bundle.** `databricks bundle deploy --var warehouse_id=<id> --var genie_space_id=<id>` then `databricks bundle run vip`.

**Stop the app when not in use** to avoid app-compute charges: `databricks apps stop vuln-intel-platform`.

---

## Using the app

| Page | What you do there |
|---|---|
| **Overview** | Set global filters (business unit, region, country, criticality, internet exposed, asset class, device type). Click any chart slice, bar or table row to open the Vulnerabilities / Assets page pre-filtered. Add your own summaries under *Ask your own question*. *Refresh* bypasses the cache; *PDF* prints a leadership-friendly page. |
| **Assets / Vulnerabilities** | Build a query with conditions, groups and brackets; click a connector (AND/OR) to change just that one; the *Final SQL* panel shows the exact statement; *Run query* executes it. Switch **Result type** to *Summary* for GROUP BY. Download CSV from the results card. Save views in the sidebar. |
| **Custom SQL** | Write your own read-only query, browse tables/columns, load examples, download CSV. |
| **Chatbot** | Ask Genie questions; inspect the generated SQL; thumbs up/down; history is kept in the browser. |

Keyboard: `Ctrl/Cmd+Enter` run, `/` add a condition, `Ctrl/Cmd+K` command palette, `g o` / `g a` / `g v` / `g s` / `g c`
jump to Overview / Assets / Vulnerabilities / Custom SQL / Chat.

---

## Security model

* **Builders and dashboards are injection-safe by construction**: identifiers come only from the discovered field whitelist, operators
  are validated per field type, every value is a named parameter, and limits apply (nesting depth 6, 100 conditions, 500-value `IN`,
  500-character strings). `npm test` covers nesting, NOT, every operator, injection attempts and limits.
* **Custom SQL is a separate, explicit escape hatch** (`/api/custom/*`). Guardrails: one statement; must start with `SELECT`, `WITH`,
  `DESCRIBE`, `SHOW` or `EXPLAIN`; writes, DDL and admin keywords and escape-hatch functions (`reflect`, `java_method`, `read_files`,
  `http_request`, ...) are rejected (comments and string literals are stripped first); display and export are row-capped;
  the warehouse statement timeout applies.
* **The real enforcement is Databricks privileges.** Deployed, the app's service principal should hold only `SELECT` on the three tables.
  When running locally with your own login (or with `USE_OBO=true`) queries run with *your* permissions, so the keyword guard is
  a safety net, not a sandbox.
* Tokens never reach the browser. `helmet`, a request rate limit, a 1 MB body limit and request ids are enabled.
  Parameter values are never logged.

---

## Cost considerations

**What you pay for.** The SQL warehouse bills for the time it is *running*, not per query: query time plus the idle minutes before
auto-stop. For a small dashboard, statements are tiny (these tables scan thousands of rows), so **uptime dominates the bill**.

Example measured on a serverless **2X-Small** warehouse (4 DBU/hour, 10-minute auto-stop) during a heavy development day:
559 statements ran for only ~3.6 minutes of total execution, yet the day billed ~3.2 DBU (≈ 48 minutes of uptime).

**Rough planning math** (verify your own rate; list price is about **$0.70 per DBU** for serverless SQL in many US regions,
so a 2X-Small costs ≈ **$2.80/hour** while running):

| Usage pattern | Warehouse uptime | Approx. cost |
|---|---|---|
| Occasional: a few short sessions per day | 1-2 h/day | ~$3-6/day (~$60-130/month) |
| Team during business hours, someone queries every <10 min | 8-10 h/day | ~$22-28/day (~$500-620/month) |
| Warehouse kept on 24/7 | 24 h/day | ~$67/day (~$2,000/month) |

Other costs: the Databricks App compute (small; stop it when unused), and Genie questions, which run on the warehouse and add
their own model usage.

**What the app does to keep this low**

* **Nothing runs on its own.** There are no background timers or polling; the schema is discovered lazily on first use.
* **Result cache + de-duplication** (`CACHE_TTL_SECONDS`, default 5 min): identical dashboard statements, counts, filter values and trend
  queries hit the warehouse once. The manual *Refresh* button bypasses the cache.
* The *Final SQL* preview is generated by the server and costs nothing; only *Run*, live counts and value lists query the warehouse.
* Widget queries run at most 4 at a time.
* `GET /api/health` reports how many statements the app has issued (`usage`), and cache hits.

**Levers you control**

* Set the warehouse **auto-stop as low as your tolerance allows** (serverless supports a few minutes), and use **2X-Small**.
* Keep `CACHE_TTL_SECONDS` at 300 or higher if the data only changes with daily snapshots.
* Stop the app and warehouse outside working hours.

**Measure it yourself** (needs access to system tables):

```sql
SELECT usage_date, SUM(usage_quantity) AS dbus
FROM system.billing.usage
WHERE usage_metadata.warehouse_id = '<warehouse-id>' AND usage_date >= date_sub(current_date(), 14)
GROUP BY 1 ORDER BY 1;

SELECT CAST(start_time AS DATE) d, COUNT(*) statements, ROUND(SUM(total_duration_ms)/1000) total_sec
FROM system.query.history
WHERE compute.warehouse_id = '<warehouse-id>' AND start_time >= date_sub(current_date(), 14)
GROUP BY 1 ORDER BY 1;
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Auth errors locally | Your CLI login expired: `databricks auth login --profile <name>` |
| First load is slow | The warehouse was stopped and is starting. Wait 10-30 s. |
| A widget says "Not available" | Your table lacks a column it needs: map it with `COLUMN_MAP` or ignore it |
| Overview shows zeros for critical/high | `HIGH_SEVERITIES` does not match your values; check the data-check banner |
| "open" counts look wrong | Set `CLOSED_STATES` to the values that mean closed |
| `Invalid DATABRICKS_CATALOG` | You left a `<placeholder>` in `app.yaml` / `.env` |
| Chatbot says not configured | Set `GENIE_SPACE_ID` and grant CAN RUN on the space |
| Custom SQL: "not allowed" | Only read-only statements are accepted |
| Corporate proxy / certificate errors with npm or Node | Set `NODE_EXTRA_CA_CERTS` to your company CA bundle |
| App won't deploy: "compute is stopped" | `databricks apps start <name>` first |

---

## Development

```bash
npm run dev          # API :8000 + Vite :5173 (hot reload; detailed React errors)
npm run typecheck    # server + client
npm test             # unit tests (sqlBuilder, summaries, custom SQL guard, dynamic schema, cache)
npm run build        # compile the server and build the client into dist/
npm start            # run the compiled app on :8000
```

`npm run dev` and `npm start` differ only in how the UI is served: dev serves it unbundled with hot reload on :5173; the built app
serves the bundled UI from the same Express server on :8000 (this is what Databricks Apps runs).
