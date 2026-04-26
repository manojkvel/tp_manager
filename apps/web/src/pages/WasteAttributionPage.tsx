// v1.7 Wave 7 — Waste & Loss: 4 bucket KPIs + donut + recent-stream table.

import { useEffect, useMemo, useState } from 'react';
import { Trash2, UtensilsCrossed, HandCoins, ShieldAlert } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Badge, type BadgeTone } from '../components/ui/Badge.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { KPIStrip } from '../components/charts/KPIStrip.js';
import { DonutChart, type DonutSlice } from '../components/charts/DonutChart.js';

type Bucket = 'spoilage' | 'prep_waste' | 'comped_meals' | 'theft_suspected';

interface BucketRow { bucket: string; total_value_cents: number; entries: number }
interface ReasonRow { reason_id: string; reason_label: string; total_value_cents: number; entries: number }

interface WasteLossReport {
  total_value_cents: number;
  total_entries: number;
  by_bucket: BucketRow[];
  by_reason: ReasonRow[];
  since: string;
  until: string;
}

function usd(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }

const BUCKET_META: Record<Bucket, { label: string; tone: BadgeTone; color: string; icon: typeof Trash2 }> = {
  spoilage:        { label: 'Expiry / Spoilage',  tone: 'spoilage',        color: '#f59e0b', icon: Trash2 },
  prep_waste:      { label: 'Kitchen Mistakes',   tone: 'prep_waste',      color: '#ea580c', icon: UtensilsCrossed },
  comped_meals:    { label: 'Comped / Training',  tone: 'comped_meals',    color: '#0ea5e9', icon: HandCoins },
  theft_suspected: { label: 'Theft Suspected',    tone: 'theft_suspected', color: '#ef4444', icon: ShieldAlert },
};

function bucketLookup(report: WasteLossReport | null, bucket: Bucket): BucketRow {
  const row = report?.by_bucket.find((r) => r.bucket === bucket);
  return row ?? { bucket, total_value_cents: 0, entries: 0 };
}

export default function WasteAttributionPage() {
  const [report, setReport] = useState<WasteLossReport | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<WasteLossReport>('/api/v1/reports/waste-loss');
      setReport(r.data ?? null);
    })();
  }, []);

  const kpis = (Object.keys(BUCKET_META) as Bucket[]).map((b) => {
    const row = bucketLookup(report, b);
    const meta = BUCKET_META[b];
    return {
      label: meta.label,
      value: usd(row.total_value_cents),
      hint: `${row.entries} entries`,
      icon: meta.icon,
      tone: (b === 'theft_suspected' ? 'danger' : b === 'prep_waste' ? 'warn' : b === 'spoilage' ? 'warn' : 'brand') as 'danger' | 'warn' | 'brand',
    };
  });

  const slices: DonutSlice[] = useMemo(() => {
    if (!report) return [];
    return (Object.keys(BUCKET_META) as Bucket[])
      .map((b) => {
        const row = bucketLookup(report, b);
        return { label: BUCKET_META[b].label, value: row.total_value_cents / 100, color: BUCKET_META[b].color };
      })
      .filter((s) => s.value > 0);
  }, [report]);

  return (
    <>
      <PageHeader
        title="Waste & Loss"
        description="Track inventory shrinkage by attribution bucket — the first step to reducing it."
      />

      <KPIStrip cards={kpis} className="mb-4" />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Loss by attribution"
            description={report ? `${report.total_entries} entries · ${usd(report.total_value_cents)} total` : 'Last 30 days'}
          />
          {slices.length === 0
            ? <EmptyState title="No waste logged in the window." hint="Log kitchen waste from Waste Log to populate this report." />
            : <DonutChart
                slices={slices}
                format={(n) => `$${n.toFixed(2)}`}
                centerLabel="Total"
                centerValue={report ? usd(report.total_value_cents) : ''}
              />}
        </Card>

        <Card padded={false} className="lg:col-span-3">
          <CardHeader className="px-5 pt-5" title="Loss by reason" description="Breakdown inside the buckets." />
          <Table>
            <thead>
              <tr>
                <Th>Reason</Th>
                <Th className="text-right">Entries</Th>
                <Th className="text-right">Total value</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {(report?.by_reason ?? []).map((r) => (
                <TRow key={r.reason_id}>
                  <Td className="font-medium">{r.reason_label}</Td>
                  <Td className="text-right tabular-nums">{r.entries}</Td>
                  <Td className="text-right tabular-nums">{usd(r.total_value_cents)}</Td>
                </TRow>
              ))}
            </tbody>
          </Table>
          {(report?.by_reason.length ?? 0) === 0 && (
            <div className="px-5 py-6"><EmptyState title="No waste logged in the window." /></div>
          )}
        </Card>
      </div>

      <Card padded={false}>
        <CardHeader className="px-5 pt-5" title="Attribution buckets" description="Totals per bucket; drill down from Waste Log." />
        <Table>
          <thead>
            <tr>
              <Th>Bucket</Th>
              <Th className="text-right">Entries</Th>
              <Th className="text-right">Total value</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {(Object.keys(BUCKET_META) as Bucket[]).map((b) => {
              const row = bucketLookup(report, b);
              const meta = BUCKET_META[b];
              return (
                <TRow key={b}>
                  <Td><Badge tone={meta.tone}>{meta.label}</Badge></Td>
                  <Td className="text-right tabular-nums">{row.entries}</Td>
                  <Td className="text-right tabular-nums">{usd(row.total_value_cents)}</Td>
                </TRow>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
