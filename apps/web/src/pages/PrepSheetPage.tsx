// v1.7 Wave 12 — Daily prep sheet redesign: date picker, KPI strip, assignee
// dropdown, Start + QC & Sign flow with temperature reading.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ChefHat, Play, ClipboardCheck, RotateCw, CheckCircle2, Thermometer, AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge, type BadgeTone } from '../components/ui/Badge.js';
import { Input, Select, Field } from '../components/ui/Input.js';
import { Modal } from '../components/ui/Modal.js';
import { EmptyState } from '../components/ui/Table.js';
import { KPIStrip } from '../components/charts/KPIStrip.js';

type Status = 'pending' | 'in_progress' | 'complete' | 'skipped';

interface Row {
  id: string;
  recipe_version_id: string;
  recipe_id: string;
  recipe_name: string;
  needed_qty: number;
  status: Status;
  skip_reason: string | null;
  assigned_to_user_id: string | null;
  qc_signed_by_user_id: string | null;
  qc_signed_at: string | null;
  temp_f: number | null;
  started_at: string | null;
  completed_at: string | null;
}

interface Sheet {
  id: string;
  date: string;
  rows: Row[];
}

interface Summary {
  total_rows: number;
  completed_rows: number;
  completion_pct: number;
  qc_passed: number;
  pending: number;
  in_progress: number;
  skipped: number;
  below_par: number;
  total_needed_qty: number;
}

interface DirectoryUser {
  id: string;
  name: string;
  role: 'owner' | 'manager' | 'staff';
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

function todayIsoDate(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function PrepSheetPage() {
  const [date, setDate] = useState(todayIsoDate());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [qcRow, setQcRow] = useState<Row | null>(null);

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      apiFetch<Sheet>(`/api/v1/prep/sheet?date=${date}`),
      apiFetch<Summary>(`/api/v1/prep/sheet/summary?date=${date}`),
      apiFetch<DirectoryUser[]>('/api/v1/users/directory'),
    ]);
    if (a.error) { setError(a.error.message); return; }
    setError(null);
    setSheet(a.data ?? null);
    setSummary(b.data ?? null);
    if (c.data) setUsers(c.data);
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  async function regenerate() {
    const res = await apiFetch<Sheet>('/api/v1/prep/sheet', {
      method: 'POST', body: JSON.stringify({ date }),
    });
    if (res.error) setError(res.error.message);
    else await load();
  }

  async function patchRow(rowId: string, patch: Record<string, unknown>) {
    const res = await apiFetch(`/api/v1/prep/rows/${rowId}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    });
    if (res.error) setError(res.error.message);
    else await load();
  }

  async function startRow(rowId: string) {
    const res = await apiFetch(`/api/v1/prep/rows/${rowId}/start`, {
      method: 'POST', body: JSON.stringify({}),
    });
    if (res.error) setError(res.error.message);
    else await load();
  }

  async function completeRow(rowId: string) {
    const res = await apiFetch(`/api/v1/prep/rows/${rowId}/complete`, {
      method: 'POST', body: JSON.stringify({}),
    });
    if (res.error) setError(res.error.message);
    else await load();
  }

  async function signQc(rowId: string, temp_f: number | null) {
    const res = await apiFetch(`/api/v1/prep/rows/${rowId}/qc-sign`, {
      method: 'POST', body: JSON.stringify({ temp_f }),
    });
    if (res.error) setError(res.error.message);
    else await load();
  }

  const kpiCards = useMemo(() => {
    if (!summary) return [];
    return [
      { label: 'Completion',  value: `${summary.completion_pct.toFixed(0)}%`, icon: CheckCircle2, tone: 'success' as const },
      { label: 'Total suggested', value: summary.total_needed_qty.toFixed(0), icon: ChefHat, tone: 'brand' as const },
      { label: 'QC passed',   value: String(summary.qc_passed), icon: ClipboardCheck, tone: 'success' as const },
      { label: 'Below PAR',   value: String(summary.below_par), icon: AlertTriangle, tone: summary.below_par > 0 ? 'warn' as const : 'neutral' as const },
    ];
  }, [summary]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  return (
    <>
      <PageHeader
        title="Daily Prep Sheet"
        description="Assign, run, and QC-sign today's prep list. Temperature logging is required for items with a storage-temp target."
        actions={
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
            />
            <Button variant="ghost" leftIcon={<RotateCw className="h-4 w-4" />} onClick={() => void regenerate()}>
              Recalculate
            </Button>
          </div>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {summary && kpiCards.length > 0 && (
        <KPIStrip cards={kpiCards} className="mb-4" />
      )}

      <Card padded={false}>
        <CardHeader
          className="px-5 pt-5"
          title="Today's queue"
          description="Start, QC, and close out each prep item. Assignees come from your active staff directory."
        />
        {!sheet && <div className="p-6 text-sm text-slate-500">Loading…</div>}
        {sheet && sheet.rows.length === 0 && (
          <div className="p-6">
            <EmptyState
              icon={<ChefHat className="h-6 w-6" />}
              title="Nothing to prep for this day"
              hint="Adjust PAR levels for the day-of-week or pick another date."
            />
          </div>
        )}
        {sheet && sheet.rows.length > 0 && (
          <div className="divide-y divide-surface-border">
            {sheet.rows.map((r) => (
              <div key={r.id} className="px-5 py-4 flex flex-wrap items-center gap-3">
                <div className="min-w-[200px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{r.recipe_name}</span>
                    <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                    {r.qc_signed_at && (
                      <Badge tone="success">
                        <ClipboardCheck className="h-3 w-3 mr-1" /> QC
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Suggested {r.needed_qty}
                    {r.temp_f != null && (
                      <span className="ml-3 inline-flex items-center gap-1">
                        <Thermometer className="h-3 w-3" /> {r.temp_f.toFixed(0)}°F
                      </span>
                    )}
                  </p>
                </div>
                <Field label="Assignee" className="w-48 m-0">
                  <Select
                    value={r.assigned_to_user_id ?? ''}
                    onChange={(e) => void patchRow(r.id, { assigned_to_user_id: e.target.value || null })}
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </Select>
                </Field>
                {r.assigned_to_user_id && (
                  <span className="text-xs text-slate-500">
                    {usersById.get(r.assigned_to_user_id)?.name ?? ''}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {r.status === 'pending' && (
                    <Button size="sm" leftIcon={<Play className="h-3.5 w-3.5" />} onClick={() => void startRow(r.id)}>
                      Start
                    </Button>
                  )}
                  {r.status === 'in_progress' && (
                    <Button size="sm" leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => void completeRow(r.id)}>
                      Complete
                    </Button>
                  )}
                  {(r.status === 'complete' || r.status === 'in_progress') && !r.qc_signed_at && (
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<ClipboardCheck className="h-3.5 w-3.5" />}
                      onClick={() => setQcRow(r)}
                    >
                      QC & Sign
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <QcModal
        row={qcRow}
        onClose={() => setQcRow(null)}
        onSubmit={async (temp_f) => {
          if (!qcRow) return;
          await signQc(qcRow.id, temp_f);
          setQcRow(null);
        }}
      />
    </>
  );
}

function QcModal({ row, onClose, onSubmit }: {
  row: Row | null;
  onClose: () => void;
  onSubmit: (temp_f: number | null) => Promise<void>;
}) {
  const [temp, setTemp] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (row) setTemp(row.temp_f != null ? String(row.temp_f) : '');
    else setTemp('');
  }, [row]);

  async function handle(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(temp ? Number(temp) : null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      size="sm"
      title="QC sign-off"
      description={row ? row.recipe_name : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="qc-form" disabled={submitting}>
            {submitting ? 'Signing…' : 'Sign & save'}
          </Button>
        </>
      }
    >
      <form id="qc-form" onSubmit={handle} className="space-y-3">
        <Field
          label="Temperature reading (°F)"
          hint="Leave blank if this prep item has no storage-temp target."
        >
          <Input
            type="number"
            step="0.1"
            value={temp}
            onChange={(e) => setTemp(e.target.value)}
            placeholder="40"
          />
        </Field>
      </form>
    </Modal>
  );
}
