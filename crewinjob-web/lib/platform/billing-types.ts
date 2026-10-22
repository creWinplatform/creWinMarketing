export type BillingPlan = {id:string;name:string;amountMinor:number;currency:'USD';cadence:'monthly'|'yearly'};
export type BillingOrderState = 'preparing'|'pending'|'test_paid'|'test_failed'|'rejected'|'uncertain'|'review';
export type BillingCheckOutcome='checking'|'confirmed'|'not_confirmed'|'mismatch'|'unavailable'|'changed';
export type BillingCheckReason='matched'|'no_confirmed_payment'|'provider_unavailable'|'invalid_response'|'details_mismatch'|'refund_observed'|'configuration_changed'|'authority_lost'|'order_changed'|'interrupted'|'review_required'|'contradicting_result';
export type BillingCheck={outcome:BillingCheckOutcome;reason:BillingCheckReason|null;createdAt:string;completedAt:string|null;interrupted:boolean};
export type BillingOrder = {
  id:string;planName:string;amountMinor:number;currency:'USD';cadence:'monthly'|'yearly';
  state:BillingOrderState;createdAt:string;expiresAt:string;updatedAt:string;checkoutUrl:string|null;
  settlementSource:'notification'|'status_inquiry'|null;latestCheck:BillingCheck|null;canCheck:boolean;
};
export type BillingReadiness = {
  provider:'paytr';mode:'sandbox';liveEnabled:false;subscriptionEnabled:false;
  checks:{gate:boolean;credentials:boolean;usdAcknowledged:boolean;origin:boolean;catalog:boolean};
  ready:boolean;
};
export type ProjectBillingView = {
  projectId:string;readiness:BillingReadiness;emailVerified:boolean;plans:BillingPlan[];orders:BillingOrder[];statusCheckEnabled:boolean;
};
// Live billing (prepaid periods, behind PLATFORM_PAYTR_LIVE_ENABLED).
export type LivePlanId='launch'|'growth';
export type LiveBillingPlan={id:LivePlanId;name:string;cadence:'monthly'|'yearly';amountMinor:number;seats:number;socialAccounts:number;ai:number;audits:number};
export type LiveBillingOrderState='preparing'|'pending'|'paid'|'failed'|'rejected'|'uncertain'|'review';
export type LiveBillingOrder={id:string;planId:LivePlanId;cadence:'monthly'|'yearly';amountMinor:number;currency:'USD';state:LiveBillingOrderState;createdAt:string;expiresAt:string;paidAt:string|null;checkoutUrl:string|null};
export type LiveBillingView={
  enabled:boolean;termsUrl:string|null;plans:LiveBillingPlan[];
  current:{planId:LivePlanId;cadence:'monthly'|'yearly';startsAt:string;endsAt:string;graceEndsAt:string;inGrace:boolean}|null;
  nextStartsAt:string|null;canPurchase:boolean;pilotManaged:boolean;purchaseOpensAt:string|null;openOrder:boolean;emailVerified:boolean;orders:LiveBillingOrder[];
};
