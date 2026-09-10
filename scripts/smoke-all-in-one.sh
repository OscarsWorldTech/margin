#!/bin/sh
set -eu
: "${IMAGE:?Set IMAGE}" "${BACKEND:?Set BACKEND}"

if [ "$BACKEND" != cpu ]; then
  docker run --rm --entrypoint sh "$IMAGE" -c 'node --version && ffmpeg -version >/dev/null && ldd /usr/local/bin/whisper-server > /tmp/deps && cat /tmp/deps && ! grep "not found" /tmp/deps | grep -v "libcuda.so.1"'
  echo 'GPU image libraries checked; inference requires a real GPU host.'
  exit 0
fi

# These uniquely named test volumes are disposable and contain only sample data.
data="margin-aio-smoke-data-$$"
models="margin-aio-smoke-models-$$"
cleanup(){ docker logs margin-aio-smoke 2>/dev/null || true; docker rm -f margin-aio-smoke 2>/dev/null || true; docker volume rm "$data" "$models" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker volume create "$data" >/dev/null
docker volume create "$models" >/dev/null
start(){ docker run -d --name margin-aio-smoke -e DEMO_MODE=true -e WHISPER_MODEL=tiny.en -v "$data:/data" -v "$models:/models" -p 127.0.0.1:18787:8787 "$IMAGE"; }
ready(){
  for attempt in $(seq 1 120); do
    if docker exec margin-aio-smoke node /app/docker/all-in-one-health.mjs; then return; fi
    if [ "$(docker inspect --format '{{.State.Running}}' margin-aio-smoke)" != true ]; then return 1; fi
    sleep 5
  done
  return 1
}
start
ready
curl --fail --silent http://127.0.0.1:18787/ >/dev/null
docker exec margin-aio-smoke node --input-type=module -e 'import fs from "node:fs"; const f=new FormData(); f.set("file",new Blob([fs.readFileSync("/app/public/demo.wav")]),"sample.wav"); f.set("response_format","verbose_json"); const r=await fetch("http://127.0.0.1:8080/inference",{method:"POST",body:f,signal:AbortSignal.timeout(300000)}); if(!r.ok)throw Error("Inference failed"); const data=await r.json(); if(!data.segments?.length&&!data.transcription?.length)throw Error("No captions"); console.log("Real CPU inference passed");'
curl --fail --silent http://127.0.0.1:18787/api/books/demo/notes -H 'Content-Type: application/json' --data '{"start":0,"end":3,"quote":"A sample passage","note":"Container recreation check","color":"green"}' >/dev/null
# Neither service should expose the unauthenticated worker outside loopback.
docker exec margin-aio-smoke node --input-type=module -e 'import os from "node:os";const ip=Object.values(os.networkInterfaces()).flat().find(a=>a.family==="IPv4"&&!a.internal)?.address;if(!ip)throw Error("No container interface");let accessible=false;try{await fetch(`http://${ip}:8080/health`,{signal:AbortSignal.timeout(2000)});accessible=true;}catch{}if(accessible)throw Error("Whisper is exposed on the container network");'
docker stop --time 15 margin-aio-smoke >/dev/null
test "$(docker inspect --format '{{.State.ExitCode}}' margin-aio-smoke)" = 0
docker rm margin-aio-smoke >/dev/null
start
ready
curl --fail --silent http://127.0.0.1:18787/api/books/demo | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(JSON.parse(s).notes[0]?.note!=="Container recreation check")process.exit(1);});'
# A dead worker must terminate the container rather than leave a healthy-looking UI.
docker exec margin-aio-smoke node --input-type=module -e 'import fs from "node:fs";let found=false;for(const pid of fs.readdirSync("/proc").filter(p=>/^\d+$/.test(p))){try{if(fs.readFileSync(`/proc/${pid}/comm`,"utf8").trim()==="whisper-server"){process.kill(Number(pid),"SIGKILL");found=true;}}catch{}}if(!found)throw Error("Worker process not found");'
for attempt in $(seq 1 20); do
  if [ "$(docker inspect --format '{{.State.Running}}' margin-aio-smoke)" = false ]; then break; fi
  sleep 1
done
test "$(docker inspect --format '{{.State.Running}}' margin-aio-smoke)" = false
test "$(docker inspect --format '{{.State.ExitCode}}' margin-aio-smoke)" != 0
echo 'All-in-one inference, isolation, persistence, shutdown and worker-failure checks passed.'
