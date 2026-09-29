CANVAS-UI ARCHITECTURE ISSUES AND SOLUTIONS
==============================================================================

THE I-DEPEND-ON-A-WIDGET-NOT-BUILT-YET PROBLEM
------------------------------------------------------------------------------
i.e. widgets depending on the state of other widgets that appear later in the
frame. IMGUI makes it worse, but the problem itself is not IMGUI-specific.

* solution #1: phase splits over common state:
	* build -> measure/position -> translate -> register -> draw -> hit-test
	* layout: word-wrapping measure-y phase needs position-x phase first.
	* layout: space distribution needs all widgets measured on that axis.
	* layers: paint order independent of build order and can also be dynamic.
	* scrollbox: settling scroll position needs all widgets layouted.
	* frame: content build needs scroll offset and viewport size.
	* synchronized scrollboxes (sync x-scroll of cell view and header):
	  common state id updated in position phase by whichever scrollbox interacted
	  first (only one can interact at a time) and used in translation phase.

* solution #2: state update callbacks:
	* split state update and command generation into separate stages.
	* CON: the later widget must have already been there the last frame or
	  state_of() returns nothing, so you need to use state_of(id) ?? model.
	* CON: must use widget state to pass information between the two stages
	  instead of local variables (FIX to get that back: stateful_widget).

* solution #3: cmd record buffers (currently avoided):
	* decouples build/state-update order from document order, so that widgets
	  can depend on each other's state regardless of document order.
	* CON: inter-record index references are not supported.
		* FIX: use ct stack instead of storing ct_i.
	* CON: you can't reference a widget that you don't own.

* other cases and alternatives:
	* dynamic child order in flexbox:
		* ALT: TODO: `order` attribute for flex children.

NOTE: layers only work with popups because you want layers when things overlap
and only popups do that (other boxes don't overflow).


THE I-CHANGED-A-WIDGET-ALREADY-BUILT PROBLEM
------------------------------------------------------------------------------
* solution: forced re-layouting without redrawing with ui.relayout():
	* CON: doubles the layout time so we can't do it on mouse move or animations.
	* CON: must only be called inside a condition that is guaranteed to be false
	  on the second pass (in practice conditions are edge events so it's ok).
	* PRO: makes update callbacks work on the first frame by asking for
	  a second frame.


THE MEASURE-WHILE-BUILDING PROBLEM
------------------------------------------------------------------------------
In browsers, measuring while mutating the DOM causes a reflow, naturally.
We want to avoid that. We also want to avoid having to walk the last frame
to get the info.

* solution: ui.measure():
	* ask for measurements in this frame and use the results when building the
	  next frame. so the measurements are always of the last frame, but so is
	  input, so it's actually what we want.
	* CON: measurement is not available on the first frame, so a relayout must
	  be triggered then.


FRAME-BUILDS-IN-TRANSLATE PROBLEM
------------------------------------------------------------------------------
Frames need current viewport size, which is only available in the translate
phase which makes the layouting phases recursive instead of linear when
frames are involved.


==============================================================================


INPUT-IS-CONSUMED-DURING-LAYOUT PROBLEM
------------------------------------------------------------------------------
* wheel and scrollbar drag are settled in position phase, so scroll offset is
  an output of the same pass that other widgets might need it as an input to.
* hit-testing already runs before the build, so the input itself is available
  early. only the clamp needs current-frame viewport and content size.
* CON: settling it before the build means clamping against last frame's sizes.


THE ADDRESS-A-WIDGET-BY-ID PROBLEM
------------------------------------------------------------------------------
* cross-widget links use command indexes: popup target, slider thumb,
  grid group bar, code_edit sidebar. requires target to be built first.
* ids exist and are stable across frames, but there is no id -> command
  address lookup.
* needed for: popup targeting any id.
* CON: making every id-bearing widget publish its address costs per widget;
  opt-in markers cost nothing but require the target to cooperate.
