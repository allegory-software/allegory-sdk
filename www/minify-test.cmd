@echo off

du -shc *.js
echo.

cat *.js | gzip - > all.js.gz
du -sh all.js.gz
echo.

cat *.js | jsmin | gzip - > all.min.js.gz
du -sh all.min.js.gz
echo.

wc -l *.js
echo.

rm all.js.gz
rm all.min.js.gz
