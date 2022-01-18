
--oo/controls/listview: standard listview control
--Written by Cosmin Apreutesei. Public Domain.

setfenv(1, require'winapi')
require'winapi.controlclass'
require'winapi.listview'
require'winapi.itemlist'
require'winapi.headercontrol'

LVColumnList = class(ItemList)

function LVColumnList:add(i, col)
	if not col then i,col = self.count+1,i end
	if type(col) == 'string' then col = {text = col} end
	return ListView_InsertColumn(self.hwnd, i, col)
end

function LVColumnList:get(i)
	return ListView_GetColumn(self.hwnd, i)
end

function LVColumnList:set(i, col)
	ListView_SetColumn(self.hwnd, i, col)
end

function LVColumnList:remove(i)
	ListView_DeleteColumn(self.hwnd, i)
end

function LVColumnList:get_count()
	local header = ListView_GetHeader(self.hwnd)
	return Header_GetItemCount(header)
end

function LVColumnList:get_width(i)
	return ListView_GetColumnWidth(self.hwnd, i)
end

local col_widths = {
	autosize = LVSCW_AUTOSIZE,
	autosize_header = LVSCW_AUTOSIZE_USEHEADER,
}
function LVColumnList:set_width(i,w)
	return ListView_SetColumnWidth(self.hwnd, i, col_widths[w] or w)
end

function LVColumnList:move(i, toi)
	local ai = ListView_GetColumnOrderArray(self.hwnd)
	ListView_SetColumnOrderArray(self.hwnd, t)
end

function LVColumnList:set_selected(i)
	return ListView_SetSelectedColumn(self.hwnd, i)
end

function LVColumnList:get_selected()
	return ListView_GetSelectedColumn(self.hwnd)
end


LVItemList = class(ItemList)

function LVItemList:add(i, item)
	if not item then i,item = self.count+1,i end
	if type(item) == 'string' then item = {text = item} end
	local subitems = item.subitems
	item = LVITEM(item)
	item.i = i
	item.subitem = 0
	ListView_InsertItem(self.hwnd, item)
	if subitems then
		for si, item in ipairs(subitems) do
			self:set_subitem(i, si, item)
		end
	end
	return item
end

function LVItemList:remove(i)
	ListView_DeleteItem(self.hwnd, i)
end

function LVItemList:set_subitem(i, subitem, item)
	if type(item) == 'string' then item = {text = item} end
	item = LVITEM(item)
	item.i = i
	item.subitem = subitem
	ListView_SetItem(self.hwnd, item)
end

function LVItemList:get_subitem(i, subitem)
	local item = LVITEM:setmask()
	item.i = i
	item.subitem = subitem
	ListView_GetItem(self.hwnd, item)
	return LVITEM:collect(item)
end

function LVItemList:set(i, item)
	self:set_subitem(i, 0, item)
end

function LVItemList:get(i)
	return self:get_subitem(i, 0)
end

function LVItemList:get_count()
	return ListView_GetItemCount(self.hwnd)
end

function LVItemList:clear()
	ListView_DeleteAllItems(self.hwnd)
end

local LVIRs = {
	bounds = LVIR_BOUNDS, --default
	icon = LVIR_ICON,
	label = LVIR_LABEL,
	select_bounds = LVIR_SELECTBOUNDS,
}
function LVItemList:get_rect(i, j, what)
	local LVIR = LVIRs[what or LVIR_BOUNDS]
	if not j or j == 0 then
		return ListView_GetItemRect(self.hwnd, i, LVIR)
	else
		return ListView_GetSubItemRect(self.hwnd, i, j, LVIR)
	end
end

function LVItemList:get_focused(i)
	return ListView_GetItemState(self.hwnd, i, LVIS_FOCUSED) ~= 0
end

function LVItemList:set_focused(i, on)
	ListView_SetItemState(self.hwnd, i, on ~= false and LVIS_FOCUSED or 0, LVIS_FOCUSED)
end

function LVItemList:get_selected(i)
	return ListView_GetItemState(self.hwnd, i, LVIS_SELECTED) ~= 0
end

function LVItemList:set_selected(i, on)
	ListView_SetItemState(self.hwnd, i, on ~= false and LVIS_SELECTED or 0, LVIS_SELECTED)
end

--BIG TODO: separate styles for icon view, report view etc.

ListView = {
	__style_bitmask = bitmask{
		mode = {
			icon = LVS_ICON,
			small_icon = LVS_SMALLICON,
			list = LVS_LIST,
		},
		single_selection = LVS_SINGLESEL, --TODO: make it the negation: multiple_selection
		always_show_selection = LVS_SHOWSELALWAYS,
		sort = {
			none = 0,
			ascending = LVS_SORTASCENDING,
			descending = LVS_SORTDESCENDING,
		},
		nowrap = LVS_NOLABELWRAP, --TODO: make it the negation: wrap
		auto_arrange = LVS_AUTOARRANGE,
		editable = LVS_EDITLABELS,
		noscroll = LVS_NOSCROLL, --TODO: make it the negation: show_scroll; not for LVS_LIST or LVS_REPORT
		align = {
			top = LVS_ALIGNTOP,
			left = LVS_ALIGNLEFT,
		},
		noheader = LVS_NOCOLUMNHEADER, --TODO: make it the negation: show_header
		nosort = LVS_NOSORTHEADER, --TODO: make it the negation: header_sort
	},
	__style_ex_bitmask = bitmask{
		client_edge = WS_EX_CLIENTEDGE,
		--lv specific
		checkboxes = LVS_EX_CHECKBOXES,
		track_select = LVS_EX_TRACKSELECT,
		activation = {
			one_click = LVS_EX_ONECLICKACTIVATE,
			two_click = LVS_EX_TWOCLICKACTIVATE,
		},
		flat_scroll_bars = LVS_EX_FLATSB,
		tooltips = LVS_EX_INFOTIP,
		auto_activation_underline = {
			hot = LVS_EX_UNDERLINEHOT,
			cold = LVS_EX_UNDERLINECOLD,
		},
		multiple_work_areas = LVS_EX_MULTIWORKAREAS,
		label_tooltips = LVS_EX_LABELTIP,
		border_select = LVS_EX_BORDERSELECT,
		hide_labels = LVS_EX_HIDELABELS,
		snap_to_grid = LVS_EX_SNAPTOGRID,
		simple_select = LVS_EX_SIMPLESELECT,
	},
	__defaults = {
		client_edge = true,
		text = '',
		w = 200, h = 100,
	},
	__init_properties = {'hoover_time'},
	__wm_notify_handler_names = index{
		on_item_changing = LVN_ITEMCHANGING,
		on_item_changed = LVN_ITEMCHANGED,
		on_insert_item = LVN_INSERTITEM,
		on_delete_item = LVN_DELETEITEM,
		on_delete_all_items = LVN_DELETEALLITEMS,
		on_begin_labeled_item = LVN_BEGINLABELEDITW,
		on_end_labeled_item = LVN_ENDLABELEDITW,
		on_column_click = LVN_COLUMNCLICK,
		on_begin_drag = LVN_BEGINDRAG,
		on_begin_rdrag = LVN_BEGINRDRAG,
		on_odcachehint = LVN_ODCACHEHINT,
		on_find_item = LVN_ODFINDITEMW,
		on_item_activate = LVN_ITEMACTIVATE,
		--on_state_change = LVN_ODSTATECHANGED,
		on_hot_track = LVN_HOTTRACK,
		on_get_dispinfo = LVN_GETDISPINFOW,
		on_set_dispinfo = LVN_SETDISPINFOW,
		on_key_down = LVN_KEYDOWN,
		on_marquee_begin = LVN_MARQUEEBEGIN,
		on_get_info_tip = LVN_GETINFOTIPW,
		on_incremental_search = LVN_INCREMENTALSEARCHW,
		on_column_dropdown = LVN_COLUMNDROPDOWN,
		on_column_overflow_click = LVN_COLUMNOVERFLOWCLICK,
		on_begin_scroll = LVN_BEGINSCROLL,
		on_end_scroll = LVN_ENDSCROLL,
		on_link_click = LVN_LINKCLICK,
		on_get_empty_markup = LVN_GETEMPTYMARKUP,
	},
}

function ListView:__set_style_ex_bit(k,v)
	local mask = self.__style_ex_bitmask:compute_mask(k)
	local v = self.__style_ex_bitmask:setbit(0,k,v)
	ListView_SetExtendedListViewStyle(self.hwnd, mask, v)
	SetWindowPos(self.hwnd, nil, 0, 0, 0, 0, SWP_FRAMECHANGED_ONLY)
end

subclass(ListView, Control)

function ListView:after___before_create(info, args)
	args.class = WC_LISTVIEW
	args.style = bit.bor(args.style, LVS_SHAREIMAGELISTS)
	args.style_ex = bit.bor(args.style_ex, LVS_EX_DOUBLEBUFFER) --less flicker
end

function ListView:after___after_create(info, args)
	ListView_SetExtendedListViewStyle(self.hwnd, self.__style_ex_bitmask:compute_mask(), args.style_ex)
end

function ListView:after___init(info)
	self.columns = LVColumnList(self)
	self.items = LVItemList(self)
	self.columns:add_items(info.columns)
	self.items:add_items(info.items)
end

function ListView:get_focused_item_index()
	return ListView_GetNextItem(self.hwnd, nil, LVNI_FOCUSED)
end

function ListView:unfocus_focused_item()
	local i = self.focused_item_index
	if not i then return end
	self.items:set_focused(i, false)
end

function ListView:make_item_visible(i, partial_ok)
	ListView_EnsureVisible(self.hwnd, i, partial_ok)
end

function ListView:click_item(i, make_visible)
	for i1 = 1, self.items.count do
		self.items:set_selected(i1, i1 == i)
	end
	self.items:set_focused(i)
	if make_visible ~= false then
		self:make_item_visible(i)
	end
end

function ListView:set_hoover_time(time)
	ListView_SetHooverTime(self.hwmd, time)
end

function ListView:LVN_ITEMCHANGING(i, subitem, newstate, oldstate)
	if getbit(newstate, LVIS_SELECTED) ~= getbit(oldstate, LVIS_SELECTED) then
		self:fire(getbit(newstate, LVIS_SELECTED) and 'on_item_selecting' or 'on_item_unselecting', i, subitem)
	end
end

function ListView:LVN_ITEMCHANGED(i, subitem, newstate, oldstate)
	if getbit(newstate, LVIS_FOCUSED) ~= getbit(oldstate, LVIS_FOCUSED) then
		self:fire(getbit(newstate, LVIS_FOCUSED) and 'on_item_focused' or 'on_item_unfocused', i, subitem)
	end
	if getbit(newstate, LVIS_SELECTED) ~= getbit(oldstate, LVIS_SELECTED) then
		self:fire(getbit(newstate, LVIS_SELECTED) and 'on_item_selected' or 'on_item_unselected', i, subitem)
	end
end

ReportListView = subclass({
	__style_ex_bitmask = bitmask{
		grid_lines = LVS_EX_GRIDLINES,
		subitem_images = LVS_EX_SUBITEMIMAGES,
		column_reordering = LVS_EX_HEADERDRAGDROP,
		full_row_select = LVS_EX_FULLROWSELECT,
	},
}, ListView)

function ReportListView:after___before_create(info, args)
	args.style = bit.bor(args.style, LVS_REPORT)
end


--showcase

if not ... then
	require'winapi.showcase'
	local window = ShowcaseWindow{w=300, h=200}
	local lv = ReportListView{parent = window, x = 10, y = 10, w = 200, h = 100}
	lv.columns:add'name'
	lv.columns:add'address'
	lv.items:add'you won\'t see me'
	lv.items:clear()
	lv.items:add'Louis Armstrong'
	lv.items:add'Django Reinhardt'
	lv.items:set_subitem(lv.items.count,1,'Beyond The Sea')
	lv.items:set_subitem(1,1,'Basin Street')
	--lv.items:add(3, {text = LPSTR_TEXTCALLBACKW})
	--lv.items:add(4, {text = LPSTR_TEXTCALLBACKW})
	--function lv:get_item_data(item) item.text = 'n/a'end
	lv.items:remove(3)
	MessageLoop()
end

