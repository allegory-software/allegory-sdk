CANVAS-UI ARCHITECTURE ISSUES AND SOLUTIONS
==============================================================================

THE I-DEPEND-ON-A-WIDGET-NOT-BUILD-YET PROBLEM
------------------------------------------------------------------------------
i.e. widgets depending on the state of other widgets that appear later in the
frame. IMGUI makes it worse, but the problem itself is not IMGUI-specific.

* solution #1: cmd record buffers:
	* decouples build/state-update order from document order, so that widgets
	  can depend on each other's state regardless of document order.
	* CON: inter-record index references are not supported.
		* FIX: use ct stack instead of storing ct_i.
	* CON: you can't reference a widget that you don't own.

* solution #2: keepalive update callbacks:
	* split state update and command generation into separate stages.
	* CON: must use widget state to pass information between the two stages
	  instead of local variables.
	* CON: the later widget must have already been there the last frame.
	* PRO: could solve the sync'ed scrollboxes problem (which is now translate
	  phase) by moving offset calculation to build stage (but can't clamp it!).

* use cases and alternatives:
	* dynamic child order in flexbox:
		* ALT: TODO: `order` attribute for flex children.
	* dynamic draw order:
		* ALT: layers, but they only work with popups currently.


THE I-CHANGED-A-WIDGET-ALREADY-BUILT PROBLEM
------------------------------------------------------------------------------
* solution: forced re-layouting without redrawing with ui.relayout():
	* CON: doubles the layout time so we can't do it on mouse move or animations.
	* CON: must only be called inside a condition that is guaranteed to be false
	  on the second pass.
	* PRO: makes keepalive update callbacks work on the first frame.


THE MEASURE-WHILE-BUILDING PROBLEM
------------------------------------------------------------------------------
in browsers measuring while mutating the DOM causes a reflow, naturally.
we want to avoid that, and also avoid walking the last frame to get the info.

* solution: ui.measure():
	* ask for measurements in this frame and use the results when building the
	  next frame. so the measurements are always of the last frame, but so is
	  input, so it's actually what we want.
	* CON: measurement is not available on the first frame, so a relayout must
	  be triggered then.


FRAME-BUILDS-IN-TRANSLATE PROBLEM
------------------------------------------------------------------------------
* frames need current viewport size, which is only available in the translate
  phase which makes the layouting phases recursive instead of linear when
  frames are involved.

* CON: scroll_to_view called inside an on_frame callback needs another frame
  so must call animate() (can't call relayout() either since we don't have
  an edge condition for it).

* TODO: list limitations of frames in general.


==============================================================================



INPUT-IS-CONSUMED-DURING-LAYOUT PROBLEM
------------------------------------------------------------------------------
* wheel and scrollbar drag are settled in translate phase, so scroll offset is
  an output of the same pass that other widgets might need it as an input to.
* hit-testing already runs before the build, so the input itself is available
  early. only the clamp needs current-frame viewport and content size.
* CON: settling it before the build means clamping against last frame's sizes.


TRANSLATE-ORDER-IS-TREE-ORDER PROBLEM
------------------------------------------------------------------------------
* distinct from build order: even with everything built, translate visits in
  document order, and dependencies are not tree-shaped.
* only translate can host deferral. measure accumulates children into the
  container and position distributes the container among children, so a node
  can't be lifted out of either without unpicking the sibling arithmetic.


THE ADDRESS-A-WIDGET-BY-ID PROBLEM
------------------------------------------------------------------------------
* cross-widget links thread command indexes by hand: popup target, slider
  thumb, grid group bar, code_edit sidebar. requires target built first.
* ids exist and are stable across frames, but there is no id -> command
  address lookup, and no uniform slot to read a widget's id from (only
  box_widget's t.ID, used by one widget).
* needed for: popup targeting any id, scrollboxes syncing per axis.
* CON: making every id-bearing widget publish its address costs per widget;
  opt-in markers cost nothing but require the target to cooperate, which
  rules out addressing widgets from library code you can't modify.
