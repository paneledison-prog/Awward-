'use client';

import type { JobEvent } from '@/lib/types';
import { Icon } from './Icon';

export function ProgressPanel({ events, error }: { events: JobEvent[]; error: string }) {
  const latest = events[events.length - 1];
  const progress = error ? 100 : (latest?.progress ?? 0);

  return (
    <div className="card p-6">
      <div className="mb-4 h-1 w-full overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            error ? 'bg-rose' : 'bg-accent'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <ol className="flex flex-col gap-1.5 text-xs">
        {events.map((event, index) => {
          const done = index < events.length - 1 || event.step === 'done';
          return (
            <li key={`${event.step}-${event.at}-${index}`} className="flex items-start gap-3">
              <span className={done ? 'text-fg' : 'text-fg-faint animate-pulse-bar'}>
                <Icon name={done ? 'tick' : 'arrowRight'} size={14} className="mt-px" />
              </span>
              <span className="w-10 shrink-0 text-fg-faint">{event.progress}%</span>
              <span className={done ? 'text-fg-dim' : 'text-fg'}>{event.message}</span>
            </li>
          );
        })}
      </ol>

      {error ? (
        <p className="mt-4 rounded-md border border-rose/30 bg-rose/5 px-3 py-2 font-mono text-xs text-rose">
          {error}
        </p>
      ) : null}
    </div>
  );
}
