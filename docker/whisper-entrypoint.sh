#!/bin/sh
set -eu
: "${WHISPER_MODEL:=small.en}"
: "${WHISPER_THREADS:=4}"
case "$WHISPER_THREADS" in *[!0-9]*|'') echo 'WHISPER_THREADS must be a positive integer'; exit 1;; esac
if [ "$WHISPER_THREADS" -lt 1 ] || [ "$WHISPER_THREADS" -gt 256 ]; then echo 'WHISPER_THREADS must be between 1 and 256'; exit 1; fi
case "$WHISPER_MODEL" in *[!a-zA-Z0-9._-]*|'') echo 'Invalid model name'; exit 1;; esac
model="/models/ggml-$WHISPER_MODEL.bin"
if [ ! -s "$model" ]; then
  echo "Downloading $WHISPER_MODEL from the whisper.cpp model repository (first start only)."
  curl --fail --location --connect-timeout 30 --retry 3 "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$WHISPER_MODEL.bin" -o "$model.part"
  mv "$model.part" "$model"
fi
echo "Starting Whisper: configured backend=${WHISPER_BACKEND:-vulkan}, model=$WHISPER_MODEL, CPU threads=$WHISPER_THREADS. Verify the selected device in the following engine logs."
set -- --host 0.0.0.0 --port 8080 --model "$model" --language "${WHISPER_LANGUAGE:-en}" --threads "$WHISPER_THREADS" --no-flash-attn
if [ "${WHISPER_BACKEND:-vulkan}" = cpu ]; then set -- "$@" --no-gpu; fi
exec whisper-server "$@"
