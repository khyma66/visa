import { handlePostViews, viewsJson } from '@/lib/post-views-server';
import type { SecurityBindings } from '@/lib/security-edge';
import { publicArchive } from '@/lib/public-server';
export const dynamic='force-dynamic';
async function handle(request:Request) {
  try {
    const env=(await import('cloudflare:workers')).env as SecurityBindings;
    const imported=new Set(publicArchive()?.questions.filter(q=>q.status!=='archived').map(q=>q.id)??[]);
    return await handlePostViews(request,env,id=>imported.has(id));
  } catch { return viewsJson({},503); }
}
export const GET=handle;
export const POST=handle;
