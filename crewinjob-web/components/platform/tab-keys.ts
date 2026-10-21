import type { KeyboardEvent } from 'react';
// Arrow keys, Home and End move between the tabs of a tablist (ARIA tabs pattern); the tab under focus is selected.
export function onTabKeys(event:KeyboardEvent<HTMLElement>){
  const tabs=[...event.currentTarget.querySelectorAll<HTMLElement>('[role=tab]:not([disabled])')],index=tabs.indexOf(document.activeElement as HTMLElement);
  if(index<0)return;
  const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
  if(next===null)return;event.preventDefault();tabs[next].focus();tabs[next].click();
}
