# How to make widgets for the web

Writing a good widget is hard on any platform. Writing one for the web is
[even harder](WHY-WEB-SUCKS.md). Luckily we have enough rope in `glue.js`,
`dom.js` and `css.js` to do a decent job. Let's see what that means first.

A good widget needs to satisfy many things:

* work in different types of containers: inline, block, flex, grid.
* be instantiable from both HTML and JavaScript with all the features.
  * HTML is untyped so it needs parsing.
* allow property changes while the widget is live.
  * this alone increases complexity and bug surface substantially, at least
    for DOM-based widgets, a little less so for canvas-drawn widgets.
* not leak event listeners when detached from DOM.
* work at any inherited font size.
* use only theme colors.
* update itself when resized.
* fire events on state changes.
* be stylable with css classes that describe its inner parts.
* have stylable state by setting html attributes and/or css classes for state.
* have reasonable min and max dimensions even if its a stretching widget.
* be focusable (if interactive), and have good keyboard interaction.
* allow it to be disabled (means no focus, no hover, faded-looking, etc.).
* for dropdowns, allow keyboard navigation on the picker while it's open.
* if dragging is involved, start dragging after a threshold distance (5-10px).
  * you also need an event-based protocol for drag & drop between widgets.
* for input widgets:
  * with text inputs, never "correct" what the user is typing in or pasting in!
    * IOW, validation should not interfere with typing, that's bad experience.
    * this means having input value and valid value as two separate things.
  * if it has an inner `<input>`, show the focus ring on the outer container
  when focusing the input.
  * have plug-in validations.
  * show validation errors as a built-in popup but also have a separate widget for that.
  * maintain hidden input elements to work in forms.
  * validate the initial value to account for the possibility that the db might
  contain invalid values and the user must be given a chance to see them as invalid
  and correct them.

> Some resources on that as a warm-up:
>
> [How to build custom form controls (article on MDN)](https://developer.mozilla.org/en-US/docs/Learn/Forms/How_to_build_custom_form_controls)
> [How to Report Errors in Forms (article on NN/g)](https://www.nngroup.com/articles/errors-forms-design-guidelines/)
> [Jakob Nielsen - Top 10 Web-design Mistakes (YouTube presentation)](https://www.youtube.com/watch?v=VGxze7xMYJs)

# Architecture notes


## Widget configuration

When creating a widget from html, both html attributes and the widget's
inner html can be used to configure the widget. Good naming, good defaults
and terse syntax are key here.

Html attribute values are text, they need to be parsed/converted when
initializing the widget from them. For passing structured data (arrays, sets)
either invent some syntax to pass the data in a html attribute, or invent html
tags to pass the data as the inner html (doesn't need parsing but more verbose).

Eg. a date range value is better put in an attribute with a syntax like
`range="2000-01-01..2000-01-02"` instead of in the inner html with a syntax like
`<from>2000-01-01</from><to>2000-01-02</to>` or whatever, even if that means
parsing it. Also, when setting it from JS the `range` property should accept
`'2000-01-01..2000-01-02'` but also `['2000-01-01', '2000-01-02']` and
`[timestamp1, timestamp2]`.


## Updating the widget when properties change

Updating the widget when a property changes can be done immediately (in the
property's setter) or can be deferred to the next animation frame (in fact
the widget's update() method is always called when a property changes).
Deferring is more work but allows for multiple property changes before updating
happens once in the next frame, so you have the opportunity to update the
widget in a single possibly more efficient transformation. It also solves
an entire class of bugs caused by hidden dependencies between properties,
which I'll discuss next.


## The necessity to keep properties orthogonal

When defining a property, you can give a parse function in which the
property value can be parsed, clamped, or changed in any way before being set.
This comes with a big caveat that is easy to forget: the parse function
*must not depend on the value of any other property* to do its job because
the order in which properties are set when the component is initialized is
undefined. IOW, it is necessary to keep properties orthogonal at all times.
This means *needing to accept invalid values* sometimes and keep the valid
state separately, either internally or exposed as read-only properties.

For example, let's say a widget defines a "list of items" property and also
a "selected item index" property. Notice how you can't clamp the index in its
parse function based on the current list of items, because it might just
happen that the items were not yet set, and if you do that you lose the index.

This can be counter-intuitive because it is very tempting to use the parse
function as a sort of "firewall" that transforms or rejects invalid values
in order to avoid putting the widget in an invalid state.

Hidden dependencies between properties can happen in other ways too. One
common case is when two properties change the same thing in a widget,
so the property that is set last wins.

Another case is when setting a property results in changing another property.
A widget should only change its own properties as the result of user interaction.

An easy way to avoid falling into all of those traps is to do all the updating
of the widget in one place, namely in an update callback. The downside to that
is that the callback is asynchronous (it's called in the next frame), so you
don't have immediate access to the updated DOM of the widget after you change
a property. This forces a conceptual separation between what's considered the
"model" of the widget (which should be updated immediately) and what's
considered the "view" (which is updated in the next frame). This separation
is necessary to avoid TOCTOU bugs because, since DOM updates are done later,
you cannot mix model updates with DOM querying and traversals anymore.
In fact the DOM becomes write-only.

Of course you can always just make your own update function that you call
directly inside property setters to avoid the async issue and still solve
the property dependency issue. This is how we do validation in our input
widgets: the validated value is recalculated immediately every time any of
the props involved in the validation change, not in the next frame.

Another problem with updating everything in one place is that now you have to
figure out how to do the minimum amount of changes in the DOM given the new
model. This is basically why DOM diff'ing was invented, as a general solution.
My take on it is that it's not necessary in most situations. Our element
`set()` method already does a limited form of diff'ing, and even that is
rarely used. Our most complex widgets like the grid or the infinite calendar
are canvas-drawn so there's no DOM to diff there to begin with. In all other
cases, using update flags to signal partial updates should be enough.

So orthogonal properties are a bit more work, but the result is a widget
in which changing properties in any order will get to the same result.


## Canvas-drawn widgets

The canvas API is great because well, it's an API, and APIs are always better
than declarative abstractions (contrary to current wisdom) simply because
nothing beats the level of control and composability of a programming language.
And there's no DOM to update so updating the view becomes simpler and more
robust. Basically immediate-mode-style GUI at the widget level.

Canvas is not all good though. Drawing an entire widget procedurally on a canvas
is great if you need to make a grid widget that scrolls a million records
at 60 fps, in fact it's the only way to do it. But using it for simple things
is overkill: it's not integrated with the layout system or CSS, so you need
to code for resizing, styling, scrolling, animation, hit-testing, pixel snapping,
hi-dpi, etc. (which you might actually enjoy more than putting divs together
and you have the ultimate control over every pixel but it's work you have to do).

In any case, if you do decide on a canvas-drawn widget, it's best to use
`resizeable_canvas_container()` because:

* the canvas needs to be resized and repainted when the widget is resized.
  * resize in multiples of 100-200px or it'll be too slow when dragging a split-view.
* the context needs to be scaled before drawing on hi-dpi screens.
* buffer needs clearing and the context needs to be reset on each repaint.

For styling use css vars. Query the computed css with `e.css()` inside an
`on_measure()` handler, remember the values and then use them in the redraw
handler that was passed to `resizeable_canvas_container()`.

Check out the calendar widget to get a feel on how canvas-based differs from
DOM-based, there's a lot more to it than what's been talked about here.


# Programming notes


## What `dom.js` can do for you

* `e.prop('foo')`                - declare properties
* `e.set_foo = f(v, v0, ev)`     - implement property setters
* `e.on_init(f)`                 - call a function after all properties are set
* `e.on_bind(f)`                 - call a function when the element is attached or detached from DOM
* `e.on_update(f)`               - call `f(opt)` on the next update - update the DOM here
* `e.on_measure(f)`              - call `f()` after all updates are done - measure the DOM here
* `e.on_position(f)`             - call `f()` after all measurements are done - update the part of the DOM that uses measurements here
* `e.make_disablable()`          - add disabled property and disable() method
* `e.make_focusable()`           - add focusable and tabindex property
* `e.make_popup()`               - turn element into a popup
* `resizeable_canvas_container(redraw)`  - create a canvas that resizes itself automatically
  * `redraw(cx, w, h, pass)`     - called when properties change, widget is resized, etc.


## Writting CSS rules

### CSS reuse

  Use var() for anything that is used in two places and is not a coincidence.
  Use utils classes over specific styles when you can.

### CSS and state

  State classes are set only on the outermost element of a widget except
  `:focus-visible` which is set to the innermost element (which has tabindex).
  Use `.outer.state .inner` to style `.inner` on `.state`.
  Use `.outer:has(.inner:focus-visible)` to style `.outer` on `:focus-visible`
  but note that this doesn't work in Firefox in 2022 (but will work in 2023).

### CSS descendant combinator

  For container widgets like tabs and split you have to use the ">" combinator
  instead of " " at least until you reach a header or something, otherwise
  you will accidentally select child widgets of the same type as the container.


## Similar APIs

Ideally, there should be only one way of doing something in an API.
When there are two ways, it can cause confusion about which method to use.
Here's some explanations:

* `method(class, name, f)` vs `class.prototype.name = f`. The latter is
preferred, but `method()` makes the method name non-enumerable which is
sometimes preferred. Also, `method()` shadows both instance and prototype
methods which can be desired or not depending on the situation.

* `property(e, k, ...)` vs `e.property(k, ...)` vs `e.prop(k)`. The first
variant works for any object, the second is just sugar of the first for
elements but the third is usually what you want for elements as it packs
in many features overridable getters and setters, storing the value internally
and creating a getter for you, setting a mirror attribute for styling, etc.

* `override(class, method, f)` vs `e.override(method, f)`. The first variant
overrides built-in methods and works on any class. The element variant can't
override built-in methods.

