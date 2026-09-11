import {useEffect,useState,type RefObject} from 'react';
import {Volume2,VolumeX,SlidersHorizontal,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Slider} from '@/components/ui/slider';
import {Popover,PopoverTrigger,PopoverContent,PopoverTitle,PopoverDescription} from '@/components/ui/popover';
import {VOLUME_KEY,applyVolume,savedVolume,toggleMute,volumeAt} from '@/lib/playback-volume';

// Takes anything with volume and muted, matching applyVolume, so the native
// player can receive the same preference changes as the browser audio element.
export function PlaybackVolume({audio}:{audio:RefObject<Pick<HTMLAudioElement,'volume'|'muted'>|null>}){
  const [preference,setPreference]=useState(savedVolume),[open,setOpen]=useState(false);
  useEffect(()=>{
    if(audio.current)applyVolume(audio.current,preference);
    try{window.localStorage.setItem(VOLUME_KEY,JSON.stringify(preference));}catch{/* Volume works without browser storage. */}
  },[audio,preference]);
  const silent=preference.muted||preference.volume===0;
  return <div className="volume-control">
    <Button className="volume-mute" variant="ghost" aria-label={silent?'Unmute':'Mute'} aria-pressed={silent} onClick={()=>setPreference(toggleMute)}>{silent?<VolumeX/>:<Volume2/>}</Button>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" className="volume-trigger"/>} aria-label={'Volume controls, '+(silent?'muted':Math.round(preference.volume*100)+' percent')}><SlidersHorizontal/></PopoverTrigger>
      <PopoverContent className="volume-popover" side="top" align="end" sideOffset={16}>
        <div className="volume-heading"><PopoverTitle>Volume</PopoverTitle><Button variant="ghost" aria-label="Close volume controls" onClick={()=>setOpen(false)}><X/></Button></div>
        <output aria-live="polite">{preference.muted?'Muted':Math.round(preference.volume*100)+'%'}</output>
        <Slider aria-label="Volume" min={0} max={100} step={1} value={[Math.round(preference.volume*100)]} onValueChange={v=>setPreference(current=>volumeAt(current,Array.isArray(v)?v[0]:v))}/>
        <PopoverDescription>Remembered in this browser. On devices that restrict browser volume, use your device’s volume buttons.</PopoverDescription>
      </PopoverContent>
    </Popover>
  </div>;
}
