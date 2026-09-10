import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// One lifecycle for both services. Stop process groups so downloads and FFmpeg
// children also receive shutdown signals; tini reaps orphaned descendants.
export function supervise(commands,{graceMs=8000}={}){
  return new Promise(resolve=>{
    const children=[];
    let stopping=false,exitCode=0,timer;
    const signal=(child,name)=>{
      if(!child.pid)return;
      try{if(process.platform==='win32')child.kill(name);else process.kill(-child.pid,name);}
      catch(error){if(error.code!=='ESRCH')console.error('Unable to signal child:',error.code);}
    };
    const finish=()=>{
      if(!stopping||children.some(child=>!child.done))return;
      clearTimeout(timer);
      process.off('SIGTERM',onStop);process.off('SIGINT',onStop);
      resolve(exitCode);
    };
    const stop=code=>{
      if(stopping)return;
      stopping=true;exitCode=code;
      for(const child of children)signal(child,'SIGTERM');
      timer=setTimeout(()=>{for(const child of children)signal(child,'SIGKILL');},graceMs);
      finish();
    };
    const onStop=()=>stop(0);
    process.on('SIGTERM',onStop);process.on('SIGINT',onStop);
    for(const {name,command,args=[],env=process.env} of commands){
      const child=spawn(command,args,{env,stdio:'inherit',detached:process.platform!=='win32',windowsHide:true});
      child.done=false;children.push(child);
      child.once('error',error=>{
        console.error(`${name} failed to start: ${error.code}`);
        child.done=true;stop(1);finish();
      });
      child.once('exit',(code,signalName)=>{
        child.done=true;
        if(!stopping){console.error(`${name} exited unexpectedly (${signalName||code}); stopping the container.`);stop(code||1);}
        finish();
      });
    }
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.DEMO_MODE!=='true'&&['ABS_URL','ABS_TOKEN','MARGIN_PASSWORD'].some(key=>!process.env[key])){
    console.error('Set ABS_URL, ABS_TOKEN and MARGIN_PASSWORD before starting Margin.');
    process.exitCode=1;
  }else{
    console.log('Starting Margin and the built-in transcription worker. The first model download may take several minutes.');
    process.exitCode=await supervise([
      {name:'Whisper',command:'/usr/local/bin/start-whisper',env:{...process.env,WHISPER_HOST:'127.0.0.1'}},
      {name:'Margin',command:process.execPath,args:['/app/server/index.mjs'],env:{...process.env,WHISPER_URL:'http://127.0.0.1:8080'}},
    ]);
  }
}
