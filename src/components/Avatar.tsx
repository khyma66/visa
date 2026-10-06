const COLORS = [
  ['#115e59', '#99f6e4'], ['#1e40af', '#bfdbfe'], ['#6d28d9', '#ddd6fe'],
  ['#9f1239', '#fecdd3'], ['#92400e', '#fde68a'], ['#065f46', '#a7f3d0'],
];

function hash(value: string) {
  return [...value].reduce((total, character) => ((total << 5) - total + character.charCodeAt(0)) | 0, 0);
}

export function Avatar({ seed, size = 'md' }: { seed: string; size?: 'sm' | 'md' | 'lg' }) {
  // The server publishes only the initial, not private Google/email signup names.
  // Existing feed fields carry this versioned appearance token everywhere.
  const appearance = /^initial:([\p{L}?]):([^\r\n]+)$/u.exec(seed);
  const initial = appearance?.[1] ?? '?';
  const colorSeed = appearance?.[2] ?? seed;
  const [foreground, background] = COLORS[Math.abs(hash(colorSeed)) % COLORS.length];
  const sizes = { sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-12 w-12 text-xl' };
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ring-1 ring-black/5 ${sizes[size]}`}
      style={{ color: foreground, background }} aria-hidden="true">
      {initial}
    </span>
  );
}
