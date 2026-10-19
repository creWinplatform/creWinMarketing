// Budget and goal planner math. Pure, client-safe and deterministic: every number comes from the team's own
// assumptions (each a low–high range) or from values measured for this project. Nothing here is a forecast.
export type Range={low:number;high:number};
export type PaidInputs={budget:number;cpc:Range;conversion:Range;close?:Range|null;value?:number|null};
export type SeoInputs={hours:number;hourlyRate:number;tools:number;pieces:number;pieceCost:number;clicks:number;growth:Range;conversion:Range;close?:Range|null;value?:number|null};
export type Outcome={clicks:number;leads:number;customers:number|null;costPerLead:number|null;costPerCustomer:number|null;revenue:number|null;roas:number|null};
export type Scenario={cost:number;low:Outcome;expected:Outcome;high:Outcome};
export type Swing={input:string;share:number};
const mid=(range:Range)=>(range.low+range.high)/2;
export function validRange(range:Range,min:number,max:number){return Number.isFinite(range.low)&&Number.isFinite(range.high)&&range.low>=min&&range.high<=max&&range.low<=range.high;}
// One outcome for a given click count. Costs per lead/customer are null when there is nothing to divide by.
function outcome(cost:number,clicks:number,conversion:number,close:number|null,value:number|null):Outcome{
  const leads=clicks*conversion,customers=close===null?null:leads*close,revenue=customers===null||value===null?null:customers*value;
  return {clicks,leads,customers,costPerLead:leads>0?cost/leads:null,costPerCustomer:customers&&customers>0?cost/customers:null,revenue,roas:revenue===null||cost<=0?null:revenue/cost};
}
// Paid ads: clicks = budget ÷ CPC. "Low" combines the worst end of every range (highest CPC, lowest rates), "high" the best.
export function paidScenario(input:PaidInputs):Scenario{
  const close=input.close??null,value=input.value??null,at=(cpc:number,conversion:number,rate:number|null)=>outcome(input.budget,cpc>0?input.budget/cpc:0,conversion,rate,value);
  return {cost:input.budget,low:at(input.cpc.high,input.conversion.low,close?close.low:null),expected:at(mid(input.cpc),mid(input.conversion),close?mid(close):null),high:at(input.cpc.low,input.conversion.high,close?close.high:null)};
}
// SEO: monthly cost is people and content work; clicks start from today's organic clicks and the team's growth range.
export function seoScenario(input:SeoInputs):Scenario{
  const cost=input.hours*input.hourlyRate+input.tools+input.pieces*input.pieceCost,close=input.close??null,value=input.value??null;
  const at=(growth:number,conversion:number,rate:number|null)=>outcome(cost,input.clicks*(1+growth),conversion,rate,value);
  return {cost,low:at(input.growth.low,input.conversion.low,close?close.low:null),expected:at(mid(input.growth),mid(input.conversion),close?mid(close):null),high:at(input.growth.high,input.conversion.high,close?close.high:null)};
}
// Goal solver for paid ads: the budget a lead target needs under the CPC and conversion ranges (best to worst case).
export function requiredBudget(targetLeads:number,cpc:Range,conversion:Range):{low:number|null;expected:number|null;high:number|null}{
  const need=(price:number,rate:number)=>rate>0?targetLeads/rate*price:null;
  return {low:need(cpc.low,conversion.high),expected:need(mid(cpc),mid(conversion)),high:need(cpc.high,conversion.low)};
}
// Which assumption moves the expected leads the most: each range is swung alone while the others stay at their middle.
export function paidSensitivity(input:PaidInputs):Swing[]{
  const base={...input,close:null,value:null},leads=(patch:Partial<PaidInputs>)=>paidScenario({...base,...patch}).expected.leads;
  const swings=[{input:'cpc',span:Math.abs(leads({cpc:{low:input.cpc.low,high:input.cpc.low}})-leads({cpc:{low:input.cpc.high,high:input.cpc.high}}))},
    {input:'conversion',span:Math.abs(leads({conversion:{low:input.conversion.high,high:input.conversion.high}})-leads({conversion:{low:input.conversion.low,high:input.conversion.low}}))}];
  const total=swings.reduce((sum,item)=>sum+item.span,0);return swings.map(item=>({input:item.input,share:total>0?item.span/total:0})).sort((a,b)=>b.share-a.share);
}
export function seoSensitivity(input:SeoInputs):Swing[]{
  const base={...input,close:null,value:null},leads=(patch:Partial<SeoInputs>)=>seoScenario({...base,...patch}).expected.leads;
  const swings=[{input:'growth',span:Math.abs(leads({growth:{low:input.growth.high,high:input.growth.high}})-leads({growth:{low:input.growth.low,high:input.growth.low}}))},
    {input:'conversion',span:Math.abs(leads({conversion:{low:input.conversion.high,high:input.conversion.high}})-leads({conversion:{low:input.conversion.low,high:input.conversion.low}}))}];
  const total=swings.reduce((sum,item)=>sum+item.span,0);return swings.map(item=>({input:item.input,share:total>0?item.span/total:0})).sort((a,b)=>b.share-a.share);
}
