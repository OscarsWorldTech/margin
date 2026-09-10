try{
  for(const url of [`http://127.0.0.1:${process.env.PORT||8787}/api/health`,'http://127.0.0.1:8080/health']){
    const response=await fetch(url,{signal:AbortSignal.timeout(3500)});
    await response.body?.cancel();
    if(!response.ok)throw Error('Service not ready');
  }
}catch{process.exitCode=1;}
