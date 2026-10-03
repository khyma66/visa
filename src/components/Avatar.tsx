const COLORS = [
  ['#0f766e', '#99f6e4'], ['#1d4ed8', '#bfdbfe'], ['#7c3aed', '#ddd6fe'],
  ['#be123c', '#fecdd3'], ['#b45309', '#fde68a'], ['#047857', '#a7f3d0'],
];

function hash(value: string) {
  return [...value].reduce((total, character) => ((total << 5) - total + character.charCodeAt(0)) | 0, 0);
}

export function Avatar({ seed, size = 'md' }: { seed: string; size?: 'sm' | 'md' | 'lg' }) {
  const [foreground, background] = COLORS[Math.abs(hash(seed)) % COLORS.length];
  const initials = seed.split('-').slice(0, 2).map((word) => word[0]?.toUpperCase()).join('');
  const sizes = { sm: 'h-7 w-7 text-[10px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm' };
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ring-1 ring-black/5 ${sizes[size]}`}
      style={{ color: foreground, background }} aria-hidden="true">
      {initials}
    </span>
  );
}
