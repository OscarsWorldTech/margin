export const MIN_SPEED=0.5;
export const MAX_SPEED=10;
export const SPEED_PRESETS=[0.5,1,1.2,1.5,2];
export const SPEED_KEY='margin.playback-speed';
export const SPEED_STEP_KEY='margin.playback-speed-step';
export function normalizeSpeed(value:unknown){
  const n=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
  return Number.isFinite(n)?Math.round(Math.max(MIN_SPEED,Math.min(MAX_SPEED,n))*100)/100:1;
}
export function changeSpeedBy(speed:number,step:number,direction:1|-1){
  return normalizeSpeed((Math.round(speed*100)+Math.round(step*100)*direction)/100);
}
export function speedLabel(speed:number){return speed.toFixed(2).replace(/0$/,'');}
export function savedSpeed(){
  try{return normalizeSpeed(window.localStorage.getItem(SPEED_KEY));}catch{return 1;}
}
export function savedSpeedStep():0.05|0.1{
  try{return window.localStorage.getItem(SPEED_STEP_KEY)==='0.1'?0.1:0.05;}catch{return 0.05;}
}
export function saveSpeedPreference(key:string,value:number){
  try{window.localStorage.setItem(key,String(value));}catch{/* Playback remains usable when browser storage is unavailable. */}
}
export function applyPlaybackSpeed(audio:Pick<HTMLAudioElement,'playbackRate'|'defaultPlaybackRate'|'preservesPitch'>,speed:number){
  const rate=normalizeSpeed(speed);
  audio.playbackRate=rate;
  audio.defaultPlaybackRate=rate;
  audio.preservesPitch=true;
}
