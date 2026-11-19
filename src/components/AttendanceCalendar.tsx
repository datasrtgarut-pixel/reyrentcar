import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AttendanceRecord } from '../types/app';

interface AttendanceCalendarProps {
  records: AttendanceRecord[];
  monthKey: string; // YYYY-MM
  onMonthChange: (newMonthKey: string) => void;
}

const DAY_NAMES = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

export const AttendanceCalendar: React.FC<AttendanceCalendarProps> = ({
  records,
  monthKey,
  onMonthChange,
}) => {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [year, month] = monthKey.split('-').map(Number);

  const calendarCells = useMemo(() => {
    const firstDate = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    // Monday=0 .. Sunday=6
    const startWeekday = (firstDate.getDay() + 6) % 7;

    const cells: Array<{ day: number | null; dateKey: string | null }> = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push({ day: null, dateKey: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dd = String(d).padStart(2, '0');
      const mm = String(month).padStart(2, '0');
      cells.push({ day: d, dateKey: `${year}-${mm}-${dd}` });
    }
    return cells;
  }, [year, month]);

  const recordsByDate = useMemo(() => {
    const dict: Record<string, AttendanceRecord[]> = {};
    for (const r of records) {
      if (!dict[r.dateWib]) dict[r.dateWib] = [];
      dict[r.dateWib].push(r);
    }
    return dict;
  }, [records]);

  const stepMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    onMonthChange(`${y}-${m}`);
    setSelectedDay(null);
  };

  const monthLabel = new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));

  const selectedRecords = selectedDay ? recordsByDate[selectedDay] || [] : [];

  return (
    <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#F6E08B]">Kalender Kehadiran</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => stepMonth(-1)}
            className="rounded-lg border border-zinc-800 bg-[#18181D] p-1.5 text-zinc-300 hover:border-[#D4AF37]/50 hover:text-white cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-zinc-200 min-w-[120px] text-center capitalize">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => stepMonth(1)}
            className="rounded-lg border border-zinc-800 bg-[#18181D] p-1.5 text-zinc-300 hover:border-[#D4AF37]/50 hover:text-white cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-zinc-400">
        {DAY_NAMES.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {calendarCells.map((cell, idx) => {
          if (!cell.day || !cell.dateKey) {
            return <div key={`empty-${idx}`} className="h-11 rounded-lg bg-transparent" />;
          }
          const dayRecs = recordsByDate[cell.dateKey] || [];
          const hasPresent = dayRecs.some((r) => r.status === 'hadir' || r.status === 'lembur' || r.status === 'belum_pulang');
          const hasLate = dayRecs.some((r) => r.status === 'terlambat');
          const hasLeave = dayRecs.some((r) => r.status === 'izin' || r.status === 'sakit' || r.status === 'cuti');

          let bgClass = 'bg-[#18181D] border-zinc-800/80 text-zinc-300 hover:border-zinc-700';
          if (hasLate) bgClass = 'bg-amber-500/15 border-amber-500/40 text-amber-200';
          else if (hasPresent) bgClass = 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200';
          else if (hasLeave) bgClass = 'bg-sky-500/15 border-sky-500/40 text-sky-200';

          const isSelected = selectedDay === cell.dateKey;

          return (
            <button
              key={cell.dateKey}
              type="button"
              onClick={() => setSelectedDay(cell.dateKey)}
              className={`h-11 rounded-xl border flex flex-col items-center justify-center text-xs font-mono transition cursor-pointer ${bgClass} ${
                isSelected ? 'ring-2 ring-[#D4AF37]' : ''
              }`}
            >
              <span className="font-semibold">{cell.day}</span>
              {dayRecs.length > 0 && (
                <span className="text-[9px] leading-none mt-0.5 text-zinc-300">
                  {dayRecs.length} cat.
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-4 pt-1 text-[11px] text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-emerald-500/50 border border-emerald-400" />
          Hadir / Lembur
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-amber-500/50 border border-amber-400" />
          Terlambat
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-sky-500/50 border border-sky-400" />
          Izin / Sakit / Cuti
        </span>
      </div>

      {selectedDay && (
        <div className="rounded-xl border border-zinc-800 bg-[#18181D] p-3 text-xs space-y-2">
          <div className="font-semibold text-[#F6E08B]">Detail Tanggal {selectedDay}</div>
          {selectedRecords.length === 0 ? (
            <p className="text-zinc-400">Tidak ada catatan absensi pada tanggal ini.</p>
          ) : (
            <div className="space-y-1.5">
              {selectedRecords.map((r) => (
                <div key={r.id} className="flex items-center justify-between border-b border-zinc-800/70 pb-1 last:border-0 last:pb-0">
                  <span className="font-medium text-zinc-200">{r.employeeName}</span>
                  <span className="font-mono text-zinc-400">
                    {r.checkInTime || '-'} s/d {r.checkOutTime || 'Belum Pulang'} · {r.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
