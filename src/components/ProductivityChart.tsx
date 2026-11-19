import React from 'react';

export interface ChartDataPoint {
  label: string;
  hadir: number;
  terlambat: number;
  izin: number;
}

interface ProductivityChartProps {
  title: string;
  subtitle?: string;
  data: ChartDataPoint[];
}

export const ProductivityChart: React.FC<ProductivityChartProps> = ({
  title,
  subtitle,
  data,
}) => {
  const maxVal = Math.max(
    1,
    ...data.map((d) => d.hadir + d.terlambat + d.izin)
  );

  return (
    <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-[#F6E08B]">{title}</h3>
          {subtitle && <p className="text-xs text-zinc-400">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#D4AF37]" /> Tepat Waktu
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Terlambat
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-zinc-500" /> Izin/Sakit
          </span>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-44 flex items-center justify-center text-xs text-zinc-500">
          Belum ada data grafik untuk periode ini.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[360px] h-48 flex items-end justify-between gap-2 pt-4 pb-1 px-1">
            {data.map((item) => {
              const total = item.hadir + item.terlambat + item.izin;
              const hHadir = Math.round((item.hadir / maxVal) * 140);
              const hLate = Math.round((item.terlambat / maxVal) * 140);
              const hIzin = Math.round((item.izin / maxVal) * 140);

              return (
                <div key={item.label} className="flex-1 flex flex-col items-center gap-1.5 group">
                  <div className="text-[10px] font-mono text-zinc-400 opacity-80 group-hover:text-[#F6E08B]">
                    {total}
                  </div>
                  <div className="w-full max-w-[36px] flex flex-col-reverse items-stretch rounded-t-md overflow-hidden bg-zinc-900/70 min-h-[4px]">
                    {hHadir > 0 && (
                      <div
                        style={{ height: `${hHadir}px` }}
                        className="bg-gradient-to-t from-[#B58E24] to-[#D4AF37] transition-all"
                        title={`Tepat Waktu: ${item.hadir}`}
                      />
                    )}
                    {hLate > 0 && (
                      <div
                        style={{ height: `${hLate}px` }}
                        className="bg-amber-500 transition-all"
                        title={`Terlambat: ${item.terlambat}`}
                      />
                    )}
                    {hIzin > 0 && (
                      <div
                        style={{ height: `${hIzin}px` }}
                        className="bg-zinc-500 transition-all"
                        title={`Izin/Sakit: ${item.izin}`}
                      />
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-zinc-400 truncate max-w-[54px]">
                    {item.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
