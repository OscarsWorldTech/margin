ARG CUDA_VERSION=12.8.1
FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu24.04 AS build
ARG WHISPER_VERSION=v1.8.2
ARG BUILD_JOBS=2
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates cmake g++ ninja-build && rm -rf /var/lib/apt/lists/*
RUN git clone --branch ${WHISPER_VERSION} --depth 1 https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
# GGML_NATIVE=OFF selects upstream's portable CUDA targets; a build-time GPU is not needed.
RUN cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DGGML_CUDA=ON -DGGML_NATIVE=OFF -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF && cmake --build build --target whisper-server -j${BUILD_JOBS}

FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu24.04
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 ca-certificates curl && rm -rf /var/lib/apt/lists/* && mkdir /models && chown 1000:1000 /models
COPY --from=build /src/build/bin/whisper-server /usr/local/bin/whisper-server
COPY --from=build /src/LICENSE /usr/share/doc/whisper.cpp/LICENSE
COPY docker/whisper-entrypoint.sh /usr/local/bin/start-whisper
RUN sed -i 's/\r$//' /usr/local/bin/start-whisper && chmod 755 /usr/local/bin/start-whisper
USER 1000:1000
ENV WHISPER_MODEL=small.en WHISPER_BACKEND=cuda NVIDIA_DRIVER_CAPABILITIES=compute,utility
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/start-whisper"]
