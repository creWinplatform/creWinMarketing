import type { LocalizedText } from './catalog';

// One line of the project's go-live panel. "optional" is not counted: a channel the project does not use.
export type GoLiveItem={id:string;group:'social'|'ads'|'mobile'|'messages'|'measurement';label:LocalizedText;state:'ready'|'action'|'off'|'optional';detail:LocalizedText;href?:string;switch?:string;
  verify?:{kind:'ads';provider:string}|{kind:'mobile';id:string}};
export type GoLiveView={items:GoLiveItem[];checkedAt:string;summary:{group:GoLiveItem['group'];ready:number;total:number;action:number}[]};
