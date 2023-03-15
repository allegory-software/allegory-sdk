# How to make widgets for the web

Writing a good widget is hard on any platform. Writing one for the web is
even harder. Luckily we have enough rope in `dom.js` and `css.js` to do
a decent job. Let's see what that means first.

A good widget needs to satisfy many things:

* work in different types of containers: inline, block, flex, grid.
* be instantiable from both html and from JavaScript (more on that later).
* allow any property change while live.
* not leak event listeners when detached from DOM.
* work at any parent font size.
* use only theme colors.
* update itself when resized.
* fire events on state changes.
* be stylable by having semantic css classes on its inner parts.
* have stylable state by setting html attributes and/or css classes for state.
* have reasonable min and max dimensions even if its a stretchable widget.
* be focusable (if interactive), and have good keyboard interaction.
* allow it to be disabled (means no focus, no hover, faded-looking, etc.).
* if it has text input, never "correct" what the user is typing in or pasting!
  * IOW, validation should only warn, not slap the hand, that's bad experience.
  * this means having value and input_value as two separate things.
* if it has an inner `<input>`, show the focus ring on the outer container when focusing the input.
* if it's a dropdown, allow keyboard navigation on the picker.
* if dragging is involved, start dragging after a threshold distance (5-10px).


# Just some random tips (for now)


## Widget configuration

When creating a widget from html, both html attributes and the widget's
inner html can used to configure the widget. Good naming, good defaults
and terse syntax are key here.

Html attribute values are text, they need to be parsed/converted when
initializing the widget from them. For passing structured data (arrays, sets)
either invent some syntax to pass the data in a html attribute, or invent html
tags to pass the data as the inner html (doesn't need parsing but more verbose).

Eg. a date range value is better put in an attribute with a syntax like
`range="1/1/2000..1/2/2000"` instead of in the inner html with a syntax like
`<from>1/1/2000</from><to>1/2/2000</to>` or whatever, even if that means
parsing it. Also, when setting it from JS the `range` property should accept
`'1/1/2000..1/2/2000'` but also `['1/1/2000', '1/1/2000']` and `[timestamp, timestamp]`.


## Updating the widget when properties change

Updating the widget when a property changes can be done immediately (in the
property's setter) or can be deferred to the next animation frame (in fact
update() is always called when a property changes). Deferring is more work
but allows for multiple property changes before updating happens once in the
next frame, so you have the opportunity to update the widget in a single
possibly more efficient transformation even when that comprises multiple
property changes.


## The necessity to keep properties orthogonal

When defining a property, you can give a convert function in which the
property value can be parsed, clamped or changed in any way before being set.
This comes with a big caveat which is easy to forget: the convert function
*must not depend on the value of any other property* to do its job because
the order in which properties are set when the component is initialized is
undefined. IOW, it is necessary to keep properties orthogonal at all times.
This means *needing to accept invalid values* sometimes.

For example, let's say a widget defines a "list of items" property and also
a "selected item index" property. Notice how you can't clamp the index in its
convert function based on the current list of items, because it might just
happen that the items were not yet set, and if you do that you lose the index.

This can be counter-intuitive because it is very tempting to use the convert
function as a sort of "firewall" that transforms or rejects invalid values
in order to avoid putting the widget in an invalid state, and sometimes
that's not possible.

So orthogonal properties are a bit more work, but the advantage is a widget
in which changing multiple properties in any order will get the same result.

> An alternative to having orthogonal properties with possibly invalid values
would be a way to have batch updates (seting multiple properties at once)
in order to get the widget between valid states, but the API for that is more
complicated, it would be harder to make an object inspector that way, etc.


## Canvas-drawn widgets

If the widget is canvas drawn, it's best to use `resizeable_canvas()` because:

* the canvas needs to be resized and repainted when the widget is resized.
  * resize in multiples of 100-200px or it'll be too slow when dragging a split-view.
* the context needs to be scaled before drawing on hi-dpi screens.
* buffer needs clearing and the context needs to be reset on each repaint.

For styling use css vars. Query the computed css with `e.css()` inside an
`on_measure()` handler, remember the values and then use them in the redraw
handler that was passed to `resizeable_canvas()`.


# What `dom.js` can do for you

* `e.prop('foo')`                - declare a property
* `e.set_foo = f(v, v0, ev)`     - implement property's setter
* `e.on_init(f)`                 - call `f()` after all properties are set
* `e.on_bind(bind_f)`            - call `bind_f(on)` when attached and detached from DOM
* `e.on_update(f)`               - call `f(opt)` on the next update - update the DOM here
* `e.on_measure(f)`              - call `f()` after all updates are done - measure the DOM here
* `e.on_position(f)`             - call `f()` after all measurements are done - update the DOM that uses measurements here
* `e.make_disablable()`          - add disabled property
* `e.make_focusable()`           - add focusable and tabindex property
* `e.popup()`                    - turn into a popup
* `resizeable_canvas(redraw)`    - creates a canvas that resizes itself automatically
  * `redraw(cx, w, h, pass)`     - called when properties change, widget is resized, etc.


