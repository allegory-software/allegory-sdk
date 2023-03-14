
# Allegory SDK Widgets

Model-driven web components in pure JavaScript.

This set of components is designed primarily for data-dense business-type
apps with a focus on data entry and data navigation.

These types of apps have higher information density, higher signal-to-noise
ratio, faster loading times and lower operational latencies than the usual
consumer-centric web-apps, and as such, tend to favor tabbed and split-pane
layouts over newspaper-type layouts, optimize for keyboard navigation,
and are generally designed for an office setting with a big screen, a chair,
a keyboard and a mouse ("keyboard & mouse"-first apps).

## Components

The highlight of the library is a canvas-drawn **grid widget** which can load,
scroll, sort and filter 100K items instantly on any modern computer or phone,
can act as a tree-grid or as a vertical grid, has inline editing, drag & drop
moving of columns and rows and many other features.

Accompanying that there's a **list widget** which is not canvas-drawn (so it
can't hold as many items as the grid efficiently), not out-of-the-box editable,
but the items can be custom-rendered to variable widths and heights and can
still have drag & drop moving, multiple selection, sorting, etc.

Next there's an assortment of single-value (aka scalar) **input widgets** to
use in forms. These can be tied to a navigation component (grid or listbox)
and they show and edit the data at whatever the focused row is on that component.

Lastly there's a bunch of **layouting widgets** geared towards split-screen-style
layouts, like tabs and split-views.

All navigation widgets as well as the single-value widgets are model-driven
The **navigation widget** (be it a grid, a list or a headless nav) holds
the data, and one or more value widgets are then bound to the nav widget so
changes made on a cell by one widget are reflected instantly in other widgets.
The nav widget then gathers the changes made to one or more rows/cells and
can push them to a server.

## Docs / Demo

Like usual, docs are in the code but there's also a [demo (master branch)]
(and [demo (dev branch)]).

[demo (master branch)]: https://raw.githack.com/allegory-software/allegory-sdk/master/tests/www/widgets-demo.html
[demo (dev branch)]:    https://raw.githack.com/allegory-software/allegory-sdk/dev/tests/www/widgets-demo.html

## Installation

There is no installation step and no offline preprocessing or packing tools
are used or necessary. Just make sure you load all the js and css files in
order like the demo does.

## Styling

Even though they're web components, the widgets don't use shadow DOMs so
both their sub-elements and their styling are overridable.

## Security

Strings are never rendered directly as HTML to avoid accidentally creating
XSS holes. For formatting rich text safely, use templates. Mustache is a good
option for this and it also has a server-side implementation.

## The code

The code is organized as distinct functional layers that build on each other,
so you can learn and use as much or as little of the pyramid of abstraction
as you want and need. Unlike most frameworks, you can start from the bottom
and you can stop whenever you want.

### Layer 1: Standard library

`glue.js` is an extension of the JS standard library. Publishes everything
directly as globals and extends the prototypes of built-in types.

This layer doesn't provide anything UI-related, it just beefs-up and sugar-coats
the standard library, excluding anything DOM-related.

### Layer 2: DOM API & web components

`dom.js` provides a DOM manipulation API and a mechanism for making web
components. Extends the built-in DOM prototypes with new properties and methods.
Uses `purify.js` for HTML sanitizing.

This layer provides everything needed to manipulate the DOM as well as to make
custom components with lifetime management, properties, deferred updating,
events, etc. It also contains the composable CSS API (but no actual styles)
and provides utilities for making popups, modals, disabled elements,
focusable elements, resizeable canvases, easing animation, etc.

This layer doesn't implement any actual widgets except a few very basic ones
like `<if>`.

### Layer 3: Functional CSS library

`css.js` is a small functional CSS library that widgets are styled with.
It has a dark mode (and you can invert the mode on any inside div),
and 3 size variations.

### Layer 4: Widgets

`widgets.js` contains all non-data-driven widgets, including layout widgets,
input widgets, aux widgets like tooltips and notifications and everything
in between. Uses `mustache.js` for html templating (optional).
The `md` component uses `markdown-it.js` for parsing Markdown (optional).

### Layer 5: Data-driven widgets

`nav.js`, `grid.js`, `charts.js` comprise the "other half" of the library,
containing a data-driven grid, charts and input widgets.

### Layer 2a: Component state persistence

`module.js` is an optional module that provides persistence for component
properties into multiple property layers, eg. user properties like grid column
widths are stored in the "user" prop layer which is different for each logged-in user,
allowing each user to customize the grids in the application only for themselves.
Another example is properties that can be translated into multiple languages.
Those are stored in the "lang" prop layer which changes based on the current language,
making the application multi-language. Property layers are stored on the server in
json files, but you can also have layers stored on the client.

Persistence only works on components with an id, since it's all id-based.

## The dev-run cycle

Working on widgets is easier with a framework that doesn't have a build
step and you don't even need a web server to run it. All you need is a code
editor and a browser. Open `widgets-demo.html` in the browser. Open `glue.js`,
`dom.js`, `css.js`, `widgets.js`, `widgets-demo.html` in the editor.
Edit, save, swith-to-browser, refresh.

To make a new widget, add a new js file for your widget code, and a new demo
section in the demos file for showcasing your widget. Your demo will appear
in the nav bar automatically and refreshing the browser will keep context.

So much for the dev-run cycle. Now you just need to know how to write
a good quality web component. To be continued...
