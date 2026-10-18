import twitterText from 'twitter-text';

export function xText(text:string) {
  if(typeof text!=='string'||text.length>10000)return {length:10001,valid:false};
  const parsed=twitterText.parseTweet(text);
  return {length:parsed.weightedLength,valid:Boolean(text.trim())&&parsed.valid};
}
