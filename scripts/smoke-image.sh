#!/bin/sh
set -eu
: "${IMAGE:?Set IMAGE}" "${COMPONENT:?Set COMPONENT}"
case "$COMPONENT" in
  app)
    docker run -d --name margin-smoke -e DEMO_MODE=true -p 127.0.0.1:18787:8787 "$IMAGE"
    trap 'docker logs margin-smoke; docker rm -f margin-smoke' EXIT
    for attempt in $(seq 1 30); do
      if curl --fail --silent http://127.0.0.1:18787/api/health >/dev/null; then break; fi
      sleep 2
    done
    curl --fail --silent http://127.0.0.1:18787/api/status > /tmp/margin-status.json
    node --input-type=module -e "import fs from 'node:fs';const s=JSON.parse(fs.readFileSync('/tmp/margin-status.json'));if('v'+s.version!==process.env.EXPECTED_VERSION||!s.demo)throw Error('Wrong app version');"
    curl --fail --silent http://127.0.0.1:18787/api/books/demo | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);if(!b.tracks?.length||!b.cues?.length)process.exit(1);});"
    ;;
  cpu)
    docker run -d --name margin-smoke -e WHISPER_MODEL=tiny.en -p 127.0.0.1:18080:8080 "$IMAGE"
    trap 'docker logs margin-smoke; docker rm -f margin-smoke' EXIT
    for attempt in $(seq 1 90); do
      if curl --fail --silent http://127.0.0.1:18080/health >/dev/null; then break; fi
      sleep 5
    done
    curl --fail --silent --show-error --max-time 300 http://127.0.0.1:18080/inference -F file=@public/demo.wav -F response_format=verbose_json > /tmp/margin-inference.json
    node --input-type=module -e "import fs from 'node:fs';const r=JSON.parse(fs.readFileSync('/tmp/margin-inference.json'));if(!r.segments?.length&&!r.transcription?.length)throw Error('No caption segments');"
    ;;
  vulkan|cuda)
    # CUDA's driver library is injected by NVIDIA Container Toolkit on the user's host.
    docker run --rm --entrypoint sh "$IMAGE" -c 'ldd /usr/local/bin/whisper-server > /tmp/deps; cat /tmp/deps; if grep "not found" /tmp/deps | grep -v "libcuda.so.1"; then exit 1; fi'
    echo 'GPU runtime/inference is not tested on this CPU runner.'
    ;;
  *) echo 'Unknown component'; exit 1 ;;
esac
