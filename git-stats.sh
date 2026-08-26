#!/usr/bin/env bash

set -e
set -f
set -o pipefail

months_back=
repo=.
if [[ $# -gt 0 ]]; then
	if [[ $1 == 0 ]]; then
		printf "%s\n" "months_back must be positive" >&2
		exit 2
	elif [[ $1 =~ ^[1-9][0-9]*$ ]]; then
		months_back=$1
		repo=${2:-.}
	else
		repo=$1
	fi
fi

repo_root=$(git -C "$repo" rev-parse --show-toplevel)
current_month=$(date +%Y-%m-01)
month_end=$(date -d "$current_month +1 month" +%Y-%m-01)
if [[ $months_back ]]; then
	month_start=$(date -d "$current_month -$((months_back - 1)) months" \
		+%Y-%m-01)
else
	month_start=$(git -C "$repo_root" log \
		--format=%cd --date=format:%Y-%m-01 | tail -n 1)
fi
if [[ ! $month_start ]]; then
	printf "%s\n" "repository has no commits" >&2
	exit 1
fi

month_value=$month_start
month_list=
month_count=0
while [[ $month_value < $month_end ]]; do
	month_list+="${month_value:0:7} "
	month_value=$(date -d "$month_value +1 month" +%Y-%m-01)
	((month_count += 1))
done

printf "%-7s %8s %5s %14s\n" \
	"month" "commits" "days" "lines_changed"

git -C "$repo_root" log \
	--since="$month_start" \
	--before="$month_end" \
	--numstat \
	--format="commit %cd" \
	--date=format:%Y-%m-%d |
	awk -v month_list="$month_list" -v month_count="$month_count" '
	BEGIN {
		split(month_list, month_values, " ")
	}

	$1 == "commit" {
		commit_day = $2
		commit_month = substr(commit_day, 1, 7)
		commits[commit_month]++
		days[commit_month, commit_day] = 1
	}

	$1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {
		lines_changed[commit_month] += ($1 > $2 ? $1 : $2)
	}

	END {
		for (month_index = 1; month_index <= month_count; month_index++) {
			month_value = month_values[month_index]
			day_count = 0
			for (day_key in days) {
				split(day_key, day_values, SUBSEP)
				if (day_values[1] == month_value) {
					day_count++
				}
			}
			printf "%s %8d %5d %14d\n", month_value, \
				commits[month_value], day_count, \
				lines_changed[month_value]
		}
	}
'
