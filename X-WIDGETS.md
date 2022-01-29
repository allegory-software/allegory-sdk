
# X-Widgets

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

The highlight of the library is a **virtual grid widget** which can load,
scroll, sort and filter 100K items instantly on any modern computer or phone,
can act as a tree-grid or as a vertical grid, has inline editing, drag & drop
moving of columns and rows and many other features.

Accompanying that there's a **listbox widget** which is not virtual (so it
can't hold as many items as the grid efficiently), not out-of-the-box editable,
but the items can be custom-rendered to variable widths and heights and can
still have drag & drop moving, multiple selection, sorting, etc.

Next there's an assortment of single-value (aka scalar) **input widgets** to
use in forms. These are tied to a navigation component (grid or listbox) and
they show and edit the data at whatever the focused row is on that component.

Next there's an assortment of **layouting widgets** geared towards
split-screen-style layouts.

All navigation widgets as well as the single-value widgets are model-driven
The **navigation widget** (be it a grid, a listbox or a headless nav) holds
the data, and one or more value widgets are then bound to the nav widget so
changes made on a cell by one widget are reflected instantly in other widgets
(aka 2-way binding). The nav widget then gathers the changes made to one
or more rows/cells and can push them to a server (aka 3-way binding).

## Installation

There is no installation step and no offline preprocessing or packing tools
are used or necessary for the JavaScript libraries. Just make sure you
load them in order (see [xapp.lua](lua/xapp.lua) for that).

## Styling

Even though they're web components, the widgets don't use shadow DOMs so
both their sub-elements and their styling are overridable. All widgets
get the `.x-widget` class that can be used to set global styling for all
the widgets without disturbing the styles of non x-widget components.

## Security

Strings are never rendered directly as HTML to avoid accidentally creating
XSS holes. For formatting rich text safely, use templates. Mustache is a good
option for this and it also has a server-side implementation.

## Coding style

* `glue.js` is intended to be used as a standard library and as such it
publishes everything directly as globals.
* `divs.js` is intended to be used as the primary/only DOM manipulation API
and as such it extends built-in classes directly with new methods and
properties, instead of wrapping them.

