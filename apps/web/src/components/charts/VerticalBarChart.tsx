// v1.7 Wave 3 — vertical grouped bars (e.g. theoretical vs actual by weekday).
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer,
} from 'recharts';

export interface VBarSeries {
  key: string;
  label: string;
  color?: string;
}

interface Props {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: VBarSeries[];
  height?: number;
  yFormat?: (n: number) => string;
}

const palette = ['#ea580c', '#0ea5e9', '#10b981', '#a855f7'];

export function VerticalBarChart({ data, xKey, series, height = 280, yFormat }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: '#64748b' }} />
        <YAxis tickFormatter={yFormat} tick={{ fontSize: 12, fill: '#64748b' }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color ?? palette[i % palette.length]}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
