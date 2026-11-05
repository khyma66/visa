'use client';

import {useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

/** Non-modal disclosure: native links/buttons, keyboard navigation and light dismissal. */
export function ActionPopover({label,trigger,children,triggerClassName='post-options-trigger'}:{label:string;trigger:ReactNode;children:ReactNode;triggerClassName?:string}) {
  const [open,setOpen]=useState(false);
  const [position,setPosition]=useState<{left:number;top:number}|null>(null);
  const button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
  const id=useId();
  const close=(restore=false)=>{setOpen(false);setPosition(null);if(restore)button.current?.focus();};
  useLayoutEffect(()=>{
    if(!open||!button.current||!panel.current)return;
    const anchor=button.current.getBoundingClientRect(),box=panel.current.getBoundingClientRect();
    const left=Math.max(8,Math.min(anchor.right-box.width,window.innerWidth-box.width-8));
    const top=Math.max(8,Math.min(anchor.bottom+6+box.height<=window.innerHeight-8?anchor.bottom+6:anchor.top-box.height-6,window.innerHeight-box.height-8));
    setPosition({left,top});

  },[open]);
  useLayoutEffect(()=>{if(position)panel.current?.focus({preventScroll:true});},[position]);
  useEffect(()=>{
    if(!open)return;
    const inside=(target:EventTarget|null)=>target instanceof Node&&(panel.current?.contains(target)||button.current?.contains(target));
    const modal=()=>Boolean(panel.current?.querySelector('dialog[open]'));
    const pointer=(event:PointerEvent)=>{if(!inside(event.target)&&!modal())close();};
    const focus=(event:FocusEvent)=>{if(!inside(event.target)&&!modal())close();};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!modal()){event.preventDefault();close(true);}};
    const reposition=()=>{if(!modal())close();};
    const scroll=(event:Event)=>{if(!panel.current?.contains(event.target as Node)&&!modal())close();};
    document.addEventListener('pointerdown',pointer);document.addEventListener('focusin',focus);document.addEventListener('keydown',escape);
    window.addEventListener('resize',reposition);document.addEventListener('scroll',scroll,true);
    return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('focusin',focus);document.removeEventListener('keydown',escape);window.removeEventListener('resize',reposition);document.removeEventListener('scroll',scroll,true);};
  },[open]);
  return <>
    <button ref={button} type="button" className={triggerClassName} aria-label={label} aria-expanded={open} aria-controls={open?id:undefined} aria-haspopup="dialog" onClick={()=>open?close():setOpen(true)}>{trigger}</button>
    {open&&createPortal(<div ref={panel} id={id} role="dialog" aria-label={label} tabIndex={-1} className="post-options-panel" style={{...position,maxHeight:position?`calc(100dvh - ${position.top+8}px)`:undefined,visibility:position?'visible':'hidden'}} onClick={event=>{if((event.target as Element).closest('a,[data-close-popover]'))close();}} onKeyDown={event=>{
      if((event.target as Element).closest('dialog'))return;
      const items=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],summary')].filter(item=>item.getClientRects().length>0);
      const current=items.indexOf(document.activeElement as HTMLElement);
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(current+1)%items.length:current<0?items.length-1:(current-1+items.length)%items.length;items[next]?.focus();
      }else if(event.key==='Tab'&&((event.shiftKey&&current<=0)||(!event.shiftKey&&current===items.length-1))){close(true);}
    }}>{children}</div>,document.body)}
  </>;
}
