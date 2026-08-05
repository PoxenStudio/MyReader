'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { BoxedList } from '@/components/settings/primitives';
import {
  getReadingStats,
  type MyBooksReadingStats,
  type MyBooksReadingStatsWeek,
} from '@/services/mybooksService';

// SVG viewBox units — arbitrary but wide/short to match the "long rectangle"
// line chart next to the total-hours square. Not pixels: the <svg> scales
// this box to whatever width the flex layout gives it.
const CHART_VIEW_WIDTH = 280;
const CHART_VIEW_HEIGHT = 72;
const CHART_PAD_Y = 8;

const secondsToHours = (seconds: number): number => seconds / 3600;

// "2026-08-03" -> "08-03", mirrors MyBooks' own ReadingStatsBanner.vue
// (week_start.slice(5)) so week labels read the same across both frontends.
const formatWeekLabel = (weekStart: string): string => weekStart.slice(5);

const formatHours = (seconds: number): string =>
  (Math.round(secondsToHours(seconds) * 10) / 10).toFixed(1);

interface ChartPoint {
  x: number;
  y: number;
  week: MyBooksReadingStatsWeek;
}

const WeeklyReadingChart: React.FC<{ weekly: MyBooksReadingStatsWeek[] }> = ({ weekly }) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const points = useMemo<ChartPoint[]>(() => {
    const maxSeconds = Math.max(1, ...weekly.map((w) => w.reading_seconds));
    return weekly.map((week, i) => {
      const x =
        weekly.length > 1 ? (i / (weekly.length - 1)) * CHART_VIEW_WIDTH : CHART_VIEW_WIDTH / 2;
      const y =
        CHART_VIEW_HEIGHT -
        CHART_PAD_Y -
        (week.reading_seconds / maxSeconds) * (CHART_VIEW_HEIGHT - CHART_PAD_Y * 2);
      return { x, y, week };
    });
  }, [weekly]);

  if (points.length === 0) return null;

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const lastPoint = points[points.length - 1]!;
  const firstPoint = points[0]!;
  const areaPath = `${linePath} L${lastPoint.x.toFixed(1)},${CHART_VIEW_HEIGHT} L${firstPoint.x.toFixed(1)},${CHART_VIEW_HEIGHT} Z`;

  const updateHoverFromClientX = (svg: SVGSVGElement, clientX: number) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const fraction = (clientX - rect.left) / rect.width;
    const idx = Math.round(fraction * (points.length - 1));
    setHoverIndex(Math.min(points.length - 1, Math.max(0, idx)));
  };

  const hovered = hoverIndex != null ? points[hoverIndex] : null;
  // Clamp the tooltip's horizontal position so it doesn't clip past the
  // chart's edges when hovering the first/last point.
  const tooltipLeftPct = hovered
    ? Math.min(92, Math.max(8, (hovered.x / CHART_VIEW_WIDTH) * 100))
    : 0;

  return (
    <div className='relative w-full'>
      <svg
        viewBox={`0 0 ${CHART_VIEW_WIDTH} ${CHART_VIEW_HEIGHT}`}
        preserveAspectRatio='none'
        className='text-primary h-16 w-full touch-none'
        onPointerMove={(e) => updateHoverFromClientX(e.currentTarget, e.clientX)}
        onPointerDown={(e) => updateHoverFromClientX(e.currentTarget, e.clientX)}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <path d={areaPath} fill='currentColor' opacity={0.12} stroke='none' />
        <path
          d={linePath}
          fill='none'
          stroke='currentColor'
          strokeWidth={2}
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        {hovered && (
          <line
            x1={hovered.x}
            x2={hovered.x}
            y1={0}
            y2={CHART_VIEW_HEIGHT}
            stroke='currentColor'
            strokeOpacity={0.25}
            strokeWidth={1}
          />
        )}
        {points.map((p, i) => (
          <circle
            key={p.week.week_start}
            cx={p.x}
            cy={p.y}
            r={i === hoverIndex ? 3 : 2}
            fill='currentColor'
            opacity={i === hoverIndex ? 1 : 0.5}
          />
        ))}
      </svg>
      <div className='text-base-content/50 mt-1 flex justify-between text-[10px]'>
        <span>{formatWeekLabel(firstPoint.week.week_start)}</span>
        <span>{formatWeekLabel(lastPoint.week.week_start)}</span>
      </div>
      {hovered && (
        <div
          className='bg-base-content text-base-100 pointer-events-none absolute -top-6 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-medium shadow'
          style={{ left: `${tooltipLeftPct}%` }}
        >
          {formatWeekLabel(hovered.week.week_start)} · {formatHours(hovered.week.reading_seconds)}h
        </div>
      )}
    </div>
  );
};

interface ReadingStatsCardProps {
  /** Fetch (and re-fetch) only while the owning dialog is actually open. */
  isOpen: boolean;
}

/**
 * "阅读数据" card for the user settings dialog: a small square with the
 * account's all-time reading hours next to a line chart of the last 8
 * weeks. Data source: `/api/user/reading_stats` (document/MyBooks_WebAPI.md
 * §2.10), same endpoint MyBooks' own homepage ReadingStatsBanner.vue uses.
 *
 * Renders nothing while loading fails or the server has the feature turned
 * off (`enabled: false`) — this is a decorative addition to the settings
 * dialog, not something worth an error state over.
 */
const ReadingStatsCard: React.FC<ReadingStatsCardProps> = ({ isOpen }) => {
  const _ = useTranslation();
  const [stats, setStats] = useState<MyBooksReadingStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    getReadingStats()
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch((e) => {
        console.warn('Failed to load reading stats:', e);
        if (!cancelled) setStats(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (loading && !stats) {
    return (
      <BoxedList title={_('Reading Stats')}>
        <div className='flex items-stretch gap-3 px-4 py-3'>
          <div className='bg-base-200 aspect-square w-20 flex-shrink-0 animate-pulse rounded-2xl' />
          <div className='bg-base-200 min-w-0 flex-1 animate-pulse rounded-lg' />
        </div>
      </BoxedList>
    );
  }

  if (!stats) return null;

  const totalHours = secondsToHours(stats.totals.total_reading_seconds);
  const [intPart, fracPart] = (Math.round(totalHours * 10) / 10).toFixed(1).split('.');

  return (
    <BoxedList title={_('Reading Stats')}>
      <div className='flex items-stretch gap-3 px-4 py-3'>
        {/* Total reading hours — small square, left */}
        <div className='bg-primary/10 flex aspect-square w-20 flex-shrink-0 flex-col items-center justify-center rounded-2xl'>
          <span className='text-primary leading-none whitespace-nowrap'>
            <span className='text-lg font-bold'>{intPart}</span>
            <span className='text-xs font-bold'>.{fracPart}</span>
          </span>
          <span className='text-base-content/60 mt-1 text-[10px]'>{_('hrs total')}</span>
        </div>

        {/* Last 8 weeks — wide rectangle, right */}
        <div className='flex min-w-0 flex-1 flex-col justify-center'>
          <span className='text-base-content/60 mb-1 text-[10px]'>{_('Last 8 Weeks')}</span>
          <WeeklyReadingChart weekly={stats.weekly} />
        </div>
      </div>
    </BoxedList>
  );
};

export default ReadingStatsCard;
