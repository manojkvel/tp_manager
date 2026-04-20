// TASK-055 — /prep/sheet (§6.4).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChefHat, Check, SkipForward, Loader2 } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge, type BadgeTone } from '../components/ui/Badge.js';
import { Stat } from '../components/ui/Stat.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';

type Status = 'pending' | 'in_progress' | 'complete' | 'skipped';

interface Row {
  id: string;
  recipe_version_id: string;
  recipe_id: string;
  recipe_name: string;
  needed_qty: number;
  status: Status;
  skip_reason: string | null;
}

interface Sheet {
  id: string;
  date: string;
  rows: Row[];
}

const STATUS_TONES: Record<Status, BadgeTone> = {
  pending:     'neutral',
  in_progress: 'info',
  complete:    'success',
  skipped:     'warn',
};

const STATUS_LABELS: Record<Status, string> = {
  pending:     'Pending',
  in_progress: 'In progress',
  complete:    'Complete',
  skipped:     'Skipped',
};

export default function PrepSheetPage() {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<Sheet>('/api/v1/prep/sheet');
    if (res.error) setError(res.error.message); else { setError(null); setSheet(res.data ?? null); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    if (!sheet) return { total: 0, complete: 0, skipped: 0, pending: 0 };
    return sheet.rows.reduce((acc, r) => {
      acc.total += 1;
      if (r.status === 'complete') acc.complete += 1;
      else if (r.status === 'skipped') acc.skipped += 1;
      else acc.pending += 1;
      return acc;
    }, { total: 0, complete: 0, skipped: 0, pending: 0 });
  }, [sheet]);

  async function complete(row: Row) {
    const res = await apiFetch(`/api/v1/prep/rows/${row.id}/complete`, { method: 'POST', body: JSON.stringify({}) });
    if (res.error) setError(res.error.message); else void load();
  }

  async function skip(row: Row) {
    const reason = window.prompt('Reason for skipping?');
    if (!reason) return;
    const res = await apiFetch(`/api/v1/prep/rows/${row.id}/skip`, { method: 'POST', body: JSON.stringify({ reason }) });
    if (res.error) setError(res.error.message); else void load();
  }

  return (
    <>
      <PageHeader
        title="Today's prep sheet"
        description={sheet ? `Generated for ${sheet.date}` : 'Loading…'}
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {sheet && sheet.rows.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Stat label="Total items"  value={counts.total}    icon={ChefHat}   tone="brand" />
          <Stat label="Remaining"    value={counts.pending}  icon={Loader2}   tone="warn" />
          <Stat label="Complete"     value={counts.complete} icon={Check}     tone="success" />
          <Stat label="Skipped"      value={counts.skipped}  icon={SkipForward} tone="neutral" />
        </div>
      )}

      <Card padded={false}>
        <CardHeader className="px-5 pt-5" title="Queue" description="Work top-to-bottom by station. Skipping requires a reason." />
        {!sheet && <div className="p-6 text-sm text-slate-500">Loading…</div>}
        {sheet && sheet.rows.length === 0 && (
          <div className="p-6">
            <EmptyState
              icon={<ChefHat className="h-6 w-6" />}
              title="Nothing to prep today"
              hint="Forecast output drives this sheet — once POS sales feed in, rows appear here automatically."
            />
          </div>
        )}
        {sheet && sheet.rows.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Recipe</Th>
                <Th className="text-right">Needed</Th>
                <Th>Status</Th>
                <Th>Note</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {sheet.rows.map((r) => {
                const done = r.status === 'complete' || r.status === 'skipped';
                return (
                  <TRow key={r.id} className={done ? 'bg-slate-50/60' : ''}>
                    <Td className={done ? 'text-slate-500 line-through' : 'font-medium text-slate-900'}>
                      {r.recipe_name}
                    </Td>
                    <Td className="text-right tabular-nums">{r.needed_qty}</Td>
                    <Td>
                      <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                    </Td>
                    <Td className="text-slate-500">{r.skip_reason ?? <span className="text-slate-300">—</span>}</Td>
                    <Td className="text-right">
                      {!done && (
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" leftIcon={<Check className="h-3.5 w-3.5" />} onClick={() => void complete(r)}>
                            Done
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            leftIcon={<SkipForward className="h-3.5 w-3.5" />}
                            onClick={() => void skip(r)}
                          >
                            Skip
                          </Button>
                        </div>
                      )}
                    </Td>
                  </TRow>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
