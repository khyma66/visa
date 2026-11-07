export function EditedLabel({ at }: { at?: string | null }) {
  return at ? <time className="text-xs font-normal text-slate-500" dateTime={at} title={`Edited ${new Date(at).toLocaleString()}`}>Edited</time> : null;
}
