import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVolume,volumeAt,toggleMute,applyVolume} from '../lib/playback-volume.ts';

test('mute preserves volume and unmute restores the last audible level after zero',()=>{
  const initial=volumeAt(normalizeVolume(null),35);
  assert.deepEqual(toggleMute(toggleMute(initial)),initial);
  const zero=volumeAt(initial,0);
  assert.equal(toggleMute(zero).volume,.35);
  assert.equal(volumeAt(toggleMute(initial),20).muted,false);
});
test('stored volume is validated and changes do not seek, pause or change speed',()=>{
  assert.equal(normalizeVolume({volume:NaN}).volume,1);
  assert.equal(normalizeVolume({volume:-10}).volume,0);
  assert.equal(normalizeVolume({volume:20}).volume,1);
  const audio={volume:1,muted:false,currentTime:42,paused:false,playbackRate:1.25};
  applyVolume(audio,{volume:.35,muted:true,lastAudible:.35});
  assert.deepEqual(audio,{volume:.35,muted:true,currentTime:42,paused:false,playbackRate:1.25});
});
