// Local repository type-checking; Supabase supplies these APIs at runtime.
declare namespace Deno {
  function serve(handler:(request:Request)=>Response|Promise<Response>):void;
  const env:{get(name:string):string|undefined};
}
