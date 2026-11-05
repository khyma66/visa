import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const url=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const react=import.meta.resolve('react');
const dependencies={
  'react':url(`export * from ${JSON.stringify(react)};export function useState(v){return [v,()=>{}];}export function useEffect(){}`),
  'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),
  'next/link':url(`import React from ${JSON.stringify(react)};export default p=>React.createElement('a',p,p.children);`),
  'next/navigation':url('export const useRouter=()=>({push(){}});'),
  'lucide-react':import.meta.resolve('lucide-react'),
  './AuthProvider':url('export const useAuth=()=>globalThis.__notificationTest.auth;'),
  './NotificationProvider':url('export const useNotifications=()=>globalThis.__notificationTest.state;'),
  '@/lib/notifications':url('export const getNotifications=async()=>globalThis.__notificationTest.state.data, readNotifications=async()=>{},saveNotificationPreferences=async()=>{};'),
};
async function load(file){let source=ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;for(const [key,value]of Object.entries(dependencies))source=source.replaceAll(`from '${key}'`,`from ${JSON.stringify(value)}`).replaceAll(`from "${key}"`,`from ${JSON.stringify(value)}`);return import(url(source));}
const {NotificationLinks}=await load('../src/components/NotificationLinks.tsx');
const {NotificationSettings}=await load('../src/components/NotificationSettings.tsx');
const {NotificationsClient}=await load('../src/components/NotificationsClient.tsx');
function setup({auth={},data={},state={}}={}){globalThis.__notificationTest={auth:{user:{id:'member'},loading:false,demoMode:false,...auth},state:{ready:true,error:'',refresh(){},data:{items:[],unreadNotifications:0,unreadMessages:0,emailAvailable:false,preferences:{reply_in_app:true,message_in_app:true,reply_email:false,message_email:false},...data},...state}};}
const render=component=>renderToStaticMarkup(React.createElement(component));
test('red dots are conditional and each icon announces its own unread count',()=>{
  setup();assert.doesNotMatch(render(NotificationLinks),/class="notification-dot"/);
  setup({data:{unreadNotifications:3,unreadMessages:2}});const html=render(NotificationLinks);
  assert.equal((html.match(/class="notification-dot"/g)||[]).length,2);
  assert.match(html,/aria-label="Notifications, 3 unread"/);assert.match(html,/aria-label="Messages, 2 unread"/);
  assert.match(html,/lucide-bell/);assert.match(html,/lucide-mail/);
  setup({data:{unreadNotifications:0,unreadMessages:2}});assert.equal((render(NotificationLinks).match(/class="notification-dot"/g)||[]).length,1);
  setup({auth:{user:null}});assert.equal(render(NotificationLinks),'');
});
test('unavailable unread status is not presented as successful zero unread',()=>{
  setup({state:{error:'Offline'}});assert.match(render(NotificationLinks),/unread status unavailable/);
});
test('per-type settings expose independent in-app choices and unavailable email is disabled',()=>{
  setup();const html=render(NotificationSettings);
  assert.match(html,/Replies To My Posts/);assert.match(html,/Direct Messages/);
  assert.equal((html.match(/type="checkbox"/g)||[]).length,4);
  assert.equal((html.match(/disabled=""/g)||[]).length,2);
  assert.match(html,/Email Notifications Are Not Available Yet/);
});
test('signed-out notifications require login; empty and failure states differ',()=>{
  setup({auth:{user:null}});assert.match(render(NotificationsClient),/login\?next=%2Fnotifications/);
  setup();assert.match(render(NotificationsClient),/Caught Up/);
  setup({state:{error:'Offline'}});const html=render(NotificationsClient);assert.match(html,/role="alert"/);assert.doesNotMatch(html,/Caught Up/);
});
test('alerts use protected destination links, show unread text and escape untrusted titles',()=>{
  setup({data:{items:[{id:'n1',kind:'reply',actor_username:'bob',title:'<script>bad</script>',href:'/questions/123#answer-456',created_at:'2026-11-04T10:00:00Z',read_at:null}]}});
  const html=render(NotificationsClient);assert.match(html,/href="\/questions\/123#answer-456"/);assert.match(html,/Unread/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
