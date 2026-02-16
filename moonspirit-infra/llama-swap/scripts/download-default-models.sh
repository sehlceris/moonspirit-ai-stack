#!/usr/bin/env bash
set -euo pipefail

# Download all default models. Skips models that already exist.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODELS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/models"
DOWNLOAD="$SCRIPT_DIR/download-model.sh"

download_if_missing() {
    local dir="$1" repo="$2"
    shift 2
    if [ -d "$MODELS_DIR/$dir" ] && ls "$MODELS_DIR/$dir"/*.gguf &>/dev/null; then
        echo "==> SKIP: $dir (already exists)"
    else
        echo "==> DOWNLOADING: $dir"
        "$DOWNLOAD" "$repo" "$@"
    fi
    echo ""
}

echo "=== Downloading default models ==="
echo ""

# Embeddings — nomic-embed-text-v1.5 (f16, ~274 MB)
download_if_missing \
    "nomic-embed-text-v1.5-GGUF" \
    "nomic-ai/nomic-embed-text-v1.5-GGUF" \
    --include "nomic-embed-text-v1.5.f16.gguf"

# GLM-4.7-Flash — 30B MoE, 3B active (UD-Q4_K_XL, ~17.5 GB)
download_if_missing \
    "GLM-4.7-Flash-GGUF" \
    "unsloth/GLM-4.7-Flash-GGUF" \
    --include "GLM-4.7-Flash-UD-Q4_K_XL.gguf"

# gpt-oss-120b — 117B MoE, 5.1B active (MXFP4, ~63 GB)
download_if_missing \
    "gpt-oss-120b-GGUF" \
    "ggml-org/gpt-oss-120b-GGUF"

# Qwen3-Coder-Next — 80B MoE, 3B active (Q4_K_M, ~48.5 GB)
download_if_missing \
    "Qwen3-Coder-Next-GGUF" \
    "Qwen/Qwen3-Coder-Next-GGUF" \
    --include "Qwen3-Coder-Next-Q4_K_M/*"

echo "=== Done ==="
