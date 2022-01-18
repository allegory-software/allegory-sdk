
--oo/controls/menu: standard menu control
--Written by Cosmin Apreutesei. Public Domain.

setfenv(1, require'winapi')
require'winapi.vobject'
require'winapi.itemlist'
require'winapi.handlelist'
require'winapi.menu'

Menus = HandleList'hmenu' --singleton to track menu objects by their hwnd

MenuItemList = class(ItemList)

function MenuItemList:__init(menu, items)
	self.menu = menu
	self.hmenu = menu.hmenu
	self.handlers = {} --{i = handler|false}
	self:add_items(items)
end

local types_bitmask = bitmask{
	menu_break_bar = MFT_MENUBARBREAK, --vertical break with a bar
	menu_break = MFT_MENUBREAK,        --vertical break without a bar
	separator = MFT_SEPARATOR,
	owner_draw = MFT_OWNERDRAW,
	radio_check = MFT_RADIOCHECK,
	rtl = MFT_RIGHTORDER,
	right_align = MFT_RIGHTJUSTIFY,   --apply to this item and all subsequent items (only for menu bar items)
}

local states_bitmask = bitmask{
	checked = MFS_CHECKED,
	enabled = negate(MFS_DISABLED),
	highlight = MFS_HILITE,
	is_default = MFS_DEFAULT,
}

local function mkitem(item)
	return {
		text = item.text,
		submenu = item.submenu and item.submenu.hmenu,
		bitmap = item.bitmap,
		checked_bitmap = item.checked_bitmap,
		unchecked_bitmap = item.unchecked_bitmap,
		type = types_bitmask:set(0, item),
		state = states_bitmask:set(0, item),
	}
end

function MenuItemList:add(i, item)
	if not item then i,item = nil,i end --i is optional
	i = i or #self.handlers+1
	item = item or {}
	InsertMenuItem(self.hmenu, i, mkitem(item), true)
	table.insert(self.handlers, i, item.on_click or false)
	self.menu:__redraw()
	return i
end

function MenuItemList:remove(i)
	RemoveMenuItem(self.hmenu, i, true)
	table.remove(self.handlers, i)
	self.menu:__redraw()
end

function MenuItemList:set(i, item)
	SetMenuItemInfo(self.hmenu, i, mkitem(item), true)
	self.handlers[i] = item.on_click or false
	self.menu:__redraw()
end

function MenuItemList:get(i)
	local item = GetMenuItemInfo(self.hmenu, i, true)
	item.cch = item.cch + 1
	local buf = ffi.new('WCHAR[?]', item.cch)
	item.dwTypeData = buf
	item = GetMenuItemInfo(self.hmenu, i, true, item)
	return update({
			text = item.text,
			submenu = Menus:find(item.submenu),
			bitmap = item.bitmap,
			checked_bitmap = item.checked_bitmap,
			unchecked_bitmap = item.unchecked_bitmap,
			on_click = self.handlers[i],
		},
		types_bitmask:get(item.type),
		states_bitmask:get(item.state)
	)
end

function MenuItemList:setchecked(i, checked)
	CheckMenuItem(self.hmenu, i, true, checked)
end

function MenuItemList:checked(i)
	return bit.band(GetMenuState(self.hmenu, i, true), MF_CHECKED) ~= 0
end

function MenuItemList:setenabled(i, enabled)
	EnableMenuItem(self.hmenu, i, true, enabled)
end

function MenuItemList:enabled(i)
	local item = GetMenuItemInfo(self.hmenu, i, true)
	return states_bitmask:getbit(item.state, 'enabled')
end

function MenuItemList:get_count()
	return GetMenuItemCount(self.hmenu)
end


Menu = class(VObject)

local style_bitmask = bitmask{
	nocheck = MNS_NOCHECK,
	modeless = MNS_MODELESS,
	drag_and_drop = MNS_DRAGDROP,
	auto_dismiss = MNS_AUTODISMISS,
	notify_by_pos = MNS_NOTIFYBYPOS,
}

function Menu:__create_hmenu()
	self.type = 'menu'
	return CreateMenu()
end

function Menu:__init(info)
	info = info or {}
	self.hmenu = self:__create_hmenu()
	Menus:add(self)
	self.items = MenuItemList(self, info.items)

	local style = info
	info = MENUINFO(info)
	info.style = style_bitmask:set(MNS_NOTIFYBYPOS, style)
	SetMenuInfo(self.hmenu, info)
end

function Menu:free()
	DestroyMenu(self.hmenu)
	Menus:remove(self)
	self.hmenu = nil
	self.items.hmenu = nil
end

--publish info fields individually.
Menu:__gen_vproperties(MENUINFO.fields, function(self, k)
	return GetMenuInfo(self.hmenu)[k]
end, function(self, k, v)
	info = MENUINFO()
	info[k] = v
	SetMenuInfo(self.hmenu, info)
end)

--publish style fields individually.
Menu:__gen_vproperties(style_bitmask.fields, function(self, k)
	return style_bitmask:get(GetMenuInfo(self.hmenu).style)
end, function(self, k, v)
	info = GetMenuInfo(self.hmenu)
	info.style = style_bitmask:setbit(info.style, k, v)
	SetMenuInfo(self.hmenu, info)
end)

function Menu:__redraw() end --stub; used by MenuItemList methods

function Menu:get_info()
	local info = MENUINFO:collect(GetMenuInfo(self.hmenu))
	info.style = style_bitmask:get(info.style)
	return info
end

function Menu:set_info(info)
	info = MENUINFO(info)
	info.style = style_bitmask:set(MNS_NOTIFYBYPOS, info.style)
	SetMenuInfo(self.hmenu, info)
end

function Menu:popup(window, x, y, TPM) --TODO: crack TPM
	local r = RECT(x, y, x, y)
	MapWindowRect(window.hwnd, nil, r)
	return TrackPopupMenu(self.hmenu, window.hwnd, r.x, r.y, bit.bor(flags(TPM), TPM_RETURNCMD))
end

function Menu:WM_MENUCOMMAND(i) --pseudo-message from the owner window further routed to individual item handlers
	local handler = self.items.handlers[i]
	if handler then handler(self) end
end


MenuBar = class(Menu)

function MenuBar:__create_hmenu()
	self.type = 'menubar'
	return CreateMenuBar()
end

function MenuBar:__redraw() --used by MenuItemList methods
	if not self.hwnd then return end
	DrawMenuBar(self.hwnd)
end

function MenuBar:__set_window(window) --used by Window:set_menu()
	self.hwnd = window and window.hwnd
	self:__redraw()
end

--showcase

if not ... then
	require'winapi.showcase'
	local win = ShowcaseWindow()

	win.menu = MenuBar()

	win.menu.items:add{
		text = '&File',
		submenu = Menu{
			items = {
				{text = '&Close', on_click = function() win:close() end},
			},
		},
	}

	local helpmenu = Menu()
	helpmenu.items:add{text = '&About', on_click = function() end}

	win.menu.items:add{text = '&Help', submenu = helpmenu}

	MessageLoop()
end
