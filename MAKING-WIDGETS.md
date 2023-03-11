# How to make widgets for the web

Writing a good widget is hard on any platform. Writing one for the web is
even harder. Luckily we have enough rope in dom.js and css.js to do a decent
job. Let's see what that means first.

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
* allow it to be focused (if interactive), and have good keyboard interaction.
* allow it to be disabled (no focus, no hover, faded-looking, etc.).
* if it has text input, never mess with what the user is typing!
* IOW, validation should only warn, not slap the hand.
* if it has an inner `<input>`, show the focus ring on the outer container when focusing the input.

# Just some random tips (for now)

* when creating a widget from html, both html attributes and the widget's
inner html can used to configure the widget. prioritize terseness.

* html attribute values are text-only, they need to be parsed/converted when
initializing the widget from them. For passing structured data (arrays, sets)
either invent some syntax to pass the data in a html attribute, or invent html
tags to pass the data as the inner html (needs no parsing but more verbose).

* updating the widget when a property changes can be done immediately (in the
property's setter) or can be deferred to the next animation frame (in fact
update() is always called when a property changes). Deferring is more work
but supports multiple property changes before updating happens once on the
next frame.

* if the widget is canvas drawn, best to use resizeable_canvas() because:
  * the canvas needs to be resized and repainted when the widget is resized.
	 * resize in multiples of 100-200px or it'll be too slow when dragging a split-view.
  * the context needs to be scaled before drawing on hi-dpi screens.
  * buffer needs clearing and the context needs to be reset on each repaint.

# What `dom.js` can do for you

About that rope...

* e.prop('foo', opt)          - declare a property
* e.set_foo = f(v, v0, ev)  - implement property's setter
* e.on_init(f)                - run f after all properties are set
* e.on_bind(f)                - run f when attached and detached from DOM
* e.on_update(f)              - run f on the next update - update the DOM here
* e.on_measure(f)             - run f after all updates are done - measure the DOM here
* e.on_position(f)            - run f after all measurements are done - update the DOM that needs measurements
* e.make_disablable()         - add disabled property and disable()
* e.make_focusable()          - add focusable and tabindex property
* e.popup()                   - turn into a popup
* resizeable_canvas(f)        - creates a canvas that resizes itself automatically
