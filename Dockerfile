# dh-studio team server — API ONLY.
# The web UI lives in Dockerfile.web (nginx) and proxies /v1 here.
#
# Build:  docker build -t dh-studio-server .
# Run:    docker run -p 8080:8080 -v dh-data:/data \
#           -e DH_DATABASE_URL=postgres://user:pass@host:5432/db \
#           -e GOOGLE_CLIENT_ID=... -e GOOGLE_CLIENT_SECRET=... \
#           dh-studio-server
#
# DH_DATABASE_URL (a real Postgres instance — there is no bundled-SQLite
# fallback) is required; the container panics at startup without it. At
# least one OAuth provider's client id/secret is required for anyone to be
# able to sign in. See crates/dh-server/src/main.rs for the full env var
# reference, or docker-compose.yml for a ready-to-run example with a bundled
# Postgres service.

# ---- build stage -----------------------------------------------------------
FROM rust:1-slim AS build
WORKDIR /src

# Dependency layer: cache crates between builds. src-tauri is a workspace
# member, so its manifest must be present even though we only build dh-server.
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY src-tauri ./src-tauri

RUN cargo build --release -p dh-server

# ---- runtime stage ---------------------------------------------------------
FROM debian:bookworm-slim

RUN useradd -r -m -u 1000 dh && mkdir -p /data && chown dh:dh /data

COPY --from=build /src/target/release/dh-server /usr/local/bin/dh-server

ENV DH_BIND=0.0.0.0:8080 \
    DH_DATA_DIR=/data

USER dh
EXPOSE 8080
VOLUME ["/data"]

ENTRYPOINT ["dh-server"]
