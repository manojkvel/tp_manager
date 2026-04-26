// v1.7 Wave 3 — horizontal bar chart with diverging axis (variance reports).
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';

export interface HBarPoint {
  label: string;
  value: number;
  tone?: 'ok' | 'warning' | 'critical';
}

interface Props {
  data: HBarPoint[];
  height?: number;
  format?: (n: number) => string;
  referenceValue?: number;
}

const toneFill: Record<NonNullable<HBarPoint['tone']>, string> = {
  ok: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
};

function defaultFormat(n: number): string {
  return n.toLocaleString();
}

export function HorizontalBarChart({ data, height = 320, format = defaultFormat, referenceValue = 0 }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 16, bottom: 8 }}>
        <XAxis type="number" tickFormatter={format} tick={{ fontSize: 12, fill: '#64748b' }} />
        <YAxis
          type="category"
          dataKey="label"
          width={140}
          tick={{ fontSize: 12, fill: '#334155' }}
        />
        <Tooltip formatter={(v) => [format(Number(v)), 'Value']} cursor={{ fill: '#f8fafc' }} />
        <ReferenceLine x={referenceValue} stroke="#cbd5e1" />
        <Bar dataKey="value" radius={[4, 4, 4, 4]}>
          {data.map((d, i) => (
            <Cell key={i} fill={toneFill[d.tone ?? 'ok']} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
