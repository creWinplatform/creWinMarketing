import {PILOT_LIMITS} from './limits';
import type {PlanCatalogEntry} from './plan-catalog';

export type MonthlyResource='ai'|'audits';
export type UsageReservation={id:string;period:string;resource:MonthlyResource};
export type ReservationState='reserved'|'committed'|'released';
export type PlanResource=keyof typeof PILOT_LIMITS;
export type PlanUsage={
  projectId:string;
  /** paidPlan/endsAt/inGrace only for a paid period; the price and provider stay on the billing page. */
  plan:{id:'pilot'|'trial'|'paid';active:boolean;price:null;currency:null;provider:null;checkoutEnabled:false;paidPlan?:'launch'|'growth'|'team';endsAt?:string|null;inGrace?:boolean};
  commercial:{catalogVersion:string;catalog:readonly PlanCatalogEntry[];preference:{planId:'launch'|'growth';catalogVersion:string;updatedAt:string}|null;canManage:boolean;livePurchase:boolean};
  deliveryAllowed:boolean;
  capacities:{seats:{used:number;limit:number|null};socialAccounts:{used:number;limit:number|null}};
  period:{key:string;startsAt:string;endsAt:string;timezone:'UTC'};
  resources:{resource:PlanResource;used:number;limit:number;remaining:number;kind:'monthly'|'stored';state:'available'|'near_limit'|'at_limit'|'over_limit'}[];
  monthly:{resource:MonthlyResource;reserved:number;committed:number;released:number;previousCounter:number|null;consistent:boolean}[];
  recent:{id:string;resource:MonthlyResource;status:ReservationState;createdAt:string;settledAt:string|null;needsReview:boolean}[];
  // Token counts as the AI provider reported them for this period. Usage only: not a bill and not a price.
  providerUsage:{provider:string;model:string;calls:number;prompt:number;output:number;thinking:number;total:number}[];
};
