# Programming for browsers in 2022

Following is a condensed summary of the issues and gotchas that I've
encountered in two years of writing web components from scratch
in JavaScript in the year of our DOM 2020 through 2022.


## The web components API is unusable

Here's what's wrong with it:

* You can't create child elements in the constructor while the DOM is loading,
so good luck initializing components declared in HTML. You're going to have
to query the document for components and initialize them on DOMContentLoaded.

* disconnectedCallback() is called asynchronously (probably on GC) so you
can end up with two component instances with the same id at the same time.
Good luck implementing something that binds a component to another automatically
by id whenever the target component is attached to the DOM.

* connectedCallback() is called before children are created (and even before
they are parsed), instead of going depth-first after they are created.
Good luck trying to set up the children automatically when the component is attached.

* shadow DOM/CSS makes components unstylable by library users but at least
you're not forced to use it.

Luckily we can create our own components API, with blackjack and hookers,
and none of the above problems, so as long as you're not using third-party
libraries (luckily we're not), you can consider this solved.


## CSS is not composable

This means that CSS rules are not reusable. Luckily we can create styles
programmatically so we can have composable CSS in JavaScript with very little
runtime overhead, and not having to resort to silly offline preprocessors.

## CSS specificity

CSS is many dumb things, but specificity takes the cake. Luckily, generating
CSS also gives us the opportunity to completely disable this genius CSS feature
(by wrapping all the rules in `:where()`) thus leaving source order and CSS
layers as the way to specify rule order.


## No global z-index

Popups, i.e. things that should be painted above everything else but should
otherwise be anchored to a specific part of the layout, are impossible
on this platform. Combine that with the "implicit stacking context" genius idea
(which is probably an abstraction leak of the underlying graphics implementation,
cowardly disguised as a feature), and it's no wonder that `z-index: 99999`
is basically a meme at this point, endlessly frustrating beginners in their
attempt to apply logic and common sense to make simple things with this lemon.


## Popups

Even if you do them in JavaScript, popups are impossible to implement cleanly
on this platform without the abstraction leaking all over the place. Let's see:

### Method 1: Add the popup to the root. Problems with that:

* removing the target from the DOM doesn't remove the popup, must fix in JS.
* hiding the target doesn't hide the popup, must fix in JS.
* disabling the target doesn't disable (or hide) the popup, must fix in JS.
* wrong Tab focusing order if the popup contains focusable elements, must fix in JS.

### Method 2: Add the popup to its target. Problems with that:

* any CSS rule that works on the assumption that the DOM tree represents
visually nested lists of boxes, will break:

	* `:hover` rules on the container are triggered when hovering the popup.
	:hover bubbles up because it assumes that child elements are visually
	inside their parents, but in this case the popup is not
	(visually it's a sibling of its parent).

	* `.b-collapse-h`: a css class that collapses borders in a list.
	This assumes that DOM siblings are visual siblings. A popup added
	to a list is a sibling DOM-wise but visually it is not.

	* `.focus-ring`: a css class that puts a focus ring on a container
	when an inner input element is focused. A popup containing an input
	element, when attached to such a container, will put the focus ring
	on the container, but visually the input is not inside the container,
	so that rule doesn't make sense when popups are involved.

To avoid these issues, wrap the popup's target in a container and add the
popup to the container instead. Note that you can't add popups to elements
like `<input>` and such anyway, so you have to wrap.

* lack of a global z-index: partially fixed with the `display: fixed` hack
but any parent creating an implicit stacking context breaks the hack,
and it's very easy to create implicit stacking contexts by mistake.

This is why depending on the method chosen, you'll often see bugs on websites
where the popup is either partially obscured (when method 2 was chosen),
or left behind after its target is gone.


## Event listeners are not weak refs

If your web component needs to register an event listener on another component,
or on a global object like document or window in order to function, then it
also needs to remove that listener before it is freed, otherwise the component
will leak because the external object holds a reference to the listener.
Suddenly you're no longer in a garbage-collected language, now you're in a
language with manual memory management, in which you have to call a free
function to free your component. Either that, or invent a policy that does
that automatically, like for instance when the component is detached from
the DOM, which is what every web components framework does. In fact, this is
the only reason for the need to have attach/detach hooks at all in a framework.

Needless to say, this could've been solved simply and elegantly if JavaScript
had proper iterable weak tables (like Lua has since 2006) so we could implement
weak event listener entries. Most probably they'll figure out a way to do this
securely in the future. In the meantime, just make sure that you add/remove
your external event listeners in the `bind` callback. That's why in our
framework there's a single `bind` callback that gets called with an `on` flag
for attach/detach which you can pass directly to `on()` to add/remove a listener.


## Pixel snapping

Draw a "+" sign that looks sharp at any zoom level on this platform, I dare you.

There are many ways to do graphics on the web: styled divs, svg, canvas,
fonts, raster images.

For small-size graphics that prioritize legibility like icons, raster images are out.

With styled divs you can do very little (basically boxes, triangles, circles).
You get pixel snapping which can be useful but you can't control it, so you
can't make for instance a radio button using two overlapped divs with
border-radius 50%, the circles will just not look concentric half the time
(same goes for a toggle or a checkbox).

With svg you can make concentric circles since SVG is not pixel-snapped
by default, but you can't make a "+" sign that will look good. For that,
fonts are still the best option because they have true hinting (which simple
pixel snapping is not).

The only other way to draw a scalable plus sign that looks good is with canvas,
but that's way overkill for a simple icon.

## Padding and overflow

Never put padding on a container that can overflow by scrolling because the
scrollbar doesn't account for the container's padding, it's only scrolling
the content inside the padding, even though the scrollbar itself is drawn
in the space that includes the padding, which is very misleading visually.


## CSS Transitions

Transitions is just lerp'ing css properties, which are only a proxy for the
things that you might actually want to animate. So if you want to fade-in/out
an element into/out-of existence for example you have to use opacity because
non-numeric properties like visibility or display are not lerp'able. Computed
properties like element's size and position are not transitionable at all.
To animate those use the FLIP technique.


## Focus state

Use `:focus-visibile` instead of `:focus` so that a focus ring only appears
on keyboard navigation but not on mouse navigation which would be distracting
and ugly. The problem is that Firefox doesn't support `:has(:focus-visible)`
(because it doesn't support `:has()`) yet, and there's no `:focus-visibile-within`
equivalent to `:focus-within`. Also the `focusVisible` option to `focus()`
only works in Firefox and there's no way to query the `:focus-visible` state
at all from JavaScript which is needed for canvas-drawn widgets.

I guess we'll just have to wait on these because the alternative is tu
reimplement the whole focusing logic in JavaScript (doable but more work
than waiting).

Another minor issue is that there's no way to tell if focusing was the result
of Tab navigation or by calling focus(), which is important because when you
focus a dropdown picker you don't want to smooth-scroll to move the selected
element into view, but when you Tab-navigate you do. Luckily we can override
focus() and track that when we need this distinction, so consider this solved
(for non-built-in focusables at least, for inputs it's a different story).

Related, there's no way to tell if focusing was the result of Tab or shift+Tab
which you need to know if your widget contains multiple focusable elements
but your widget is canvas-drawn so those are not DOM elements (you could
create hidden elements with tabindex for this use case but it's easier to
just keep focus state internally and just use that when drawing). This is
solved by tracking shift pressed state globally (getting key state is another
missing API).


## Making an element disabled

There's no built-in way to disable any element and it's not easy to do it yourself.

* `pointer-events: none` disables mouse events but has the nasty side effect
of making your otherwise visibile elements click-through (so never use this
on overlapping elements). You do need it to block `:hover` rules though
(that is if you don't want to litter your CSS with `:not([disabled])`).
Oh, but then scrolling doesn't work. You just can't win on the web.

* there's no way to disable tab focusing with CSS.


## Mouse wheel deltas

They're totally different on a touchpad than on a mouse wheel, different
between browsers, different on a Mac, so good luck detecting which is which
and correct for it. Lately though, `wheelDeltaY` at least seems to give
something in "pixels" that you can use for scrolling. Tested on Chrome & FF
with a mouse with scroll wheel on Windows and with a touchpad on a Mac.


## Browser bugs

Check out this still-open FF bug from 11 years ago:

	https://bugzilla.mozilla.org/show_bug.cgi?id=1335265

This is not some obscure case that you never run into, this is core flexbox
functionality. And you can't fix this with JavaScript, unless you draw your
entire web app on a giant canvas and do your own layouting and styling from
scratch in JS (some people had done just that and they're probably happy).

