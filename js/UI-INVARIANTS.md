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

On the frame a widget first appears, no state object exists for its id and
its update is not registered yet, so ui.state_of(id) returns nothing and
runs nothing. That is the right answer. The hit phase ran over the previous
frame's records, which do not include the widget, and the browser has no
element of it to write into, so nothing can have happened to it yet: it has
no edge and no input value to report.

A stored input is the exception. When the app calls ui.saved_value(id,
default) before any code reads id, the input keeps its value in
ui.saved_state under its id, and ui.value(id) answers from there, or with the
default while the store has none, whether or not state exists for that id.
The input takes that value in place of the caller's on every frame, and the
caller gets it back as the return value; the input ignores the caller's
value. The input writes ui.saved_state only on a frame in which the user
interacted with it.

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
knows the id may call ui.state() on it. The toolboxes container's id is one.
An id is a shared namespace only while no code registers an update on it.


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
text, input, toggle, checkbox, slider, num_slider, radio_group, radio_list,
date_input, color_input.

tabs is not an input: its selected tab is view state, not a value the caller
publishes through ui.value(id) or ui.input_value(id).

sat_lum_square, hue_bar, list, list_dropdown, calendar and
color_picker behave the same way and publish the same way, so ui.value(id)
and ui.input_value(id) answer for them too. They are not inputs only in the
sense that a caller is not expected to reach for them by id: the widget that
builds one takes its return value. calendar is date_input's own picker the
same way color_picker is color_input's: date_input normalizes the value to a
day number or null before it ever reaches calendar, so calendar itself never
has to accept or preserve a value it cannot interpret.

There is no uncontrolled shape, except a stored input (see WIDGET STATE).
The caller passes a value on every frame.

null is a value -- database null, no value at all. Every input accepts null
and returns it, and the user clears an input to null with the Delete key
wherever clearing makes sense. An empty text box holds null: the empty
string is never a value, so a box the user has emptied reads the same as a
box that was given nothing. Drawing null differently is not done yet,
except in a slider: with no value it draws its thumb in the middle.

An input ignores the caller's value on any frame in which the user
interacted with it, and takes the caller's value on every other frame; a
stored input takes the stored value instead, or its default while the store
has none. It returns what it holds, on every call.

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
dropdown supplies the four moments -- opened, closed, picked, canceled -- and
holds no value, because the value's owner is the input. In date_input the
dropdown's own id carries no value at all, so it could not hold one.

A multi-select input takes that value back only when the user cancels, with
Escape or the cancel button. Every change in its picker is a toggle the user
chose, so when the dropdown closes any other way, the input keeps the
toggles.

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


NAV
------------------------------------------------------------------------------

Order. The nav uses custom order (pos_col) only while no sort and no filter
are set. With a sort or a filter it uses sorted order, where hidden rows are
fine.

The nav prohibits moving rows while grouped. It rejects direct move
calls before changing arrays.

For flat server navs without pos_col, can_actually_move_rows() disables
movement. The server saves row order through pos_col. Client navs can
save array order.

For tree drop targets, row_can_have_children() rejects rows marked for
deletion, rows with no loaded id, and rows with can_have_children false.
The grid chooses allowed destinations through
state.can_drop(insert_ri, parent_row). The helper checks the drop range,
can_change_parent, and parent eligibility when changing parent. For a
same-parent move, it requires client array order or pos_col. The helper
does not repeat drag-start permission checks. The nav assumes an allowed
destination at completion.

start_move_selected_rows() reads the actual selected rows. It moves a
consecutive sequence of siblings with their subtrees and refuses gaps
containing unselected siblings or selections spanning unrelated parents.
Selected descendants move with their selected ancestor. Before detaching
the visible move range, it calls focus_cell() with select: 'set' to expand
the actual selection and keep focus unchanged. On refusal, it returns no
state and leaves the arrays unchanged. The up/down helpers finish only a
move that started.

In flat mode, child_rows and all_rows are initially the same array. The nav
copies all_rows into child_rows for the first sort. It reuses that copy for
explicit sorts and pos_col ordering, and rebuilds visible rows from it.
The nav sorts child_rows and keeps all_rows in stored order. On clearing
the sort, it restores stored order into the copy before pos_col ordering.

On a flat move in custom order, the nav commits the full display order as
stored order. With separate arrays, it moves child_rows and copies it into
all_rows. With one array, it moves all_rows directly.

On a same-parent tree move, the nav moves the selected sibling records in
that parent's complete child array, or in the root array for root records,
before copying stored order and numbering positions. The nav moves each
record together with its subtree, including collapsed children.

When changing parent in an unsorted tree, the nav reparents the selected
sibling rows and keeps their descendants attached to them. It inserts
them at the chosen position in the new parent's complete child array
before numbering positions or rebuilding client stored order.

When reparenting into a collapsed parent, the nav keeps the parent
collapsed and leaves the moved rows out of visible rows. It clears their
visible indices and clears hidden focus and selection through
focus_cell(). Expanded destinations show the moved rows.

When rebuilding the tree, the nav uses current input parent values,
with loaded values for unchanged cells, so unsaved parent changes are
preserved.

Positions. With pos_col and no explicit sort or grouping, the nav numbers
complete sibling lists from 1. It includes records hidden by filtering or
collapse. UI inserts and physical removals renumber every sibling list;
moves renumber the old and new parents' lists. The nav does not renumber
existing positions while explicitly sorted or grouped.

Keys. There is no nullable pk. The server keeps pks immutable and marks pk
fields readonly; the client does not enforce that. A new row with no key
yet is a valid row. The nav checks pk uniqueness when it validates a row,
only for new rows and rows the user edited, and skips the check for a row
with no key yet. e.lookup() by null returns the rows whose value is null.

Ops. A function's mode is an explicit op, never inferred from another option
such as ev.input. insert_rows takes op: 'insert' (the default) or 'upsert';
it looks for an existing row by pk only for 'upsert', and the grid passes
'insert'. remove_rows takes op: 'delete' (the default) or 'undelete'.

Parameters. A detail nav takes whichever values it needs from the focused
row of each master nav. When inserting a row, the detail nav fills the
row's parameter fields with the current parameter values.

Server consistency. The server keeps the tree consistent, with a foreign
key or without: it rejects removing a row that still has children, or it
removes them too. Keeping the tree consistent is not the client's job.

Focus and selection. focus_cell() owns focus and selection. All other code
changes them by calling focus_cell() with options that say what it wants,
never by writing the fields itself. Only visible rows and cols can be
focused or selected: a hidden focused row or a hidden selected row is a
bug. On a plain move, focus_cell() selects the focused cell and nothing
else. After a filter change or a collapse it resets the selection to the
focused cell; after any other change to the visible rows or cols it drops
only what is now hidden. The code that changes the visible rows chooses
which, through update_parts(). On Ctrl+A the grid focuses the first cell
and selects all rows.

focus_cell(true, true, 0, 0, {select: 'set', select_ri1, select_ri2})
replaces the selection with the given visible row range, keeping focus
unchanged. select_ri1 is inclusive and select_ri2 is exclusive. The nav
applies the existing selection restrictions. In row-select mode, it stores
true for each selected row. In cell-select mode, it stores a set of all
selectable visible fields for each selected row. It clears the previous
selection anchor.

Deleting. On Delete the grid marks the selected rows for deletion; on
Escape it undeletes the marked rows among them. There is no toggle. The
grid asks before deleting, counting the selected rows, except for a single
new row. can_remove_row() decides for the user only; code that drives the
nav is not checked.

A record can be removed only if every record under it can be. When the user
may not remove a record, the nav keeps that record's ancestors too.
remove_rows with op 'undelete' unmarks only marked records, and their
marked parents too, so that no kept record is left under a deleted parent.
The nav drops a deleted new row outright, since the server has nothing to
delete. The nav sends deletes to the server children first.

Group rows are not records. Deleting a group row means deleting the rows
grouped under it: the nav never marks, queues or drops the group row
itself, and removes a group row once no rows are left in it.

Inserting. The nav refuses to insert a row under a parent marked for
deletion. When inserting into a sorted grid, the nav keeps the new row at
the insertion position. Without an explicit sort, it inserts before the
same existing row in stored order and in full sibling order. While
explicitly sorted, UI inserts append in stored order under the same parent.
With pos_col, the nav initializes their positions after all existing
siblings, including hidden records. It preserves the chosen insertion
point in full displayed sibling order and in visible rows.


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

- A parent seeds a child's state with ui.state(), which also keeps the id
	alive -- a side effect the parent has no reason to cause. ui.state_of()
	would drop every one of those writes, because on the frame the child
	first appears there is no state object yet, so the parent has to call
	ui.state() today. The alternative is a call that passes the value into
	the child's build.