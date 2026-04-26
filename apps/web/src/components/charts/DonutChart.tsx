// v1.7 Wave 3 — donut chart (waste bucket breakdown).
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export interface DonutSlice {
  label: string;
  value: number;
  color?: string;
}

interface Props {
  slices: DonutSlice[];
  height?: number;
  format?: (n: number) => string;
  centerLabel?: string;
  centerValue?: string;
}

const palette = ['#ef4444', '#f59e0b', '#0ea5e9', '#a855f7', '#10b981', '#64748b'];

function defaultFormat(n: number): string {
  return n.toLocaleString();
}

export function DonutChart({ slices, height = 280, format = defaultFormat, centerLabel, centerValue }: Props) {
  const data = slices.map((s, i) => ({ ...s, color: s.color ?? palette[i % palette.length] }));
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          <Tooltip formatter={(v) => format(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      {(centerLabel || centerValue) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          style={{ top: 0, height: height * 0.82 }}>
          {centerValue && <div className="text-2xl font-semibold text-slate-900 tabular-nums">{centerValue}</div>}
          {centerLabel && <div className="text-xs uppercase tracking-wide text-slate-500 mt-0.5">{centerLabel}</div>}
        </div>
      )}
    </div>
  );
}
