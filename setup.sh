#!/bin/sh
# Configure the backend only. Never executes .env or installs host drivers.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
mode=${1:-}
if [ -z "$mode" ]; then
  printf 'Hardware: cpu (no GPU), intel, amd, or nvidia [cpu]: '
  read -r mode || mode=cpu
  mode=${mode:-cpu}
fi
render_gid=
case "$mode" in
  cpu) compose_file=compose.cpu.yml ;;
  nvidia) compose_file=compose.nvidia.yml ;;
  intel|amd)
    compose_file=compose.yml
    render_node=${2:-/dev/dri/renderD128}
    case "$render_node" in /dev/dri/renderD*) ;; *) echo 'Use a render node such as /dev/dri/renderD128.'; exit 1;; esac
    if [ ! -c "$render_node" ]; then echo "No render device at $render_node. Pass the correct node as the second argument, or use cpu mode."; exit 1; fi
    render_gid=$(stat -c '%g' "$render_node")
    case "$render_gid" in *[!0-9]*|'') echo 'Could not read render-device group ID.'; exit 1;; esac
    ;;
  *) echo 'Usage: sh setup.sh [cpu|intel|amd|nvidia] [/dev/dri/renderD128]'; exit 1 ;;
esac
install_mode=${MARGIN_INSTALL_MODE:-prebuilt}
case "$install_mode" in
  prebuilt)
    case "$mode" in
      cpu) compose_file=compose.prebuilt.cpu.yml ;;
      nvidia) compose_file=compose.prebuilt.nvidia.yml ;;
      intel|amd) compose_file=compose.prebuilt.yml ;;
    esac
    ;;
  source) ;;
  *) echo 'MARGIN_INSTALL_MODE must be prebuilt or source'; exit 1 ;;
esac
if [ ! -f "$compose_file" ]; then
  echo "Missing $compose_file. Extract the complete installation bundle, or use the full repository for source builds."
  exit 1
fi
if [ -L .env ]; then echo 'The .env file is a symlink. Edit COMPOSE_FILE manually instead.'; exit 1; fi
umask 077
if [ ! -e .env ]; then cp .env.example .env; fi
temp_file=$(mktemp .margin-env.XXXXXX)
trap 'rm -f -- "$temp_file"' EXIT HUP INT TERM
awk -v compose="$compose_file" -v gid="$render_gid" '
  { sub(/\r$/, "") }
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_FILE[[:space:]]*=/ { if (!seen++) print "COMPOSE_FILE=" compose; next }
  /^[[:space:]]*(export[[:space:]]+)?RENDER_GID[[:space:]]*=/ { if (gid != "") { if (!group_seen++) print "RENDER_GID=" gid; next } }
  { print }
  END { if (!seen) print "COMPOSE_FILE=" compose; if (gid != "" && !group_seen) print "RENDER_GID=" gid }
' .env > "$temp_file"
mv -- "$temp_file" .env
printf 'Selected %s using %s. Existing credentials were retained.\n' "$mode" "$compose_file"
if [ "$mode" = nvidia ]; then echo 'Before starting, install the NVIDIA driver and NVIDIA Container Toolkit on the Docker host. See docs/HARDWARE.md.'; fi
if [ "$mode" = amd ]; then echo 'AMD uses the Vulkan configuration and has not yet been hardware-tested.'; fi
echo 'Edit ABS_URL, ABS_TOKEN, MARGIN_PASSWORD, and BIND_ADDRESS in .env as needed.'
if [ "$install_mode" = prebuilt ]; then echo 'Then run: docker compose pull && docker compose up -d'; else echo 'Then run: docker compose up -d --build'; fi
echo 'Check the result with: sh doctor.sh'
