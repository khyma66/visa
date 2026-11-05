import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {verifySecureTransport} from './smoke-transport.mjs';

const url=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const dependencies={
  react:url('export const useState=v=>globalThis.__quality.useState(v);export const useEffect=(fn,deps)=>globalThis.__quality.useEffect(fn,deps);export const useRef=v=>globalThis.__quality.useRef(v);'),
  'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),
  'next/link':url('export default function Link(){return null;}'),
  'next/navigation':url('export const useRouter=()=>({push:href=>globalThis.__quality.pushes.push(href)});'),
  'lucide-react':url('export const Bell=()=>null,MessageCircle=()=>null,MessageSquare=()=>null,Settings=()=>null;'),
  './AuthProvider':url('export const useAuth=()=>({user:globalThis.__quality.user,loading:false,demoMode:false});'),
  './NotificationProvider':url('export const useNotifications=()=>globalThis.__quality.state;'),
  '@/lib/notifications':url('export const getNotifications=page=>globalThis.__quality.get(page);export const readNotifications=(ids,user)=>globalThis.__quality.read(ids,user);'),
};
async function load(file){const source=await readFile(new URL(file,import.meta.url),'utf8');let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/(from\s+)(['"])([^'"]+)\2/g,(_,prefix,quote,name)=>{assert(dependencies[name],name);return prefix+JSON.stringify(dependencies[name]);});return import(url(code));}
const {NotificationsClient}=await load('../src/components/NotificationsClient.tsx');
const {default:ErrorPage}=await load('../src/app/error.tsx');
const notification=(id,read=false)=>({id:String(id),kind:'reply',title:'Post '+id,actor_username:'member',created_at:'2026-11-04T10:00:00Z',read_at:read?'2026-11-04T11:00:00Z':null,href:'/questions/'+id});
class Harness{
 slots=[];index=0;effects=[];dirty=false;pushes=[];calls=[];user={id:'member'};
 state={data:{items:Array.from({length:21},(_,i)=>notification(i))},ready:true,error:'',refresh(){}};
 get=async()=>({items:[notification(21)]});read=async(ids,user)=>{this.calls.push([ids,user]);};
 useState(v){const i=this.index++;if(!(i in this.slots))this.slots[i]=v;return [this.slots[i],next=>{this.slots[i]=typeof next==='function'?next(this.slots[i]):next;this.dirty=true;}];}
 useRef(v){const i=this.index++;return this.slots[i]??={current:v};}
 useEffect(fn,deps){const i=this.index++;const old=this.slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n])){old?.cleanup?.();const slot=this.slots[i]={deps};this.effects.push(()=>{slot.cleanup=fn();});}}
 render(Component=this.Component??NotificationsClient,props=this.props??{}){this.Component=Component;this.props=props;this.index=0;this.dirty=false;globalThis.__quality=this;this.tree=Component(props);}
 async settle(){for(let i=0;i<15;i++){for(const effect of this.effects.splice(0))effect();await new Promise(r=>setTimeout(r,1));if(!this.dirty)return;this.render();}assert.fail('Did not settle');}
 close(){for(const slot of this.slots)slot?.cleanup?.();delete globalThis.__quality;}
}
const nodes=node=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[];
const content=node=>Array.isArray(node)?node.map(content).join(' '):node==null||typeof node==='boolean'?'':typeof node==='object'?content(node.props?.children):String(node);
const button=(h,label)=>nodes(h.tree).find(n=>n.type==='button'&&content(n)===label);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

test('failed notification pagination stops loading and provides a working route back',async()=>{
 const h=new Harness();h.get=async()=>{throw Error('offline');};
 try{h.render();button(h,'Older').props.onClick();h.render();await h.settle();assert.match(content(h.tree),/Could Not Load Earlier/);assert.doesNotMatch(content(h.tree),/Loading Notifications/);button(h,'Back To Latest Notifications').props.onClick();h.render();await h.settle();assert.match(content(h.tree),/Post 0/);assert.doesNotMatch(content(h.tree),/Could Not Load Earlier/);}finally{h.close();}
});
test('refresh retains loaded notification history while a newer request is pending or fails',async()=>{
 const h=new Harness();try{h.render();button(h,'Older').props.onClick();h.render();await h.settle();assert.match(content(h.tree),/Post 21/);
 const pending=deferred();h.get=()=>pending.promise;h.state={...h.state,data:{...h.state.data}};h.render();await h.settle();assert.match(content(h.tree),/Post 21/);pending.reject(Error('offline'));await h.settle();assert.match(content(h.tree),/Post 21/);assert.doesNotMatch(content(h.tree),/Loading Notifications/);
 }finally{h.close();}
});
test('late pagination replies cannot replace the current page',async()=>{
 const h=new Harness();const pending=deferred();h.get=()=>pending.promise;try{h.render();button(h,'Older').props.onClick();h.render();await h.settle();h.slots[0]=0;h.render();await h.settle();pending.resolve({items:[notification('late')]});await h.settle();assert.match(content(h.tree),/Post 0/);assert.doesNotMatch(content(h.tree),/Post late/);}finally{h.close();}
});
test('notification history is hidden immediately when the signed-in member changes',async()=>{
 const h=new Harness();try{h.render();button(h,'Older').props.onClick();h.render();await h.settle();assert.match(content(h.tree),/Post 21/);
 const pending=deferred();h.get=()=>pending.promise;h.user={id:'different-member'};h.render();assert.doesNotMatch(content(h.tree),/Post 21/);await h.settle();assert.doesNotMatch(content(h.tree),/Post 21/);pending.resolve({items:[notification('other-member')]});await h.settle();assert.match(content(h.tree),/Post other-member/);
 }finally{h.close();}
});
test('read operation applies only to visible rows and announces completion',async()=>{
 const h=new Harness();try{h.render();await button(h,'Mark This Page Read').props.onClick();await h.settle();assert.equal(h.calls[0][0].length,20);assert(!h.calls[0][0].includes('20'));assert(nodes(h.tree).some(n=>n.props?.role==='status'&&content(n)==='Notifications Marked As Read.'));
 h.state={...h.state,data:{items:Array.from({length:21},(_,i)=>notification(i,i<20))}};h.render();assert.equal(button(h,'Mark This Page Read'),undefined);
 }finally{h.close();}
});
test('page error focuses recovery heading, supports both runtime retry contracts and hides raw errors',async()=>{
 for(const key of ['reset','retry']){const h=new Harness();let retries=0,focus=0;try{h.render(ErrorPage,{[key]:()=>retries++,error:Error('secret internal details')});const heading=nodes(h.tree).find(n=>n.type==='h1');heading.props.ref.current={focus(){focus++;}};await h.settle();assert.equal(focus,1);button(h,'Try Again').props.onClick();assert.equal(retries,1);assert.doesNotMatch(content(h.tree),/secret internal/);assert(nodes(h.tree).some(n=>n.props?.href==='/us/en'));}finally{h.close();}}
});
test('release transport probe rejects insecure content, wrong host, lost parameters and missing redirects',async()=>{
 const pass=async(request,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');const target=new URL(request);target.protocol='https:';return new Response(null,{status:308,headers:{location:target.href}});};await verifySecureTransport('https://visathreads.com',pass);await verifySecureTransport('https://visa-central.com',pass);
 for(const response of [new Response('login',{status:200}),new Response(null,{status:308,headers:{location:'https://evil.invalid/login'}}),new Response(null,{status:308,headers:{location:'https://visathreads.com/login'}}),new Response(null,{status:308})])await assert.rejects(()=>verifySecureTransport('https://visathreads.com',async()=>response));
 await assert.rejects(()=>verifySecureTransport('https://evil.invalid',pass));
});
