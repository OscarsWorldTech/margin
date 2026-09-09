#!/bin/sh
# Read-only diagnostics; configuration secrets are never printed.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
command -v docker >/dev/null 2>&1 || { echo 'Docker is not installed or is not in PATH.'; exit 1; }
docker compose version
docker info >/dev/null 2>&1 || { echo 'Docker is not reachable. Start Docker or check access to its socket.'; exit 1; }
if ! docker compose config --quiet >/dev/null 2>&1; then echo 'Compose configuration is invalid. Check the required .env values and run setup.sh for your hardware.'; exit 1; fi
echo 'Compose configuration is valid.'
docker compose ps
if ! docker compose exec -T margin node -e "fetch('http://127.0.0.1:8787/api/status').then(r=>r.json()).then(s=>{console.log('Margin version: '+s.version+'; Audiobookshelf configured: '+s.configured);if(!s.configured)process.exit(1)}).catch(()=>process.exit(1))"; then
  echo 'Margin is not ready. Check: docker compose logs --tail=50 margin'; exit 1
fi
if ! docker compose exec -T whisper sh -c '
  echo "Configured transcription backend: ${WHISPER_BACKEND:-vulkan}"
  case "${WHISPER_BACKEND:-vulkan}" in
    cuda) nvidia-smi -L || exit 1 ;;
    vulkan) vulkaninfo --summary 2>/dev/null || exit 1 ;;
  esac
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8080/health >/dev/null
'; then
  echo 'Whisper is not ready or its device is unavailable. First-time model downloads can take several minutes.'
  echo 'Check: docker compose logs --tail=80 whisper'; exit 1
fi
echo 'Both services are reachable. Device visibility and health do not prove GPU inference.'
echo 'Transcribe a short recording and check GPU activity and the Whisper device-selection logs.'
