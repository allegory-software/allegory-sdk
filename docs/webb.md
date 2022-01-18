
## Introduction

Webb is a procedural web framework that works on top of [http_server](http_server.md).

## Features

* filesystem decoupling with virtual files and actions
* action-based routing with multi-language URLs
* http error responses via exceptions
* file serving with cache control
* output buffering stack
* rendering with mustache templates, php-like templates and Lua scripts
* multi-langage html with server-side language filtering
* online js and css bundling and minification
* email sending with popular email sending providers
* standalone operation without a web server for debugging and offline scripts
* SQL query module with implicit connection pool
* SPA module with client-side action-based routing

## Hello World

```lua
local webb = require'webb'

TODO

```

## Implementation notes

Webb has a single entry point for serving requests so it can be made to work
with other HTTP servers like nginx or OpenResty if wanted.
