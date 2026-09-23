CANVAS-UI INVARIANTS
==============================================================================

Read this before analysing or changing canvas-ui code. These are the rules a
fix has to keep. Do not re-derive them from the code you happen to be
reading: code under a bug looks like a rule.

The frame and the mechanism come from www/ui.js. The ownership rules are
Cosmin's.


THE FRAME
------------------------------------------------------------------------------

One frame, in order:

1. Hit phase, over the records the previous frame left: hit testing, pointer
	capture, focus on click, focus on tab, the default button's click.

2. Build pass: ui.main() runs all the widget code. Widget updates run here,
	and widgets add their commands.

3. Layout over those commands, then focusables are registered. If the focus
	changed during the build, the whole pass runs again, at most once.

4. The state of every id that no code touched during the pass is freed, and
	the free callback of each one runs.

5. Draw, then the DOM focus and the DOM selection are set to what the frame
	decided.

6. Pointer and key state are cleared and the build number is raised.

Between frames the browser runs its own handlers -- input, selectionchange,
focus, blur. They write widget state directly and ask for a frame.


WIDGET STATE AND UPDATES
------------------------------------------------------------------------------

ui.state(id) returns the state object for that id, creating it if needed, and
keeps it alive for this frame. ui.state(id, fn) also registers an update.

An update runs once per build pass: whoever touches that id's state first
runs it, whether that is the widget itself or some other code.

That is the mechanism for reading a widget before it builds itself. A widget
that appears later in the frame is readable earlier through its update.

State survives between frames only while some code touches its id every
frame.


READING ANOTHER WIDGET'S STATE
------------------------------------------------------------------------------

Reading another widget's state is intended. That is what the update is for.

Always read through ui.state_of(id, key). Reading the state map directly
skips the update, so what comes back can be a frame old. A few places inside
ui.js do it on purpose, each because it must not run an update there. No
code outside ui.js may do it, ever, for any reason.

A widget's state fields are public but read-only: any code may read them,
only the widget itself writes them. The one exception is a parent seeding a
child, below.


WHO MAY CALL ui.state()
------------------------------------------------------------------------------

ui.state(id) does three things: it creates the state object if there is
none, it keeps the id alive for this frame, and it runs the update. Only the
widget that owns id calls it, from its build function and from its update.
All other code reads with ui.state_of(id, key), which creates nothing and
keeps nothing alive.

Two exceptions.

A parent may write a field of a child it is about to build in the same pass,
to seed the child before it builds: the scroll position of a picker the code
is about to open, the text of a box the user is about to edit, the item
labels of a list. The parent writes only on the frame the child first
appears, under the same condition that builds the child. Storing the
parent's own data on a child's state between frames is not this exception.

An id with no widget behind it is a shared namespace, and any code that
knows the id may call ui.state() on it. radio's group_id is one: each of the
N buttons reads and writes it and no button owns it. The toolboxes
container's id is another. An id is a shared namespace only while no code
registers an update on it.


EDGES
------------------------------------------------------------------------------

An edge is what a widget reports about itself for one build pass: opened,
closed, picked. The widget keeps it in a field on its own state and clears it
at the top of its own update. So every reader in that pass gets the same
answer in any order, no reader takes it away from the next one, and every
later pass reads false.

Read an edge through the accessor -- ui.dropdown_open(id),
ui.dropdown_opened(id), ui.dropdown_closed(id), ui.dropdown_picked(id) --
which goes through ui.state_of and runs the owner's update first. The list,
the calendar and a grid built as a picker write picked the same way, so
ui.dropdown_picked reads a pick from any of them.

Whatever a reader makes of an edge, it stores in the pass it reads it. A
later pass reads false, so nothing may re-derive an answer from the edge in
the second pass of a rebuilt frame.

An edge decided before the build begins -- in the hit phase or in a DOM
handler -- cannot be cleared at the top of an update, because the clear would
wipe it before any reader runs. The frame clears those with the pointer and
key state at the end of the pass. The click that Enter or Escape sends to a
focus group's default button is one of them.

A widget that wants something from another widget calls it, such as
ui.set_dropdown_open(id, true). A widget that wants to know something reads
the other's state through an accessor. Reading runs the other's update first,
so the answer is current, no pass is repeated, and the order in which the two
are touched changes nothing.

That holds for an edge and for what the user did to a widget, because the
frame fixes both before the build starts. It does not hold for a value the
caller has not supplied yet: see THE INPUT CONTRACT.

One thing no reader can get this way: a decision another widget makes later
in the same pass, since that code has not run yet. Read the id of the widget
that decides the edge, not the id of the widget the edge is about.


VALUES IN AND OUT
------------------------------------------------------------------------------

A widget does not own its value. The caller passes the value in and takes
back what the widget returns. What the widget holds right now, any code reads
through ui.value(id).

One state object holds one value, so a widget that owns both a value of its
own and an editable box builds the box under a sub-id. ui.date_input does
that: one id carries the date and a sub-id carries the box.

The caller is always at least one frame behind for anything the browser
delivers between frames.


THE INPUT CONTRACT
------------------------------------------------------------------------------

An input is a widget that takes a value from the caller and returns one:
text, input, toggle, checkbox, slider, num_slider, date_input, color_input.

tabs is not an input: its selected tab is view state, not a value the caller
publishes through ui.value(id) or ui.input_value(id).

sat_lum_square, hue_bar, radio, list, list_dropdown, calendar and
color_picker behave the same way and publish the same way, so ui.value(id)
and ui.input_value(id) answer for them too. They are not inputs only in the
sense that a caller is not expected to reach for them by id: the widget that
builds one takes its return value. calendar is date_input's own picker the
same way color_picker is color_input's: date_input normalizes the value to a
day number or null before it ever reaches calendar, so calendar itself never
has to accept or preserve a value it cannot interpret. The radio group widget
that carries the value interface does not exist yet.

There is no uncontrolled shape. The caller passes a value on every frame.

null is a value -- database null, no value at all. Every input accepts null
and returns it, and the user clears an input to null with the Delete key
wherever clearing makes sense. An empty text box holds null: the empty
string is never a value, so a box the user has emptied reads the same as a
box that was given nothing. Drawing null differently is not done yet,
except in a slider: with no value it draws its thumb in the middle.

An input ignores the caller's value on any frame in which the user
interacted with it, and takes the caller's value on every other frame. It
returns what it holds, on every call.

The user interacted when the widget itself read an input event addressed to
it -- a click, a drag, a key -- or when the browser wrote into it between
frames. A gesture that leaves the value where it was still counts: dragging
a slider already at its maximum keeps the caller out for that frame, so the
pointer does not lose the thumb.

A widget decides that for itself. A widget built out of others asks each
child instead of deciding on the child's behalf: ui.input_value(id) gives
what the user made of that widget this pass, or nothing when the user did
nothing to it. The widget takes the value from whichever child reports one,
and then reports an interaction of its own, so the answer cascades outward
to its own caller.

The cascade runs the other way too. A widget built out of others passes each
child the child's own value back, unchanged, unless the widget's value
changed from somewhere other than that child -- then it passes its own
value, converted into what that child holds. So the box the user is typing
in keeps the characters the user typed and the slider the user is dragging
keeps the number the user dragged to, while the same widget's other children
take the new value. A child with no value yet takes the widget's value as
well.

So a caller cannot correct a value while the user is acting on it. A
validation, a clamp, or a value arriving from elsewhere takes effect on the
first frame after the user stops.

A value the caller passes comes back unchanged. An input does not clamp,
round or otherwise normalize it: a slider value outside its range draws the
thumb pinned at one end and returns the value it was given. An input
normalizes only where showing the value as given would leave it unusable --
a list index with no row to point at is one of those.

Where an input normalizes, it changes only what it draws and what it uses to
start the next interaction -- never what it stores as the value or returns
from ui.value(id). A list with an out-of-range index highlights no row and
clamps arrow-key movement from that index, but keeps returning the caller's
index unchanged until the user picks a row.

An input accepts, displays and returns a value it cannot interpret. Text
that does not parse comes back as the text the user typed, not as a number
or as a substitute for one. Nothing discards what the user is in the middle
of writing and nothing corrects it. Validation marks a value invalid
somewhere else, and the model stores it as it is.

Reading an input before it builds gives what the user has done to it so far.
That is the answer a reader wants, and the only one that does not change
with read order. It does not give a value the caller supplies later in the
pass.


CANCELLING A PICKER
------------------------------------------------------------------------------

Every input keeps the last value its caller supplied that the input did not
produce itself. That is the value to go back to, and two things use it: a
picker that closes without a pick, and Escape in a box the user has been
typing in. So cancelling gives back the caller's latest value, not the one
from before the caller last spoke.

An input moves that value forward when the user commits -- so Escape after a
commit does not undo the commit. Picking from a dropdown and confirming is a
commit. Typing in a box is not: nothing in a box says "done", so its value
to go back to never moves on its own and Escape undoes everything since the
caller last spoke. Whatever ends an edit around it -- a grid's exit_edit, a
form's blur -- is what commits there.

An input whose picker is a dropdown takes that value back when the dropdown
closes without a pick. It moves it forward on the frame the dropdown opens
rather than on the frame the user commits: by then the committed value is
already the input's own value, whereas on the commit frame it still lives in
the picker, in a different place for each input. The
dropdown supplies the three moments -- opened, closed, picked -- and holds
no value, because the value's owner is the input. In date_input the
dropdown's own id carries no value at all, so it could not hold one.

While the picker is up, the input reports what the user has moved to, not
what it held when the picker opened, so a caller reading the input follows
the user through the list.


PARSING WHAT THE USER TYPED
------------------------------------------------------------------------------

A widget that parses a box's text into a value never formats that value back
into the same box. Formatting drops what the user chose -- the spelling, and
any precision the text does not carry -- so the code would store a rounded
value and respell the box under the caret.

A box is a child like any other, so it takes back its own text unless the
value changed from a different input -- see THE INPUT CONTRACT. What is
particular to a box is that the widget formats the value when it writes one.

A box therefore keeps the characters the user typed until another input
changes the value. "10, 50, 50" stays spelled that way after the caret leaves
it; nothing respells it.

Do not look for cases where the round trip is safe.


ONE OWNER
------------------------------------------------------------------------------

Every piece of state has exactly one owner. Two writers is a bug in the
second writer, not a case to accommodate. Finding one means reporting it, not
designing around it.

While an edit is open in a grid cell, the text in the input box is what the
user is working on, and the cell's value comes from parsing that text.
Nothing spells the value back into the box. Comparing a value against text to
decide what the user meant is what the decimals bug was.


TEXT INPUTS AND THE DOM
------------------------------------------------------------------------------

An editable text widget owns a real DOM input element placed over the canvas.
The browser writes what the user types into the widget's state between
frames. Freeing the widget's state removes the element.

ui.value(id) is the text that widget holds right now.


WHEN A FIX DOESN'T FIT
------------------------------------------------------------------------------

If a fix seems to need reaching past one of these rules, stop and say which
rule it wants to break and why. Do not add state, a flag, an accessor or a
callback to keep a broken shape working.


NOT SETTLED
------------------------------------------------------------------------------

Cosmin decides these; do not fill them in by reading code.

- Input arrives in order and the code reads it out of order. ui.key_events
	keeps every key down and up of the frame in arrival order, but widgets
	ask ui.keydown(key), which reads a set, and the characters you type into
	an editable text reach the widget's state through the browser's input
	event instead of that list. So the grid cannot tell that a character
	came before the Enter that ends the edit, and it takes the box's text
	early to put them back in order by hand. Found 2026-09-18. A queue that
	holds key events and text changes together, consumed in order, would
	settle it.

- ui.value(id) and ui.input_value(id) read one state object, named by id.
	A widget built out of others may end up copying its children's values
	into its own state only so that those two can answer for it. If that
	starts happening, the fix is to make them methods that read the
	children directly, not to copy. Found 2026-09-20.

- A parent seeds a child's state with ui.state(), which also keeps the id
	alive -- a side effect the parent has no reason to cause. ui.state_of()
	would drop every one of those writes, because on the frame the child
	first appears there is no state object yet, so the parent has to call
	ui.state() today. The alternative is a call that passes the value into
	the child's build.