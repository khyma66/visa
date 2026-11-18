import { handlePostViews, viewsJson } from '@/lib/post-views-server';
import type { SecurityBindings } from '@/lib/security-edge';
import { publicArchive } from '@/lib/public-server';
import {publishedArchiveQuestionIds} from '@/lib/archive-server';
export const dynamic='force-dynamic';
async function handle(request:Request) {
  try {
    const env=(await import('cloudflare:workers')).env as SecurityBindings;
    const imported=new Set(publicArchive()?.questions.filter(q=>q.status!=='archived').map(q=>q.id)??[]);
    let indexed:Promise<Set<string>>|undefined;
    return await handlePostViews(request,env,id=>{
      if(!process.env.NEXT_PUBLIC_SUPABASE_URL)return imported.has(id);
      indexed??=publishedArchiveQuestionIds(new URL(request.url).searchParams.getAll('id').filter(target=>target.startsWith('apify-')));
      return indexed.then(targets=>targets.has(id));
    });
  } catch { return viewsJson({},503); }
}
export const GET=handle;
export const POST=handle;
