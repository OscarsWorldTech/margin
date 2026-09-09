type Transport = {
  read: () => Promise<{time:number}>;
  write: (time:number) => Promise<unknown>;
  status: (message:string) => void;
};

// One coordinator per loaded book. Only local listening/seeks create writes.
export class ProgressSync {
  time:number;
  revision=0;
  saved=0;
  pending:Promise<boolean>|null=null;
  reading:Promise<number|null>|null=null;
  transport:Transport;
  constructor(time:number,transport:Transport){this.time=time;this.transport=transport;}
  change(time:number){
    if(this.time===time)return;
    this.time=time;this.revision++;this.transport.status('Progress waiting to sync');
  }
  flush():Promise<boolean>{
    if(this.pending)return this.pending;
    if(this.saved===this.revision)return Promise.resolve(true);
    this.pending=(async()=>{
      try{
        this.transport.status('Syncing progress…');
        while(this.saved!==this.revision){
          const revision=this.revision,time=this.time;
          await this.transport.write(time);
          this.saved=revision;
        }
        this.transport.status('Progress synced');return true;
      }catch{this.transport.status('Sync unavailable — will retry');return false;}
    })().finally(()=>{this.pending=null;});
    return this.pending;
  }
  refresh(canApply:()=>boolean):Promise<number|null>{
    if(this.reading)return this.reading;
    this.reading=(async()=>{
      if(!await this.flush()||!canApply())return null;
      const revision=this.revision;
      try{
        const remote=await this.transport.read();
        if(!canApply()||revision!==this.revision||this.saved!==this.revision)return null;
        if(!Number.isFinite(remote.time)||remote.time<0)throw Error('Invalid position');
        this.time=remote.time;this.transport.status('Progress synced');return remote.time;
      }catch{this.transport.status('Sync unavailable — will retry');return null;}
    })().finally(()=>{this.reading=null;});
    return this.reading;
  }
}
