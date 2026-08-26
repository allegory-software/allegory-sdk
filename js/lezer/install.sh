#!/bin/sh
set -e

npm ci

git clone git@github.com:R167/lezer-lua.git
git -C lezer-lua checkout da532ead0683c0f4039f4e4303d61705036a7aaa
npx lezer-generator lezer-lua/src/lua.grammar -o lezer-lua/lua-parser.js
