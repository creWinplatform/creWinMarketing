import type { CoachBriefChanges, CoachChannel } from '@/lib/platform/coach-types';
const names:Record<CoachChannel,[string,string]>={linkedin:['LinkedIn','LinkedIn'],instagram:['Instagram','Instagram'],facebook:['Facebook','Facebook'],twitter:['X','X'],email:['E-posta','Email'],seo:['Arama (SEO/blog)','Search (SEO/blog)'],whatsapp:['WhatsApp','WhatsApp'],ads:['Ücretli reklam','Paid ads']};
// Plain-language summary of what changed between two strategy brief versions.
export function briefChangeLines(changes:CoachBriefChanges,tr:boolean){
  const idx=tr?0:1,list=(ids:CoachChannel[])=>ids.map(id=>names[id][idx]).join(', '),lines:string[]=[];
  if(changes.channelsAdded.length)lines.push(tr?`Eklenen kanal: ${list(changes.channelsAdded)}`:`Channel added: ${list(changes.channelsAdded)}`);
  if(changes.channelsRemoved.length)lines.push(tr?`Çıkarılan kanal: ${list(changes.channelsRemoved)}`:`Channel removed: ${list(changes.channelsRemoved)}`);
  if(changes.positioning)lines.push(tr?'Konumlandırma değişti':'Positioning changed');
  if(changes.icp)lines.push(tr?'İdeal müşteri tanımı değişti':'Ideal customer changed');
  if(changes.planAdded)lines.push(tr?`${changes.planAdded} yeni plan eylemi`:`${changes.planAdded} new plan action(s)`);
  if(changes.planRemoved)lines.push(tr?`${changes.planRemoved} plan eylemi çıkarıldı`:`${changes.planRemoved} plan action(s) removed`);
  if(changes.planMoved)lines.push(tr?`${changes.planMoved} eylemin haftası değişti`:`${changes.planMoved} action(s) moved to another week`);
  return lines.length?lines:[tr?'İçerikte değişiklik yok':'No content changes'];
}
