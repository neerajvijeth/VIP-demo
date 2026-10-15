# Executive dashboard: new sections

Added below the headline KPIs of the Overview page. Only the executive dashboard was changed.

## Data definitions (applied to every new widget)

| Rule | Definition used |
|---|---|
| Open | `COALESCE(te_state, df_status)` is not FIXED / RESOLVED / CLOSED, **and** `df_status` is not Fixed. A finding with no state is not counted. |
| Snapshot | The page's "Latest snapshot only" switch (default on): the latest `snapshot_date`, newest `snapshot_timestamp` of that day. |
| Mobile | `os_type` Android and iOS are excluded (case-insensitive). |
| Assets | `COUNT(DISTINCT gold_asset_id)` over the de-duplicated asset set (one row per asset per snapshot; purged / terminated assets excluded). |
| Server | `asset_class = 'Server'` (case-insensitive). Workstation / Unknown come from the same column. |
| Unique vulnerability | A distinct **(asset, CVE key)** pair, CVE key = `cve`, else `plugin_cve`, else `plugin_id`. This equals the dashboard's existing "Open findings" row count on the demo data (143 = 143), so the sections reconcile with the headline cards. When one pair has several findings, its worst `final_score` is used. |
| Score bands | On `final_score`: Critical ≥ 85 · High 70–84 · Medium 50–69 · Low < 50. A vulnerability with no score belongs to no band (returned as `no_score`). SLA reference: Critical ≤ 72 h preferred / 7 days max, High 7–14 d, Medium 30 d, Low 90 d. |
| Score weights (reference tooltip) | KEV 10 %, Internet exposure 20 %, EPSS 30 %, CVSS 20 %, Asset criticality 20 %. `final_score` itself is precomputed upstream. |
| Highest priority | The lowest `priority_rank` across the application's open findings, shown as P1 Critical … P4 Low. |

## Global filters

Business unit, Region, Country, Criticality, Asset class, Device type, Internet exposed and **VOC priority, OS family, KEV** (new), plus "Add filter" on any column. Every new widget reads the same filter state; nothing is cached or hardcoded.

A filter on a column that lives on one table is bridged through the asset id:
- VOC priority (`priority_code`) and KEV (`kev_flag`) are finding-level: finding cards filter directly; asset cards keep assets that have an **open matching finding** (so "Total unique assets" with KEV = Yes counts assets with a KEV finding).
- OS family (asset `os_type`) is asset-level: asset cards filter directly; finding cards keep findings on matching assets.
- Trends cannot be filtered (the KPI table has no dimensions); the page says so.

All aggregation happens in the warehouse; the browser receives at most 25 rows per widget.

## Sections

1. **Asset overview**: Total unique assets, Total servers, Servers % · donut by class · horizontal bars of servers by OS (Windows Server by release, Linux by distribution; more than 10 groups fold into "Other").
2. **Server vulnerabilities by score**: Critical / High / Medium / Low KPIs · column chart (always four bands, 0 when empty) · band and SLA legend · score-weight tooltip · Servers with KEV · Servers with SLA breach and its rate (of all servers in scope).
3. **Top applications**: Top 10 by unique vulnerabilities or by max risk score (toggle) · table with vulnerabilities, affected assets, KEV, max score, highest priority. Clicking a bar or row narrows Section 4 to that application.
4. **Top servers**: Top 10 chart · sortable table of the top 25 (hostname, OS, business unit, region, criticality, internet exposed, total, Critical/High/Medium/Low, KEV, max score) · CSV export · row click opens a panel with the server's top vulnerabilities and a link to the Vulnerabilities page.

## Things to confirm

1. **Score bands vs `priority_code`.** They do not line up in the demo data (P1 spans scores 70–89). Sections 2 and 4 use your score bands; the VOC priority filter uses the stored `priority_code`. Tell me which should drive the bands.
2. **"VOC priority"** is mapped to `priority_code`. If you meant `voc_assignment_group`, say so.
3. **"OS family"** is mapped to the asset's `os_type`.
4. **`df_status`** holds Active / Resolved in the demo data, never "Fixed"; Tenable's `te_state` carries FIXED. The existing open rule handles both. The literal `df_status <> Fixed` is also applied.
5. **Asset class values** in the demo are Server / Endpoint (no Workstation / Unknown). The donut shows whatever values exist, in the order Workstation, Server, Unknown, then others.
6. **Software names are not normalised** (the app never did). To list likely duplicates (for example `chrome` and `chrome_for_mac`) run:
   ```sql
   SELECT lower(regexp_replace(software_name, '[^a-z0-9]+', '')) AS norm, collect_set(software_name) AS variants, count(*) AS n
   FROM <catalog>.<schema>.gold_vulnerabilities
   WHERE snapshot_date = (SELECT max(snapshot_date) FROM <catalog>.<schema>.gold_vulnerabilities)
   GROUP BY 1 HAVING size(collect_set(software_name)) > 1 ORDER BY n DESC;
   ```
7. **Servers with SLA breach %** is of all servers in scope (not only servers with vulnerabilities).

## Verifying against the Power BI report

Set **Region = Africa** (or clear Region) and no other filter, then compare:

| Dashboard card | Power BI |
|---|---|
| Total unique assets (Section 1) | unique assets (8,488 expected; this card also excludes Android / iOS) |
| Total servers / Servers % | asset class Server count and share (509 in your example) |
| Assets by class | Workstation / Server / Unknown split (7,964 / 509 / 15) |
| Server band KPIs, summed | open unique vulnerabilities on servers |
| Top applications / top servers | rankings by vulnerability count |

If a number differs, the usual causes are: the asset population (purged / terminated assets and the duplicate-asset rule), mobile devices, the open definition (`df_status`), or counting findings rather than distinct (asset, CVE) pairs.
