export const VOLUME_KEY='margin.playback-volume';
export type VolumePreference={volume:number;muted:boolean;lastAudible:number};
const clamp=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):fallback;
export function normalizeVolume(value:Partial<VolumePreference>|null|undefined):VolumePreference{
  const volume=clamp(value?.volume,1);
  return {volume,muted:value?.muted===true,lastAudible:clamp(value?.lastAudible,volume||1)||1};
}
export function savedVolume():VolumePreference{
  try{return normalizeVolume(JSON.parse(window.localStorage.getItem(VOLUME_KEY)||'null'));}catch{return normalizeVolume(null);}
}
export function volumeAt(current:VolumePreference,percent:number):VolumePreference{
  const volume=clamp(percent/100,current.volume);
  return {volume,muted:false,lastAudible:volume>0?volume:current.lastAudible};
}
export function toggleMute(current:VolumePreference):VolumePreference{
  if(current.muted||current.volume===0)return {...current,muted:false,volume:current.volume||current.lastAudible};
  return {...current,muted:true};
}
export function applyVolume(audio:Pick<HTMLAudioElement,'volume'|'muted'>,preference:VolumePreference){
  audio.volume=preference.volume;audio.muted=preference.muted;
}
