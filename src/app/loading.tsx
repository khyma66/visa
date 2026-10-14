export default function Loading() {
  return <div role="status" aria-label="Loading section" className="page-shell py-7 sm:py-10">
    <span className="sr-only">Loading section…</span>
    <div aria-hidden="true" className="space-y-6 motion-safe:animate-pulse">
      <div className="h-8 w-48 rounded bg-slate-100" />
      <div className="h-11 rounded-full bg-slate-100" />
      {[1, 2, 3].map((row) => <div key={row} className="space-y-3 border-b border-slate-100 py-5">
        <div className="h-5 w-3/4 rounded bg-slate-100" />
        <div className="h-4 w-full rounded bg-slate-100" />
        <div className="h-4 w-1/2 rounded bg-slate-100" />
      </div>)}
    </div>
  </div>;
}
