#!/bin/bash
set -e

cd "$(dirname "$0")/.."

awk '{
	printf "ui.icon_def(\"%s%s\", \"%s\", \"\\u{%s}\")\n",
		$1, FILENAME ~ /-filled\.txt$/ ? "-filled" : "",
		FILENAME ~ /-filled\.txt$/ ? "tabler_filled" : "tabler",
		substr($2, 3)
}' www/icons/tabler-icons.txt www/icons/tabler-icons-filled.txt \
	> www/ui_icon_defs.js
