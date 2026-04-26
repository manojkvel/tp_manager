// v1.7 Wave 3 — multi-series line trend.
import {
  LineChart as ReLineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer,
} from 'recharts';

export interface LineSeries {
  key: string;
  label: string;
  color?: string;
}

interface Props {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: LineSeries[];
  height?: number;
  yFormat?: (n: number) => string;
}

const palette = ['#ea580c', '#0ea5e9', '#10b981', '#a855f7', '#f59e0b', '#ef4444'];

export function LineChart({ data, xKey, series, height = 280, yFormat }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReLineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: '#64748b' }} />
        <YAxis tickFormatter={yFormat} tick={{ fontSize: 12, fill: '#64748b' }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? palette[i % palette.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </ReLineChart>
    </ResponsiveContainer>
  );
}
