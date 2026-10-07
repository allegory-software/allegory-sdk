#!/bin/sh
exec node "$(dirname -- "$0")/run_nav_bench.mjs" nav2 "$@"
