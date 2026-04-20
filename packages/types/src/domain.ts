// TASK-024 — Shared §8 domain types mirroring apps/api/prisma/schema.prisma.
// Used across apps/{api,web,aloha-worker} + services/ml boundaries so request
// and response shapes stay type-safe end-to-end.
//
// Numbers are `number` (TS) for display/transport; SQL NUMERIC(18,6) and
// integer-cents fields are expressed as number here. Monetary values are
// *always* integer cents (e.g., `unit_cost_cents`) — avoid float drift.

import type { Iso8601, Uuid } from './index.js';

// ─── enums ───────────────────────────────────────────────────────────────────

export type UomCategory = 'weight' | 'volume' | 'count';

export type LocationKind = 'dry' | 'cold' | 'freezer' | 'bar' | 'prep';

export type UtensilKind = 'scoop' | 'ladle' | 'bag' | 'spoon' | 'cap';

export type EquivalenceSource = 'default' | 'override';

export type CostSource = 'delivery' | 'manual' | 'migration';

export type RecipeType = 'prep' | 'menu';

export type Station = 'lunch' | 'breakfast' | 'expo' | 'egg' | 'bar' | 'bakery';

export type RecipeLineRefType = 'ingredient' | 'recipe';

export type PrepSheetRowStatus = 'pending' | 'in_progress' | 'complete' | 'skipped';

export type InventoryCountStatus = 'open' | 'paused' | 'completed' | 'amended';

export type DeliveryStatus = 'pending' | 'verified' | 'disputed';

export type OrderStatus = 'draft' | 'sent' | 'received';

export type WasteRefType = 'ingredient' | 'prep';

export type AlohaImportSource = 'sftp' | 'api' | 'middleware' | 'manual_upload';

export type AlohaImportStatus = 'ok' | 'failed' | 'partial';

export type PosRowKind = 'item' | 'modifier' | 'stockout_86' | 'cover' | 'unclassified';

export type ForecastEntityType = 'ingredient' | 'prep';

// ─── tenant + auth ───────────────────────────────────────────────────────────

export interface Restaurant {
  id: Uuid;
  name: string;
  timezone: string;
  aloha_store_id: string | null;
  created_at: Iso8601;
}

export interface User {
  id: Uuid;
  restaurant_id: Uuid;
  email: string;
  name: string | null;
  role: import('./index.js').Role;
  active: boolean;
  last_login_at: Iso8601 | null;
  created_at: Iso8601;
}

// ─── settings ────────────────────────────────────────────────────────────────

export interface Location {
  id: Uuid;
  restaurant_id: Uuid;
  name: string;
  kind: LocationKind;
  is_archived: boolean;
  created_at: Iso8601;
}

export interface PortionUtensil {
  id: Uuid;
  restaurant_id: Uuid;
  name: string;
  label_colour: string | null;
  kind: UtensilKind;
  default_uom: string;
  default_qty: number;
  is_archived: boolean;
  created_at: Iso8601;
}

export interface UtensilEquivalence {
  id: Uuid;
  utensil_id: Uuid;
  ingredient_id: Uuid | null; // null = utensil default
  equivalent_qty: number;
  equivalent_uom: string;
  source: EquivalenceSource;
  created_at: Iso8601;
}

export interface WasteReason {
  id: Uuid;
  restaurant_id: Uuid;
  code: string;
  label: string;
  is_archived: boolean;
  created_at: Iso8601;
}

export interface ParLevel {
  id: Uuid;
  restaurant_id: Uuid;
  recipe_id: Uuid;
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  qty: number;
  updated_at: Iso8601;
}

// ─── ingredients, suppliers, costs ───────────────────────────────────────────

export interface Ingredient {
  id: Uuid;
  restaurant_id: Uuid;
  name: string;
  uom: string;
  uom_category: UomCategory;
  pack_size: number | null;
  storage_location_id: Uuid | null;
  default_supplier_id: Uuid | null;
  shelf_life_days: number | null;
  allergen_flags: string[];
  density_g_per_ml: number | null;
  is_archived: boolean;
  archived_at: Iso8601 | null;
  created_at: Iso8601;
  updated_at: Iso8601;
}

export interface IngredientCost {
  id: Uuid;
  ingredient_id: Uuid;
  unit_cost_cents: number;
  effective_from: Iso8601;
  source: CostSource;
  note: string | null;
  created_at: Iso8601;
}

export interface Supplier {
  id: Uuid;
  restaurant_id: Uuid;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  lead_time_days: number;
  min_order_cents: number;
  order_cadence: string | null;
  is_active: boolean;
  created_at: Iso8601;
}

export interface SupplierIngredient {
  id: Uuid;
  supplier_id: Uuid;
  ingredient_id: Uuid;
  supplier_pack_size: number | null;
  unit_cost_cents: number;
  rank: number;
  effective_from: Iso8601;
  effective_until: Iso8601 | null;
  created_at: Iso8601;
}

// ─── recipes ─────────────────────────────────────────────────────────────────

export interface Recipe {
  id: Uuid;
  restaurant_id: Uuid;
  type: RecipeType;
  name: string;
  is_archived: boolean;
  created_at: Iso8601;
}

export interface RecipeVersion {
  id: Uuid;
  recipe_id: Uuid;
  version: number;
  is_current: boolean;
  yield_qty: number;
  yield_uom: string;
  shelf_life_days: number | null;
  equipment: string[];
  procedure: string;
  photo_url: string | null;
  is_portion_bag_prep: boolean;
  portion_bag_content_json: unknown | null;
  created_by_user_id: Uuid | null;
  created_at: Iso8601;
}

export interface RecipeLine {
  id: Uuid;
  recipe_version_id: Uuid;
  position: number;
  ref_type: RecipeLineRefType;
  ingredient_id: Uuid | null;
  ref_recipe_id: Uuid | null;
  qty: number;
  qty_text: string | null;
  uom: string | null;
  note: string | null;
  station: Station | null;
  step_order: number | null;
  utensil_id: Uuid | null;
}

// ─── operational loop ────────────────────────────────────────────────────────

export interface PrepRun {
  id: Uuid;
  recipe_version_id: Uuid;
  prepared_on: string; // ISO date (YYYY-MM-DD)
  prepared_by_user_id: Uuid | null;
  qty_yielded: number;
  expires_on: string | null;
  created_at: Iso8601;
}

export interface PrepSheet {
  id: Uuid;
  restaurant_id: Uuid;
  date: string;
  generated_at: Iso8601;
}

export interface PrepSheetRow {
  id: Uuid;
  prep_sheet_id: Uuid;
  recipe_version_id: Uuid;
  needed_qty: number;
  status: PrepSheetRowStatus;
  started_at: Iso8601 | null;
  completed_at: Iso8601 | null;
  user_id: Uuid | null;
  skip_reason: string | null;
}

export interface InventoryCount {
  id: Uuid;
  restaurant_id: Uuid;
  date: string;
  status: InventoryCountStatus;
  started_by: Uuid | null;
  completed_by: Uuid | null;
  amends_count_id: Uuid | null;
  created_at: Iso8601;
}

export interface InventoryCountLine {
  id: Uuid;
  count_id: Uuid;
  ref_type: RecipeLineRefType;
  ingredient_id: Uuid | null;
  recipe_version_id: Uuid | null;
  location_id: Uuid | null;
  expected_qty: number | null;
  actual_qty: number;
  unit_cost_cents: number | null;
}

export interface Delivery {
  id: Uuid;
  restaurant_id: Uuid;
  supplier_id: Uuid;
  po_id: Uuid | null;
  received_on: string;
  status: DeliveryStatus;
  received_by: Uuid | null;
  created_at: Iso8601;
}

export interface DeliveryLine {
  id: Uuid;
  delivery_id: Uuid;
  ingredient_id: Uuid;
  ordered_qty: number | null;
  received_qty: number;
  unit_cost_cents: number;
  note: string | null;
}

export interface PurchaseOrder {
  id: Uuid;
  restaurant_id: Uuid;
  supplier_id: Uuid;
  status: OrderStatus;
  sent_at: Iso8601 | null;
  expected_on: string | null;
  created_at: Iso8601;
}

export interface OrderLine {
  id: Uuid;
  order_id: Uuid;
  ingredient_id: Uuid;
  qty: number;
  pack_size: number | null;
  unit_cost_cents: number;
}

export interface WasteEntry {
  id: Uuid;
  restaurant_id: Uuid;
  ref_type: WasteRefType;
  ingredient_id: Uuid | null;
  recipe_version_id: Uuid | null;
  qty: number;
  uom: string;
  reason_id: Uuid;
  note: string | null;
  photo_url: string | null;
  unit_cost_cents_pinned: number;
  value_cents: number;
  user_id: Uuid | null;
  at: Iso8601;
}

// ─── Aloha POS ───────────────────────────────────────────────────────────────

export interface AlohaImportRun {
  id: Uuid;
  restaurant_id: Uuid;
  business_date: string;
  source: AlohaImportSource;
  started_at: Iso8601;
  completed_at: Iso8601 | null;
  status: AlohaImportStatus;
  rows_ingested: number;
  error_detail: string | null;
}

export interface PosSale {
  id: Uuid;
  import_run_id: Uuid;
  restaurant_id: Uuid;
  business_date: string;
  category: string | null;
  aloha_item_name: string;
  row_kind: PosRowKind;
  qty: number;
  unit_price_cents: number | null;
  item_sales_cents: number | null;
  aloha_cost_cents: number | null;
  ingested_at: Iso8601;
}

export interface AlohaMenuMap {
  id: Uuid;
  restaurant_id: Uuid;
  aloha_item_name: string;
  menu_recipe_id: Uuid;
  effective_from: string;
  effective_until: string | null;
  mapped_by: Uuid | null;
  confidence: 'manual' | 'suggested';
}

export interface AlohaModifierMap {
  id: Uuid;
  restaurant_id: Uuid;
  aloha_modifier_name: string;
  ingredient_id: Uuid | null;
  recipe_id: Uuid | null;
  qty: number;
  uom: string;
  effective_from: string;
  effective_until: string | null;
  mapped_by: Uuid | null;
}

export interface StockoutEvent {
  id: Uuid;
  restaurant_id: Uuid;
  import_run_id: Uuid | null;
  business_date: string;
  ingredient_id: Uuid | null;
  recipe_id: Uuid | null;
  aloha_marker_name: string;
  count: number;
  mapped: boolean;
}

export interface CoverCount {
  id: Uuid;
  restaurant_id: Uuid;
  import_run_id: Uuid | null;
  business_date: string;
  covers: number;
}

export interface AlohaReconciliationQueue {
  id: Uuid;
  restaurant_id: Uuid;
  aloha_item_name: string;
  row_kind: PosRowKind;
  first_seen_on: string;
  occurrences: number;
  resolved: boolean;
  resolved_at: Iso8601 | null;
}

// ─── ML ──────────────────────────────────────────────────────────────────────

export interface ForecastModel {
  id: Uuid;
  restaurant_id: Uuid;
  entity_type: ForecastEntityType;
  entity_id: Uuid;
  algorithm: string;
  trained_on_start: string;
  trained_on_end: string;
  holdout_mape: number | null;
  params: unknown | null;
  artefact_ref: string;
  trained_at: Iso8601;
}

export interface ForecastPrediction {
  id: Uuid;
  model_id: Uuid;
  target_date: string;
  point: number;
  p10: number | null;
  p90: number | null;
  top_drivers_json: unknown | null;
  generated_at: Iso8601;
}

export interface ForecastOverride {
  id: Uuid;
  restaurant_id: Uuid;
  entity_type: ForecastEntityType;
  entity_id: Uuid;
  target_date: string;
  expected_qty: number;
  override_qty: number;
  actual_qty: number | null;
  user_id: Uuid | null;
  reason: string | null;
  at: Iso8601;
}

// ─── cross-cutting ───────────────────────────────────────────────────────────

export interface AuditLog {
  id: number;
  restaurant_id: Uuid | null;
  user_id: Uuid | null;
  entity: string;
  entity_id: string;
  field: string | null;
  before: unknown | null;
  after: unknown | null;
  action: 'insert' | 'update' | 'delete';
  at: Iso8601;
}

export interface FeatureFlag {
  id: Uuid;
  key: string;
  default_value: boolean;
  description: string | null;
  created_at: Iso8601;
}

export interface FeatureFlagValue {
  id: Uuid;
  flag_id: Uuid;
  restaurant_id: Uuid;
  value: boolean;
  updated_at: Iso8601;
}
