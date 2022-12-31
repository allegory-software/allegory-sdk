#go@ sh *
V1=$(git tag --sort=-committerdate | head -1)
V0=$(git tag --sort=-committerdate | head -2 | awk '{split($0, tags, "\n")} END {print tags[1]}')
CHANGES=$(git log --pretty="- %s" $V1...$V0 | grep -v unimportant)
printf "
## Changes

$CHANGES

_Total commits: $(echo "$CHANGES" | wc -l)_
"
