import {useState} from 'react';
import {Minus,Plus,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Popover,PopoverContent,PopoverTitle,PopoverDescription,PopoverTrigger} from '@/components/ui/popover';
import {MIN_SPEED,MAX_SPEED,SPEED_PRESETS,SPEED_STEP_KEY,changeSpeedBy,speedLabel,savedSpeedStep,saveSpeedPreference} from '@/lib/playback-speed';

export function PlaybackSpeed({speed,onChange}:{speed:number;onChange:(speed:number)=>void}){
  const [open,setOpen]=useState(false),[step,setStep]=useState(savedSpeedStep);
  function chooseStep(value:0.05|0.1){setStep(value);saveSpeedPreference(SPEED_STEP_KEY,value);}
  return <div className="speed-control"><Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant="outline" className="speed-trigger"/>} aria-label={'Playback speed, '+speedLabel(speed)+' times'}>{speedLabel(speed)}×</PopoverTrigger>
    <PopoverContent className="speed-popover" side="top" align="end" sideOffset={16}>
      <div className="speed-heading"><PopoverTitle>Playback speed</PopoverTitle><Button variant="ghost" aria-label="Close speed controls" onClick={()=>setOpen(false)}><X/></Button></div>
      <div className="speed-presets" role="group" aria-label="Preset speeds">{SPEED_PRESETS.map(rate=><Button key={rate} variant={speed===rate?'secondary':'outline'} aria-pressed={speed===rate} onClick={()=>onChange(rate)}>{rate}×</Button>)}</div>
      <div className="speed-adjustment"><Button variant="outline" aria-label={'Decrease speed by '+step} disabled={speed<=MIN_SPEED} onClick={()=>onChange(changeSpeedBy(speed,step,-1))}><Minus/></Button><output aria-live="polite" aria-label="Current playback speed">{speedLabel(speed)}<span>×</span></output><Button variant="outline" aria-label={'Increase speed by '+step} disabled={speed>=MAX_SPEED} onClick={()=>onChange(changeSpeedBy(speed,step,1))}><Plus/></Button></div>
      <div className="speed-step"><span>Adjust by</span><div role="group" aria-label="Speed adjustment size">{([0.05,0.1] as const).map(value=><Button key={value} variant={step===value?'secondary':'ghost'} aria-pressed={step===value} onClick={()=>chooseStep(value)}>{value}×</Button>)}</div></div>
      <PopoverDescription>Applies immediately. Remembered on this browser.</PopoverDescription>
    </PopoverContent>
  </Popover></div>;
}
