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

CSS is many dumb things, but lack of composability is the worst.

Luckily we can create styles programmatically so we can make composable CSS
with a few lines of JS and very little runtime overhead, and not having
to resort to silly offline preprocessors.

Generating CSS also gives us the opportunity to disable the genius CSS feature
of specificity by wrapping all the rules in `:where()` thus leaving source
order and CSS layers as the way to specify rule order.

Programmable interfaces are a great escape hatch from the idiocy of silly
platform designers.


## No global z-index

Popups, i.e. things that should pe painted above everything else but should
otherwise be anchored to a specific part of the layout, are impossible
on this platform. Combine that with the "implicit stacking context" genius idea
(which is probably an abstraction leak of the underlying graphics implementation,
cowardly disguised as a feature), and it's no wonder that `z-index: 99999`
is basically a meme at this point, endlessly frustrating beginners in their
attempt to apply logic and common sense to make simple things with this lemon.


## Popups

Popups are impossible to implement cleanly on this platform.
There are basically two ways to implement popups:

Method 1: Add the popup to the root. Problems with that:

* removing the target from the DOM doesn't remove the popup, must fix in JS.
* hiding the target doesn't hide the popup, must fix in JS.
* disabling the target doesn't disable the popup, must fix in JS.
* wrong Tab focusing order, must fix in JS.

Method 2: Add the popup to its target. Problems with that:

* any CSS rule that works on the assumption that the DOM tree represents
visually nested lists of boxes, will break:

	* :hover rules on the container are triggered when hovering the popup.
	:hover bubbles up because it assumes that child elements are visually
	inside their parents, but in this case the popup is not
	(visually it's a sibling of its parent).

	* .b-collapse-h: a css class which collapses borders in a list.
	This assumes that DOM siblings are visual siblings. A popup added
	to a list is a sibling DOM-wise but not visually.

	* .focus-within: a css class which puts a focus ring on a container
	when an inner input element is focused. A popup containing an input
	element, when attached to such container, will put the focus ring
	on the container, but visually the input is not inside the container.

* lack of a global z-index: partially fixed with `display: fixed` hack
but any parent creating an implicit stacking context breaks the hack,
and it's very easy to create implicit stacking contexts by mistake.
Basically forever live in fear of bug reports with popups that are
partially obscured.


## Pixel snapping

Draw a "+" sign that looks sharp at any zoom level on this platform, I dare you.

There's many ways to do graphics on the web: styled divs, svg, canvas,
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

The only other way to draw a scalable plus sign that looks good is with canvas.
The canvas API is great because well, it's an API, and APIs are always better
than declarative abstractions (contrary to current wisdom) simply because
nothing beats the level of composability and automation of a programming language.

Canvas is not all good though. Drawing an entire widget procedurally on a canvas
is great if you need to make a grid widget that scrolls a million records
at 60 fps, in fact it's the only way to do it, and we've done that.
But using it for simple things is overkill: it's not integrated with the
layout system and CSS, so you need to code for resizing, styling, scrolling,
animation, hit-testing, hi-dpi, etc. (which you might actually enjoy more
than putting divs together but it's also more work).


## Padding is not accounted for on overflow

Never put padding on a container that can overflow by scrolling because the
scrollbar doesn't accunt for the container's padding, it's only scrolling
the content inside the padding, even though the scrollbar itself is drawn
in the space that includes the padding, which is very misleading visually.


## Browser bugs

Check out this still-open FF bug from 11 years ago:

	https://bugzilla.mozilla.org/show_bug.cgi?id=1335265

This is not some obscure situation that you never run into, this is core
flexbox functionality. Stuff like this wastes hours of valuable programmer
time, bewilders and frustrates the programmer making them less productive, etc.

