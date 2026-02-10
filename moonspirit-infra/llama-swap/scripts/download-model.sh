#!/usr/bin/env bash
set -euo pipefail

# Download a Hugging Face GGUF model to the local models directory.
#
# Usage:
#   ./scripts/download-model.sh <hf-repo> [--include <pattern>]
#
# Examples:
#   # Download the default gpt-oss-120b MXFP4 GGUF (recommended):
#   ./scripts/download-model.sh ggml-org/gpt-oss-120b-GGUF
#
#   # Download a specific quantization from bartowski:
#   ./scripts/download-model.sh bartowski/openai_gpt-oss-120b-GGUF --include "openai_gpt-oss-120b-Q4_K_M/*"
#
#   # Download any other GGUF model:
#   ./scripts/download-model.sh TheBloke/Mistral-7B-Instruct-v0.2-GGUF --include "*Q4_K_M.gguf"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODELS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/models"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <huggingface-repo> [--include <pattern>]"
    echo ""
    echo "Examples:"
    echo "  $0 ggml-org/gpt-oss-120b-GGUF"
    echo "  $0 bartowski/openai_gpt-oss-120b-GGUF --include 'openai_gpt-oss-120b-Q4_K_M/*'"
    exit 1
fi

HF_REPO="$1"
shift

# Derive a local directory name from the repo (e.g. "ggml-org/gpt-oss-120b-GGUF" -> "gpt-oss-120b-GGUF")
REPO_NAME="$(basename "$HF_REPO")"
LOCAL_DIR="$MODELS_DIR/$REPO_NAME"

# The Homebrew package "huggingface-cli" installs the binary as "hf".
HF_CMD=""
if command -v hf &>/dev/null; then
    HF_CMD="hf"
elif command -v huggingface-cli &>/dev/null; then
    HF_CMD="huggingface-cli"
else
    echo "Error: Neither 'hf' nor 'huggingface-cli' found."
    echo "Install with: brew install huggingface-cli"
    exit 1
fi

echo "==> Downloading $HF_REPO to $LOCAL_DIR"
echo "==> Extra args: $*"
echo ""

mkdir -p "$LOCAL_DIR"

# Build the download command
DOWNLOAD_ARGS=(
    download
    "$HF_REPO"
    --local-dir "$LOCAL_DIR"
)

# Append any extra arguments (e.g. --include patterns)
if [ $# -gt 0 ]; then
    DOWNLOAD_ARGS+=("$@")
fi

"$HF_CMD" "${DOWNLOAD_ARGS[@]}"

echo ""
echo "==> Download complete. Files in $LOCAL_DIR:"
ls -lh "$LOCAL_DIR"/*.gguf 2>/dev/null || echo "(no .gguf files found at top level — check subdirectories)"
echo ""
echo "==> Total size:"
du -sh "$LOCAL_DIR"
