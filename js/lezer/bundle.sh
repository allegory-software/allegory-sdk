#!/bin/sh
set -e

npx esbuild main.js --bundle --outfile=../../www/lezer.js --format=iife
sed -i 's/[[:space:]]*$//' ../../www/lezer.js
