FROM ubuntu:24.04 AS build
ARG WHISPER_VERSION=v1.8.2
ARG BUILD_JOBS=2
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates cmake g++ ninja-build && rm -rf /var/lib/apt/lists/*
RUN git clone --branch ${WHISPER_VERSION} --depth 1 https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
# Conservative x86 baseline also works when a VM hides AVX features. ARM uses its own backend.
RUN cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DGGML_CUDA=OFF -DGGML_VULKAN=OFF -DGGML_AVX=OFF -DGGML_AVX2=OFF -DGGML_BMI2=OFF -DGGML_FMA=OFF -DGGML_F16C=OFF -DGGML_AVX512=OFF -DGGML_SSE42=OFF -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF && cmake --build build --target whisper-server -j${BUILD_JOBS}
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 ca-certificates curl && rm -rf /var/lib/apt/lists/* && mkdir /models && chown 1000:1000 /models
COPY --from=build /src/build/bin/whisper-server /usr/local/bin/whisper-server
COPY --from=build /src/LICENSE /usr/share/doc/whisper.cpp/LICENSE
COPY docker/whisper-entrypoint.sh /usr/local/bin/start-whisper
RUN sed -i 's/\r$//' /usr/local/bin/start-whisper && chmod 755 /usr/local/bin/start-whisper
USER 1000:1000
ENV WHISPER_MODEL=small.en WHISPER_BACKEND=cpu
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/start-whisper"]
