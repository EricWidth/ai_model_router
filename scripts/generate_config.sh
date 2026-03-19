#!/usr/bin/env bash
set -euo pipefail

# Required fields (edit these three)
ACCESS_API_KEY="<YOUR_ACCESS_API_KEY>"
ALIYUN_API_KEY="<YOUR_ALIYUN_API_KEY>"
BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"

# Optional fields
ADMIN_API_KEY=""
QUOTA=""
PORT="8080"
HOST="127.0.0.1"
PUBLIC_MODEL_NAME="custom-model"
MAX_RETRIES="3"
COOLDOWN_MS="60000"
HEALTH_CHECK_INTERVAL_MS="300000"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEXT_MODELS_FILE="${SCRIPT_DIR}/text_model.txt"
IMAGE_MODELS_FILE="${SCRIPT_DIR}/image_model.txt"
VOICE_MODELS_FILE="${SCRIPT_DIR}/voice_model.txt"
OUTPUT_PATH="${1:-/opt/amr-config.yaml}"

require_non_placeholder() {
  local name="$1"
  local value="$2"
  if [[ -z "${value}" || "${value}" == "<"*">" ]]; then
    echo "[ERROR] ${name} is required. Please edit scripts/generate_config.sh" >&2
    exit 1
  fi
}

yaml_quote() {
  local s="$1"
  s="${s//\'/\'\'}"
  printf "'%s'" "${s}"
}

parse_models() {
  local file="$1"
  if [[ ! -f "${file}" ]]; then
    return 0
  fi

  sed 's/#.*$//' "${file}" \
    | tr ',\r' '\n\n' \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' \
    | awk 'NF && !seen[$0]++'
}

emit_models_block() {
  local type="$1"
  local file="$2"
  local include_max_tokens="$3"
  local idx=1
  local has_any=0

  echo "  ${type}:"
  while IFS= read -r model; do
    [[ -z "${model}" ]] && continue
    has_any=1
    echo "    - name: $(yaml_quote "${model}")"
    echo "      provider: aliyun"
    echo "      apiKey: $(yaml_quote "${ALIYUN_API_KEY}")"
    echo "      baseUrl: $(yaml_quote "${BASE_URL}")"
    if [[ "${include_max_tokens}" == "yes" ]]; then
      echo "      maxTokens: 8192"
    fi
    echo "      priority: ${idx}"
    if [[ -n "${QUOTA}" ]]; then
      echo "      quota: ${QUOTA}"
    fi
    idx=$((idx + 1))
  done < <(parse_models "${file}")

  if [[ "${has_any}" -eq 0 ]]; then
    echo "    []"
  fi
}

require_non_placeholder "ACCESS_API_KEY" "${ACCESS_API_KEY}"
require_non_placeholder "ALIYUN_API_KEY" "${ALIYUN_API_KEY}"
require_non_placeholder "BASE_URL" "${BASE_URL}"

TMP_FILE="$(mktemp)"
trap 'rm -f "${TMP_FILE}"' EXIT

{
  echo "server:"
  echo "  port: ${PORT}"
  echo "  host: $(yaml_quote "${HOST}")"
  echo "  cors: true"
  echo "  accessApiKey: $(yaml_quote "${ACCESS_API_KEY}")"
  if [[ -n "${ADMIN_API_KEY}" ]]; then
    echo "  adminApiKey: $(yaml_quote "${ADMIN_API_KEY}")"
  fi
  echo "  publicModelName: $(yaml_quote "${PUBLIC_MODEL_NAME}")"
  echo "models:"
  emit_models_block "text" "${TEXT_MODELS_FILE}" "yes"
  emit_models_block "voice" "${VOICE_MODELS_FILE}" "no"
  emit_models_block "image" "${IMAGE_MODELS_FILE}" "no"
  echo "switch:"
  echo "  maxRetries: ${MAX_RETRIES}"
  echo "  cooldown: ${COOLDOWN_MS}"
  echo "  healthCheckInterval: ${HEALTH_CHECK_INTERVAL_MS}"
} > "${TMP_FILE}"

mv "${TMP_FILE}" "${OUTPUT_PATH}"
echo "[OK] Generated config: ${OUTPUT_PATH}"
