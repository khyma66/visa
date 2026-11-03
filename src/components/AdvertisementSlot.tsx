import { inlineAdPositions } from '@/lib/membership';

type Props = { placement: 'sidebar' | 'feed'; preview?: boolean };

/** Preview-only inventory. Real ads require a reviewed provider/consent adapter. */
export function AdvertisementSlot({ placement, preview = false }: Props) {
  if (!preview) return null;
  return <aside aria-label={`Advertisement layout preview: ${placement}`} className="my-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center" data-ad-placement={placement}>
    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Advertisements</p>
    <div className={`flex items-center justify-center text-sm text-slate-500 ${placement === 'sidebar' ? 'min-h-[250px]' : 'min-h-[120px]'}`}>
      Layout preview only · No ad or tracking is loaded
    </div>
  </aside>;
}

export function FeedAdvertisementSlot({ afterPost, postCount }: { afterPost: number; postCount: number }) {
  if (!inlineAdPositions(postCount).includes(afterPost)) return null;
  return <AdvertisementSlot placement="feed" />;
}
