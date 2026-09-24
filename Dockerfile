# dh-studio proxy server: no accounts, no database of its own.
# The web UI lives in Dockerfile.web (nginx) and proxies /v1 here.
#
# Build:  docker build -t dh-studio-server .
# Run:    docker run -p 8080:8080 -e DH_ACCESS_KEY=choose-a-long-secret dh-studio-server
#
# Every setting is optional; see crates/dh-server/src/main.rs. The image
# listens on every interface, so set DH_ACCESS_KEY (or keep it on a private
# network): the server connects to any database it can reach.

# ---- build stage -----------------------------------------------------------
# Same Debian release as the runtime stage below: the binary links the build
# stage's glibc, so a newer build image (`rust:1-slim` now tracks trixie)
# fails to start on bookworm with "GLIBC_2.xx not found".
FROM rust:1-slim-bookworm AS build
WORKDIR /src

# Dependency layer: cache crates between builds. src-tauri is a workspace
# member, so its manifest must be present even though we only build dh-server.
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY src-tauri ./src-tauri

RUN cargo build --release -p dh-server

# ---- runtime stage ---------------------------------------------------------
FROM debian:bookworm-slim

RUN useradd -r -m -u 1000 dh

COPY --from=build /src/target/release/dh-server /usr/local/bin/dh-server

ENV DH_BIND=0.0.0.0:8080

USER dh
EXPOSE 8080

ENTRYPOINT ["dh-server"]
