import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'sh';

test('each hardware configuration is complete and keeps storage and credentials consistent',t=>{
  const dockerArgs=process.env.DOCKER_CONFIG?['--config',process.env.DOCKER_CONFIG]:[];
  const version=spawnSync('docker',[...dockerArgs,'compose','version'],{encoding:'utf8',windowsHide:true});
  if(version.status!==0){t.skip('Docker Compose CLI is not installed.');return;}
  const configs={};
  for(const filename of ['compose.yml','compose.cpu.yml','compose.nvidia.yml']){
    const result=spawnSync('docker',[...dockerArgs,'compose','--env-file','.env.example','-f',filename,'config','--format','json'],{cwd:root,encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,filename+' should validate');
    configs[filename]=JSON.parse(result.stdout);
    const {margin,whisper}=configs[filename].services;
    assert.equal(margin.environment.WHISPER_URL,'http://whisper:8080');
    assert.equal(margin.volumes[0].source,'margin-data');assert.equal(whisper.volumes[0].source,'whisper-models');
    assert.equal(whisper.ports,undefined,'inference stays private to the Docker network');
  }
  const cpu=configs['compose.cpu.yml'].services.whisper;
  assert.equal(cpu.devices,undefined);assert.equal(cpu.deploy,undefined);assert.equal(cpu.group_add,undefined);
  assert.equal(cpu.build.dockerfile,'docker/whisper.cpu.Dockerfile');
  const cuda=configs['compose.nvidia.yml'].services.whisper;
  assert.equal(cuda.devices,undefined);assert.equal(cuda.group_add,undefined);
  assert.equal(cuda.build.dockerfile,'docker/whisper.cuda.Dockerfile');
  assert.deepEqual(cuda.deploy.resources.reservations.devices,[{capabilities:['gpu'],device_ids:['0'],driver:'nvidia'}]);
  assert.equal(configs['compose.yml'].services.whisper.devices[0].source,'/dev/dri');
  assert.deepEqual(configs['compose.cpu.yml'].services.margin,configs['compose.nvidia.yml'].services.margin);
  for(const [suffix,backend] of [['','vulkan'],['.cpu','cpu'],['.nvidia','cuda']]){
    const result=spawnSync('docker',[...dockerArgs,'compose','--env-file','.env.example','-f','compose.prebuilt'+suffix+'.yml','config','--format','json'],{cwd:root,encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0);const prebuilt=JSON.parse(result.stdout).services;
    assert.equal(prebuilt.margin.build,undefined);assert.equal(prebuilt.whisper.build,undefined);
    assert.match(prebuilt.margin.image,/^ghcr\.io\/oscarsworldtech\/margin:v[0-9]+\.[0-9]+\.[0-9]+$/);
    assert.ok(prebuilt.whisper.image.endsWith('-'+backend));
    assert.deepEqual(prebuilt.margin.volumes,configs['compose.cpu.yml'].services.margin.volumes);
    assert.deepEqual(prebuilt.whisper.volumes,configs['compose.cpu.yml'].services.whisper.volumes);
  }
  for(const [kind,backend] of [['cpu','cpu'],['intel','vulkan'],['nvidia','cuda']]){
    const result=spawnSync('docker',[...dockerArgs,'compose','--env-file','.env.example','-f',`compose.aio.${kind}.yml`,'config','--format','json'],{cwd:root,encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
    const {services}=JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(services),['margin']);
    const app=services.margin;
    assert.ok(app.image.endsWith(`:preview-aio-${backend}`));
    assert.deepEqual(app.volumes.map(v=>[v.source,v.target]),[['margin-data','/data'],['whisper-models','/models']]);
    assert.equal(app.ports.length,1);assert.equal(app.ports[0].target,8787);
    assert.equal(app.environment.WHISPER_URL,undefined,'the built-in worker address is managed by the image');
    assert.equal(app.build,undefined);
    if(kind==='cpu'){assert.equal(app.devices,undefined);assert.equal(app.deploy,undefined);}
    if(kind==='intel')assert.equal(app.devices[0].source,'/dev/dri');
    if(kind==='nvidia')assert.deepEqual(app.deploy.resources.reservations.devices,[{capabilities:['gpu'],device_ids:['0'],driver:'nvidia'}]);
  }
});

test('setup preserves literal credentials, persists hardware choice, and rejects invalid modes without changes',async t=>{
  if(process.platform==='win32'&&!existsSync(bash)){t.skip('Git Bash is not installed.');return;}
  const folder=await mkdtemp(path.join(tmpdir(),'margin-setup-test-'));
  t.after(async()=>{if(!path.resolve(folder).startsWith(path.resolve(tmpdir())+path.sep+'margin-setup-test-'))throw Error('Unexpected test directory');await rm(folder,{recursive:true,force:true});});
  await copyFile(path.join(root,'setup.sh'),path.join(folder,'setup.sh'));
  await copyFile(path.join(root,'.env.example'),path.join(folder,'.env.example'));
  for(const file of ['compose.prebuilt.nvidia.yml','compose.prebuilt.cpu.yml'])await copyFile(path.join(root,file),path.join(folder,file));
  const credentials="ABS_TOKEN='literal-$value-$(touch unexpected)-token'\nMARGIN_PASSWORD='a long password with # and spaces'\n# keep my comment\n";
  await writeFile(path.join(folder,'.env'),credentials+'COMPOSE_FILE=compose.yml\nRENDER_GID=109\n');
  const run=mode=>spawnSync(bash,['setup.sh',mode],{cwd:folder,encoding:'utf8',windowsHide:true});
  assert.equal(run('nvidia').status,0);
  let env=await readFile(path.join(folder,'.env'),'utf8');
  assert.ok(env.startsWith(credentials));assert.match(env,/COMPOSE_FILE=compose.prebuilt.nvidia.yml/);assert.match(env,/RENDER_GID=109/);
  assert.equal(existsSync(path.join(folder,'unexpected')),false,'dotenv must never be executed as shell code');
  assert.equal(run('cpu').status,0);env=await readFile(path.join(folder,'.env'),'utf8');
  assert.ok(env.startsWith(credentials));assert.match(env,/COMPOSE_FILE=compose.prebuilt.cpu.yml/);
  assert.notEqual(run('unknown').status,0);assert.equal(await readFile(path.join(folder,'.env'),'utf8'),env);
  await rm(path.join(folder,'compose.prebuilt.nvidia.yml'));
  const incomplete=run('nvidia');assert.notEqual(incomplete.status,0);assert.match(incomplete.stdout,/Missing compose/);
  assert.equal(await readFile(path.join(folder,'.env'),'utf8'),env,'missing files must not change a working configuration');
});
