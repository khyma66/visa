import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import typography from '../tailwind.config.mjs';

const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const reactUrl = import.meta.resolve('react');
const flowSource = await readFile(new URL('../src/lib/auth-flow.ts', import.meta.url), 'utf8');
const flowUrl = url(ts.transpileModule(flowSource, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const dependencies = {
  'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  react: url(`
    export const useRef=initial=>({current:initial});
    export const useEffect=(effect)=>{globalThis.__authPresentation.effects.push(effect);};
    export function useState(initial){const state=globalThis.__authPresentation;
      const index=state.index++;if(!Object.hasOwn(state.values,index))state.values[index]=initial;
      return [state.values[index],value=>{state.values[index]=typeof value==='function'?value(state.values[index]):value;}];}`),
  'next/link': url(`import React from ${JSON.stringify(reactUrl)};export default props=>React.createElement('a',props,props.children);`),
  'next/navigation': url('export const useRouter=()=>({replace(path){globalThis.__authPresentation.redirects.push(path);},push(){}});'),
  'lucide-react': import.meta.resolve('lucide-react'),
  './AuthProvider': url('export const useAuth=()=>({user:null,loading:false,demoMode:false,...globalThis.__authPresentation.auth});'),
  '@/lib/supabase/client': url('export const getAuthMethods=()=>{throw new Error("No network in presentation tests")};'),
  '@/lib/auth-flow': flowUrl,
};
const source=await readFile(new URL('../src/components/AuthForm.tsx',import.meta.url),'utf8');
let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [specifier,replacement] of Object.entries(dependencies)) code=code.replaceAll(`from '${specifier}'`,`from ${JSON.stringify(replacement)}`).replaceAll(`from "${specifier}"`,`from ${JSON.stringify(replacement)}`);
const {AuthForm}=await import(url(code));
function render(values={},signup=false,auth={}){
  globalThis.__authPresentation={index:0,values,auth,effects:[],redirects:[]};
  try{return renderToStaticMarkup(React.createElement(AuthForm,{signup}));}
  finally{delete globalThis.__authPresentation;}
}
const button=(html,label)=>[...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match=>match[0]).find(markup=>markup.includes(label));

test('login defaults to email code and a stored session identifies its account explicitly',()=>{
  const html=render({11:{google:true,phone:false}});
  assert.match(html,/Send verification code/);
  assert.doesNotMatch(html,/type="password"/);
  const signedIn=render({},false,{user:{id:'alice',email:'alice@example.invalid'}});
  assert.match(signedIn,/alice@example.invalid/);
  assert(button(signedIn,'Use a different account'));
  assert(button(signedIn,'Continue to VisaThreads'));
});

test('OAuth errors take priority over a stored session and manual visits never silently redirect',()=>{
  const originalWindow=globalThis.window;
  try {
    for(const [query,expected] of [
      ['?next=/messages',[]],
      ['?auth=callback&next=/messages',['/messages']],
      ['?auth=callback&error=access_denied&next=/messages',[]],
      ['?auth=callback&code=expired-test-code&next=/messages',[]],
    ]) {
      const state={index:0,values:{},auth:{user:{id:'alice',email:'alice@example.invalid'}},effects:[],redirects:[]};
      globalThis.__authPresentation=state;
      let cleaned='';
      globalThis.window={location:{search:query,hash:''},history:{replaceState(_state,_unused,path){cleaned=path;}}};
      renderToStaticMarkup(React.createElement(AuthForm));
      state.effects[1]();
      assert.deepEqual(state.redirects,expected);
      if(query.includes('error=') || query.includes('code=')) { assert.match(cleaned,/^\/login\?next=/); assert(!cleaned.includes('access_denied')); assert(!cleaned.includes('expired-test-code')); }
    }
  } finally { globalThis.window=originalWindow; delete globalThis.__authPresentation; }
});

test('unconfigured Google stays visible but the simple email prompt remains primary',()=>{
  for(const signup of [false,true]){
    const html=render({11:{google:false,phone:false}},signup);
    assert.match(button(html,'Continue with Google'),/disabled=""/);
    assert.match(button(html,'Continue with Google'),/Not available yet/);
    assert.doesNotMatch(html,/aria-label="Sign-in contact method"|Not available yet<\/button>/);
    assert.doesNotMatch(html,/Supabase|Twilio|Resend/);
  }
});
test('configured Google and phone keep one primary prompt with a secondary phone link',()=>{
  const html=render({11:{google:true,phone:true}});
  assert.doesNotMatch(button(html,'Continue with Google'),/disabled=""/);
  assert.match(html,/Use phone instead/);
  assert.doesNotMatch(html,/Sign-in contact method|aria-pressed/);
  assert.doesNotMatch(html,/Not available yet/);
});
test('loading and failed settings keep provider actions disabled and allow retry',()=>{
  const loading=render();
  assert.match(loading,/Checking sign-in options/);
  assert.match(button(loading,'Continue with Google'),/disabled=""/);
  const failed=render({12:true});
  assert.match(failed,/Retry/);
  assert.match(button(failed,'Continue with Google'),/disabled=""/);
});
test('phone mode uses telephone input and SMS verification without a password',()=>{
  const phone=render({4:true,5:'phone',11:{google:true,phone:true}});
  assert.match(phone,/type="tel"/);
  assert.doesNotMatch(phone,/type="password"/);
  assert.match(phone,/Use phone instead/);
  const verify=render({1:'+15551234567',4:true,5:'phone',6:'code',11:{google:true,phone:true}});
  assert.match(verify,/Check your phone/);
  assert.match(verify,/autoComplete="one-time-code"/);
  assert.match(verify,/Use a different phone/);
});
test('email signup collects private names and policy acknowledgement happens only after sign-in',()=>{
  const signup=render({11:{google:true,phone:true}},true);
  const inputs=[...signup.matchAll(/<input\b[^>]*>/g)].map(match=>match[0]);
  assert.match(inputs.find(input=>input.includes('name="firstName"')),/required=""/);
  assert.doesNotMatch(inputs.find(input=>input.includes('name="lastName"')),/required/);
  assert.doesNotMatch(signup,/type="checkbox"/);
  assert.doesNotMatch(render({11:{google:true,phone:true}}),/type="checkbox"/);
  assert.match(signup,/Your full name stays private/);
  assert.match(signup,/href="\/terms"/);
  assert.match(signup,/href="\/privacy"/);
  for(const html of [render({11:{google:true,phone:true}}),render({5:'phone',11:{google:true,phone:true}},true),render({6:'code'},true)]) assert.doesNotMatch(html,/name="firstName"|name="lastName"/);
});

function findElement(tree,predicate) {
  if(!tree||typeof tree!=='object')return null;
  if(predicate(tree))return tree;
  for(const child of React.Children.toArray(tree.props?.children)) {
    const found=findElement(child,predicate);
    if(found)return found;
  }
  return null;
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function interactive(t,{values={},auth={},signup=true,query='?next=/messages'}={}) {
  const originalWindow=globalThis.window;
  const state={index:0,values,auth,effects:[],redirects:[]};
  globalThis.__authPresentation=state;
  globalThis.window={location:{origin:'https://visathreads.com',search:query,hash:''}};
  t.after(()=>{globalThis.window=originalWindow;delete globalThis.__authPresentation;});
  return {state,tree:AuthForm({signup})};
}

test('Google signup launches without email names or a preliminary checkbox',async t=>{
  const calls=[];
  const {tree}=interactive(t,{values:{11:{google:true,phone:false}},auth:{signInWithProvider:async(...args)=>{calls.push(args);}}});
  const google=findElement(tree,node=>node.type==='button'&&renderToStaticMarkup(node).includes('Continue with Google'));
  assert.equal(google.props.type,'button','Email form validation must not block Google');
  google.props.onClick();await tick();
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'google');
  assert.equal(new URL(calls[0][2]).searchParams.get('next'),'/messages');
});

test('email signup passes entered names and safe return target; verification does not require a password',async t=>{
  const calls=[];
  const {tree,state}=interactive(t,{values:{0:'ada@example.invalid',14:'Ada',15:'Lovelace'},auth:{requestCode:async(...args)=>{calls.push(args);}}});
  findElement(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});await tick();
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'ada@example.invalid');
  assert.equal(calls[0][2],true);
  assert.deepEqual(calls[0][3],{firstName:'Ada',lastName:'Lovelace'});
  assert.equal(new URL(calls[0][1]).searchParams.get('next'),'/messages');
  state.index=0;state.effects=[];state.values[6]='code';state.values[2]='123456';
  state.auth={verifyCode:async(...args)=>{calls.push(args);}};
  const verify=AuthForm({signup:true});
  findElement(verify,node=>node.type==='form').props.onSubmit({preventDefault(){}});await tick();
  assert.deepEqual(state.redirects,['/messages']);
  assert(!state.redirects.some(path=>path.includes('update-password')));
});
test('typography uses Stacks system font, compact scale and responsive headings',async()=>{
  const {fontFamily,fontSize,fontWeight}=typography.theme.extend;
  assert.equal(fontFamily.sans[0],'-apple-system');
  assert(fontFamily.sans.includes('"Segoe UI"'));
  assert.equal(fontSize.base[0],'0.875rem');
  assert.equal(fontSize.sm[0],'0.8125rem');
  assert.equal(fontSize['3xl'][0],'var(--type-headline)');
  assert.equal(fontWeight.bold,'600');
  const css=await readFile(new URL('../src/styles/globals.css',import.meta.url),'utf8');
  assert(css.includes('--type-headline: 1.75rem;'));
  assert(css.includes('--type-headline: 1.4375rem;'));
  assert(css.includes('font-sans text-base'));
  assert(css.includes('font-size: 1rem'));
});
