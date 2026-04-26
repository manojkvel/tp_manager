# Visual-diff log — v1.7 PO design alignment

**Initiated:** 2026-04-21 (plan: `/Users/kvel/.claude/plans/recursive-whistling-crane.md`)
**Source review:** `deviation-log-2026-04-21.md`

Per-screen parity check comparing the PO (StockChef) reference design to the TP Manager implementation delivered across Waves 0-14.

---

## How parity was assessed

For each PO screen, cross-check: KPI strip labels & layout; chart presence + data shape; table columns; primary CTA buttons; status pill / badge palette; visible filters.

**Scale:** ✅ parity · ◑ partial (minor stylistic difference) · ❌ gap

---

## Screen matrix

| # | PO screen             | TP route                 | KPI strip | Charts | Table/List | CTAs | Pills | Notes                                                              |
|---|-----------------------|--------------------------|-----------|--------|------------|------|-------|--------------------------------------------------------------------|
| 1 | Dashboard             | `/`                      | ✅ 4-card | ✅ 2   | ✅ activity feed | ✅ Today's prep | ✅   | Food Cost % live from `/reports/food-cost-pct`; activity = union of 5 streams. |
| 2 | Inventory Count       | `/inventory`             | —         | —      | ✅ zone tabs | ✅ Complete    | ✅   | GPS verification + photo-required + barcode scan all wired.        |
| 3 | Ingredients           | `/ingredients`           | —         | —      | ✅         | ✅ New         | ✅   | Columns: Name / Category / Supplier / Unit cost / PAR / Recipes.   |
| 4 | Deliveries            | `/deliveries`            | ✅        | —      | ✅ cards   | ✅ Scan invoice | ✅ | OCR worker consumer + reconciliation modal.                        |
| 5 | Order Forms           | `/orders`                | ✅        | —      | ✅ grouped | ✅ Auto-generate | ✅ | Preview / Send / Resend / Mark received per order card.            |
| 6 | Suppliers             | `/suppliers`             | ✅        | —      | ✅         | ✅ New         | ✅   | StarRating column; on-time / fill-rate computed in KPIs service.   |
| 7 | Prep Items            | `/prep/items`            | —         | —      | ✅         | ✅ New prep    | ✅   | New page — shelf life in hours, storage temp, ingredient chips.    |
| 8 | Daily Prep Sheet      | `/prep/sheet`            | ✅        | —      | ✅ rows    | ✅ Start/QC    | ✅   | Assignee select + temp probe modal.                                |
| 9 | Waste Log             | `/prep/waste`            | ✅        | ✅ bar | ✅         | ✅ Log waste   | ✅   | Station column + attribution bucket required.                      |
|10 | Recipes               | `/recipes`               | —         | —      | ✅         | ✅ New         | ✅   | Kept per user decision; Prep Items is its sibling.                 |
|11 | AvT Variance          | `/reports/avt`           | ✅        | ✅ hbar | ✅        | —              | ✅   | Status tiers (critical/warning/ok) from server.                     |
|12 | Price Creep           | `/reports/price-creep`   | ✅        | ✅ line | ✅        | —              | ✅   | Trend = last 3 deliveries per flagged item.                        |
|13 | Waste & Loss          | `/reports/waste-loss`    | ✅ 4-card | ✅ donut | ✅      | —              | ✅   | Bucket-dimensional rollup.                                          |

**Result:** 13/13 PO screens at parity. No ❌ gaps remaining.

---

## Automated verification run — 2026-04-21

- `pnpm -r run build` → all packages green (`@tp/types`, `@tp/conversions`, `@tp/api`, `@tp/web`, `@tp/aloha-worker`).
- `pnpm --filter @tp/api test` → **266 passed · 7 skipped** across 40 suites (0 fails).
- `pnpm --filter @tp/web exec tsc --noEmit` → 0 errors.
- `pnpm --filter @tp/aloha-worker exec tsc --noEmit` → 0 errors.
- `services/ml` `.venv/bin/python -m pytest tests/ -q` → **21 passed** in 0.8s.

---

## Manual smoke-tests to run against the local Docker stack

Plan §14.3 flows — to be confirmed by a human tester:

- [ ] Scan invoice → OCR worker flips `ocr_status=parsed` → verify delivery with at least one discrepancy.
- [ ] Auto-generate orders from PAR shortfalls → review modal → send email (LogEmailTransport captures payload when `SMTP_HOST` is unset).
- [ ] Inventory count: GPS prompt → photo-required rows block Complete until uploaded → count closes with zone progress 100%.
- [ ] Log waste with `attribution_bucket` → Waste & Loss donut updates (by-bucket endpoint).
- [ ] Assign prep row → Start → QC & Sign with temperature → row shows QC badge + temp chip.

These exercise every new data path added in v1.7.

---

## Deferred / intentionally not delivered

- Per-restaurant rebrand to "StockChef" (out of plan scope; spec retains "TP Manager").
- Mobile-native app (web is responsive).
- Supplier on-time/fill-rate history beyond rows present in `Delivery` at migration time.
- Offline mode for inventory counts.
