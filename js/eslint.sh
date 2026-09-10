#!/bin/sh
set -e

cd "$(dirname "$0")/.."
exec eslint --config js/eslint.config.js --no-warn-ignored www/*.js
