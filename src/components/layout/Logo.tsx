export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-tangerine-500 via-tangerine-700 to-tangerine-800 shadow-[var(--shadow-glow)]" aria-hidden>
        <svg viewBox="0 0 32 32" className="size-6 text-white" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 10h13v14a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3V10Z" />
          <path d="M21 13h2.5a2.5 2.5 0 0 1 0 5H21" />
          <path d="M8 10c0-2 1.5-4 4-4 .8-1.3 2.2-2 3.6-2 2.4 0 4.4 1.8 4.4 4 1 .4 1 1.2 1 2" />
        </svg>
      </div>
      {!compact && (
        <div className="leading-none">
          <p className="font-display text-[17px] font-extrabold tracking-tight text-cocoa-900">JK CHOPP</p>
          <p className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.22em] text-tangerine-800">Gestão</p>
        </div>
      )}
    </div>
  );
}
