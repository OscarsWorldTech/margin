import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trackAtPosition} from '../lib/audio-position.ts';
import {changeSpeedBy,normalizeSpeed,applyPlaybackSpeed} from '../lib/playback-speed.ts';

test('finished books reopen on their last track and boundaries select the next track',()=>{
  const tracks=[{startOffset:0,duration:60},{startOffset:60,duration:40}];
  for(const [position,index] of [[0,0],[59.9,0],[60,1],[99,1],[100,1],[110,1]])assert.equal(trackAtPosition(tracks,position),index);
});

test('speed steps stay precise and applying speed does not seek or pause audio',()=>{
  let speed=1;for(let i=0;i<10;i++)speed=changeSpeedBy(speed,.05,1);
  assert.equal(speed,1.5);assert.equal(changeSpeedBy(.5,.1,-1),.5);
  assert.equal(normalizeSpeed('bad'),1);assert.equal(normalizeSpeed(100),10);
  const audio={playbackRate:1,defaultPlaybackRate:1,preservesPitch:false,currentTime:42,paused:false};
  applyPlaybackSpeed(audio,1.25);
  assert.equal(audio.currentTime,42);assert.equal(audio.paused,false);assert.equal(audio.preservesPitch,true);assert.equal(audio.playbackRate,1.25);
});
