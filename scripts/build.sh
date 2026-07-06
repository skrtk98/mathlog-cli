#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
INPUT_PATTERN="${1:-${DOCS_DIR}/decks/*.md}"
OUTPUT_TARGET="${2:-}"

if [[ -z "${MATHLOG_PREVIEW_CHROME_PATH:-}" ]]; then
  mapfile -t chrome_candidates < <(
    find "${DOCS_DIR}/.local-browsers" \
      -path '*/chrome-headless-shell-linux64/chrome-headless-shell' \
      -type f \
      | sort -V
  )

  if [[ ${#chrome_candidates[@]} -eq 0 ]]; then
    echo "[build] chrome-headless-shell not found under ${DOCS_DIR}/.local-browsers" >&2
    echo "[build] set MATHLOG_PREVIEW_CHROME_PATH explicitly or install it with:" >&2
    echo "[build]   npx @puppeteer/browsers install chrome-headless-shell@stable --path ./.local-browsers" >&2
    exit 1
  fi

  MATHLOG_PREVIEW_CHROME_PATH="${chrome_candidates[-1]}"
fi

export MATHLOG_PREVIEW_CHROME_PATH

shopt -s nullglob
md_files=( ${INPUT_PATTERN} )
shopt -u nullglob

if [[ ${#md_files[@]} -eq 0 ]]; then
  echo "[build] no markdown files matched: ${INPUT_PATTERN}" >&2
  exit 1
fi

output_mode=""
if [[ -n "${OUTPUT_TARGET}" ]]; then
  if [[ "${OUTPUT_TARGET}" == *.pdf ]]; then
    output_mode="file"
    mkdir -p "$(dirname "${OUTPUT_TARGET}")"
  else
    output_mode="dir"
    mkdir -p "${OUTPUT_TARGET}"
  fi
fi

processed_count=0

for md_file in "${md_files[@]}"; do
  if [[ ! -f "${md_file}" || "${md_file##*.}" != "md" ]]; then
    continue
  fi

  processed_count=$((processed_count + 1))

  if [[ -n "${OUTPUT_TARGET}" ]]; then
    if [[ "${output_mode}" == "file" ]]; then
      if [[ ${#md_files[@]} -ne 1 ]]; then
        echo "[build] a .pdf output path can only be used with a single markdown input" >&2
        exit 1
      fi
      output_file="${OUTPUT_TARGET}"
    else
      base_name="$(basename "${md_file}" .md)"
      output_file="${OUTPUT_TARGET%/}/${base_name}.pdf"
    fi
    echo "[build] rendering ${md_file}"
    node "${SCRIPT_DIR}/mathlog-preview.mjs" build "${md_file}" "${output_file}"
  else
    echo "[build] rendering ${md_file}"
    node "${SCRIPT_DIR}/mathlog-preview.mjs" build "${md_file}"
  fi
done

if [[ ${processed_count} -eq 0 ]]; then
  echo "[build] no markdown files matched: ${INPUT_PATTERN}" >&2
  exit 1
fi
