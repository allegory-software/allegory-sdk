(() => {
  // node_modules/@lezer/common/dist/index.js
  var DefaultBufferLength = 1024;
  var nextPropID = 0;
  var Range = class {
    constructor(from, to) {
      this.from = from;
      this.to = to;
    }
  };
  var NodeProp = class {
    /**
    Create a new node prop type.
    */
    constructor(config = {}) {
      this.id = nextPropID++;
      this.perNode = !!config.perNode;
      this.deserialize = config.deserialize || (() => {
        throw new Error("This node type doesn't define a deserialize function");
      });
      this.combine = config.combine || null;
    }
    /**
    This is meant to be used with
    [`NodeSet.extend`](#common.NodeSet.extend) or
    [`LRParser.configure`](#lr.ParserConfig.props) to compute
    prop values for each node type in the set. Takes a [match
    object](#common.NodeType^match) or function that returns undefined
    if the node type doesn't get this prop, and the prop's value if
    it does.
    */
    add(match) {
      if (this.perNode)
        throw new RangeError("Can't add per-node props to node types");
      if (typeof match != "function")
        match = NodeType.match(match);
      return (type) => {
        let result = match(type);
        return result === void 0 ? null : [this, result];
      };
    }
  };
  NodeProp.closedBy = new NodeProp({ deserialize: (str) => str.split(" ") });
  NodeProp.openedBy = new NodeProp({ deserialize: (str) => str.split(" ") });
  NodeProp.group = new NodeProp({ deserialize: (str) => str.split(" ") });
  NodeProp.isolate = new NodeProp({ deserialize: (value) => {
    if (value && value != "rtl" && value != "ltr" && value != "auto")
      throw new RangeError("Invalid value for isolate: " + value);
    return value || "auto";
  } });
  NodeProp.contextHash = new NodeProp({ perNode: true });
  NodeProp.lookAhead = new NodeProp({ perNode: true });
  NodeProp.mounted = new NodeProp({ perNode: true });
  var MountedTree = class {
    constructor(tree, overlay, parser7, bracketed = false) {
      this.tree = tree;
      this.overlay = overlay;
      this.parser = parser7;
      this.bracketed = bracketed;
    }
    /**
    @internal
    */
    static get(tree) {
      return tree && tree.props && tree.props[NodeProp.mounted.id];
    }
  };
  var noProps = /* @__PURE__ */ Object.create(null);
  var NodeType = class _NodeType {
    /**
    @internal
    */
    constructor(name2, props, id2, flags = 0) {
      this.name = name2;
      this.props = props;
      this.id = id2;
      this.flags = flags;
    }
    /**
    Define a node type.
    */
    static define(spec) {
      let props = spec.props && spec.props.length ? /* @__PURE__ */ Object.create(null) : noProps;
      let flags = (spec.top ? 1 : 0) | (spec.skipped ? 2 : 0) | (spec.error ? 4 : 0) | (spec.name == null ? 8 : 0);
      let type = new _NodeType(spec.name || "", props, spec.id, flags);
      if (spec.props)
        for (let src of spec.props) {
          if (!Array.isArray(src))
            src = src(type);
          if (src) {
            if (src[0].perNode)
              throw new RangeError("Can't store a per-node prop on a node type");
            props[src[0].id] = src[1];
          }
        }
      return type;
    }
    /**
    Retrieves a node prop for this type. Will return `undefined` if
    the prop isn't present on this node.
    */
    prop(prop) {
      return this.props[prop.id];
    }
    /**
    True when this is the top node of a grammar.
    */
    get isTop() {
      return (this.flags & 1) > 0;
    }
    /**
    True when this node is produced by a skip rule.
    */
    get isSkipped() {
      return (this.flags & 2) > 0;
    }
    /**
    Indicates whether this is an error node.
    */
    get isError() {
      return (this.flags & 4) > 0;
    }
    /**
    When true, this node type doesn't correspond to a user-declared
    named node, for example because it is used to cache repetition.
    */
    get isAnonymous() {
      return (this.flags & 8) > 0;
    }
    /**
    Returns true when this node's name or one of its
    [groups](#common.NodeProp^group) matches the given string.
    */
    is(name2) {
      if (typeof name2 == "string") {
        if (this.name == name2)
          return true;
        let group = this.prop(NodeProp.group);
        return group ? group.indexOf(name2) > -1 : false;
      }
      return this.id == name2;
    }
    /**
    Create a function from node types to arbitrary values by
    specifying an object whose property names are node or
    [group](#common.NodeProp^group) names. Often useful with
    [`NodeProp.add`](#common.NodeProp.add). You can put multiple
    names, separated by spaces, in a single property name to map
    multiple node names to a single value.
    */
    static match(map) {
      let direct = /* @__PURE__ */ Object.create(null);
      for (let prop in map)
        for (let name2 of prop.split(" "))
          direct[name2] = map[prop];
      return (node) => {
        for (let groups = node.prop(NodeProp.group), i = -1; i < (groups ? groups.length : 0); i++) {
          let found = direct[i < 0 ? node.name : groups[i]];
          if (found)
            return found;
        }
      };
    }
  };
  NodeType.none = new NodeType(
    "",
    /* @__PURE__ */ Object.create(null),
    0,
    8
    /* NodeFlag.Anonymous */
  );
  var NodeSet = class _NodeSet {
    /**
    Create a set with the given types. The `id` property of each
    type should correspond to its position within the array.
    */
    constructor(types) {
      this.types = types;
      for (let i = 0; i < types.length; i++)
        if (types[i].id != i)
          throw new RangeError("Node type ids should correspond to array positions when creating a node set");
    }
    /**
    Create a copy of this set with some node properties added. The
    arguments to this method can be created with
    [`NodeProp.add`](#common.NodeProp.add).
    */
    extend(...props) {
      let newTypes = [];
      for (let type of this.types) {
        let newProps = null;
        for (let source of props) {
          let add = source(type);
          if (add) {
            if (!newProps)
              newProps = Object.assign({}, type.props);
            let value = add[1], prop = add[0];
            if (prop.combine && prop.id in newProps)
              value = prop.combine(newProps[prop.id], value);
            newProps[prop.id] = value;
          }
        }
        newTypes.push(newProps ? new NodeType(type.name, newProps, type.id, type.flags) : type);
      }
      return new _NodeSet(newTypes);
    }
  };
  var CachedNode = /* @__PURE__ */ new WeakMap();
  var CachedInnerNode = /* @__PURE__ */ new WeakMap();
  var IterMode;
  (function(IterMode2) {
    IterMode2[IterMode2["ExcludeBuffers"] = 1] = "ExcludeBuffers";
    IterMode2[IterMode2["IncludeAnonymous"] = 2] = "IncludeAnonymous";
    IterMode2[IterMode2["IgnoreMounts"] = 4] = "IgnoreMounts";
    IterMode2[IterMode2["IgnoreOverlays"] = 8] = "IgnoreOverlays";
    IterMode2[IterMode2["EnterBracketed"] = 16] = "EnterBracketed";
  })(IterMode || (IterMode = {}));
  var Tree = class _Tree {
    /**
    Construct a new tree. See also [`Tree.build`](#common.Tree^build).
    */
    constructor(type, children, positions, length, props) {
      this.type = type;
      this.children = children;
      this.positions = positions;
      this.length = length;
      this.props = null;
      if (props && props.length) {
        this.props = /* @__PURE__ */ Object.create(null);
        for (let [prop, value] of props)
          this.props[typeof prop == "number" ? prop : prop.id] = value;
      }
    }
    /**
    @internal
    */
    toString() {
      let mounted = MountedTree.get(this);
      if (mounted && !mounted.overlay)
        return mounted.tree.toString();
      let children = "";
      for (let ch of this.children) {
        let str = ch.toString();
        if (str) {
          if (children)
            children += ",";
          children += str;
        }
      }
      return !this.type.name ? children : (/\W/.test(this.type.name) && !this.type.isError ? JSON.stringify(this.type.name) : this.type.name) + (children.length ? "(" + children + ")" : "");
    }
    /**
    Get a [tree cursor](#common.TreeCursor) positioned at the top of
    the tree. Mode can be used to [control](#common.IterMode) which
    nodes the cursor visits.
    */
    cursor(mode = 0) {
      return new TreeCursor(this.topNode, mode);
    }
    /**
    Get a [tree cursor](#common.TreeCursor) pointing into this tree
    at the given position and side (see
    [`moveTo`](#common.TreeCursor.moveTo).
    */
    cursorAt(pos, side = 0, mode = 0) {
      let scope = CachedNode.get(this) || this.topNode;
      let cursor = new TreeCursor(scope);
      cursor.moveTo(pos, side);
      CachedNode.set(this, cursor._tree);
      return cursor;
    }
    /**
    Get a [syntax node](#common.SyntaxNode) object for the top of the
    tree.
    */
    get topNode() {
      return new TreeNode(this, 0, 0, null);
    }
    /**
    Get the [syntax node](#common.SyntaxNode) at the given position.
    If `side` is -1, this will move into nodes that end at the
    position. If 1, it'll move into nodes that start at the
    position. With 0, it'll only enter nodes that cover the position
    from both sides.

    Note that this will not enter
    [overlays](#common.MountedTree.overlay), and you often want
    [`resolveInner`](#common.Tree.resolveInner) instead.
    */
    resolve(pos, side = 0) {
      let node = resolveNode(CachedNode.get(this) || this.topNode, pos, side, false);
      CachedNode.set(this, node);
      return node;
    }
    /**
    Like [`resolve`](#common.Tree.resolve), but will enter
    [overlaid](#common.MountedTree.overlay) nodes, producing a syntax node
    pointing into the innermost overlaid tree at the given position
    (with parent links going through all parent structure, including
    the host trees).
    */
    resolveInner(pos, side = 0) {
      let node = resolveNode(CachedInnerNode.get(this) || this.topNode, pos, side, true);
      CachedInnerNode.set(this, node);
      return node;
    }
    /**
    In some situations, it can be useful to iterate through all
    nodes around a position, including those in overlays that don't
    directly cover the position. This method gives you an iterator
    that will produce all nodes, from small to big, around the given
    position.
    */
    resolveStack(pos, side = 0) {
      return stackIterator(this, pos, side);
    }
    /**
    Iterate over the tree and its children, calling `enter` for any
    node that touches the `from`/`to` region (if given) before
    running over such a node's children, and `leave` (if given) when
    leaving the node. When `enter` returns `false`, that node will
    not have its children iterated over (or `leave` called).
    */
    iterate(spec) {
      let { enter, leave, from = 0, to = this.length } = spec;
      let mode = spec.mode || 0, anon = (mode & IterMode.IncludeAnonymous) > 0;
      for (let c = this.cursor(mode | IterMode.IncludeAnonymous); ; ) {
        let entered = false;
        if (c.from <= to && c.to >= from && (!anon && c.type.isAnonymous || enter(c) !== false)) {
          if (c.firstChild())
            continue;
          entered = true;
        }
        for (; ; ) {
          if (entered && leave && (anon || !c.type.isAnonymous))
            leave(c);
          if (c.nextSibling())
            break;
          if (!c.parent())
            return;
          entered = true;
        }
      }
    }
    /**
    Get the value of the given [node prop](#common.NodeProp) for this
    node. Works with both per-node and per-type props.
    */
    prop(prop) {
      return !prop.perNode ? this.type.prop(prop) : this.props ? this.props[prop.id] : void 0;
    }
    /**
    Returns the node's [per-node props](#common.NodeProp.perNode) in a
    format that can be passed to the [`Tree`](#common.Tree)
    constructor.
    */
    get propValues() {
      let result = [];
      if (this.props)
        for (let id2 in this.props)
          result.push([+id2, this.props[id2]]);
      return result;
    }
    /**
    Balance the direct children of this tree, producing a copy of
    which may have children grouped into subtrees with type
    [`NodeType.none`](#common.NodeType^none).
    */
    balance(config = {}) {
      return this.children.length <= 8 ? this : balanceRange(NodeType.none, this.children, this.positions, 0, this.children.length, 0, this.length, (children, positions, length) => new _Tree(this.type, children, positions, length, this.propValues), config.makeTree || ((children, positions, length) => new _Tree(NodeType.none, children, positions, length)));
    }
    /**
    Build a tree from a postfix-ordered buffer of node information,
    or a cursor over such a buffer.
    */
    static build(data) {
      return buildTree(data);
    }
  };
  Tree.empty = new Tree(NodeType.none, [], [], 0);
  var FlatBufferCursor = class _FlatBufferCursor {
    constructor(buffer, index) {
      this.buffer = buffer;
      this.index = index;
    }
    get id() {
      return this.buffer[this.index - 4];
    }
    get start() {
      return this.buffer[this.index - 3];
    }
    get end() {
      return this.buffer[this.index - 2];
    }
    get size() {
      return this.buffer[this.index - 1];
    }
    get pos() {
      return this.index;
    }
    next() {
      this.index -= 4;
    }
    fork() {
      return new _FlatBufferCursor(this.buffer, this.index);
    }
  };
  var TreeBuffer = class _TreeBuffer {
    /**
    Create a tree buffer.
    */
    constructor(buffer, length, set) {
      this.buffer = buffer;
      this.length = length;
      this.set = set;
    }
    /**
    @internal
    */
    get type() {
      return NodeType.none;
    }
    /**
    @internal
    */
    toString() {
      let result = [];
      for (let index = 0; index < this.buffer.length; ) {
        result.push(this.childString(index));
        index = this.buffer[index + 3];
      }
      return result.join(",");
    }
    /**
    @internal
    */
    childString(index) {
      let id2 = this.buffer[index], endIndex = this.buffer[index + 3];
      let type = this.set.types[id2], result = type.name;
      if (/\W/.test(result) && !type.isError)
        result = JSON.stringify(result);
      index += 4;
      if (endIndex == index)
        return result;
      let children = [];
      while (index < endIndex) {
        children.push(this.childString(index));
        index = this.buffer[index + 3];
      }
      return result + "(" + children.join(",") + ")";
    }
    /**
    @internal
    */
    findChild(startIndex, endIndex, dir, pos, side) {
      let { buffer } = this, pick = -1;
      for (let i = startIndex; i != endIndex; i = buffer[i + 3]) {
        if (checkSide(side, pos, buffer[i + 1], buffer[i + 2])) {
          pick = i;
          if (dir > 0)
            break;
        }
      }
      return pick;
    }
    /**
    @internal
    */
    slice(startI, endI, from) {
      let b = this.buffer;
      let copy = new Uint16Array(endI - startI), len = 0;
      for (let i = startI, j = 0; i < endI; ) {
        copy[j++] = b[i++];
        copy[j++] = b[i++] - from;
        let to = copy[j++] = b[i++] - from;
        copy[j++] = b[i++] - startI;
        len = Math.max(len, to);
      }
      return new _TreeBuffer(copy, len, this.set);
    }
  };
  function checkSide(side, pos, from, to) {
    switch (side) {
      case -2:
        return from < pos;
      case -1:
        return to >= pos && from < pos;
      case 0:
        return from < pos && to > pos;
      case 1:
        return from <= pos && to > pos;
      case 2:
        return to > pos;
      case 4:
        return true;
    }
  }
  function resolveNode(node, pos, side, overlays) {
    var _a;
    while (node.from == node.to || (side < 1 ? node.from >= pos : node.from > pos) || (side > -1 ? node.to <= pos : node.to < pos)) {
      let parent = !overlays && node instanceof TreeNode && node.index < 0 ? null : node.parent;
      if (!parent)
        return node;
      node = parent;
    }
    let mode = overlays ? 0 : IterMode.IgnoreOverlays;
    if (overlays)
      for (let scan = node, parent = scan.parent; parent; scan = parent, parent = scan.parent) {
        if (scan instanceof TreeNode && scan.index < 0 && ((_a = parent.enter(pos, side, mode)) === null || _a === void 0 ? void 0 : _a.from) != scan.from)
          node = parent;
      }
    for (; ; ) {
      let inner = node.enter(pos, side, mode);
      if (!inner)
        return node;
      node = inner;
    }
  }
  var BaseNode = class {
    cursor(mode = 0) {
      return new TreeCursor(this, mode);
    }
    getChild(type, before = null, after = null) {
      let r = getChildren(this, type, before, after);
      return r.length ? r[0] : null;
    }
    getChildren(type, before = null, after = null) {
      return getChildren(this, type, before, after);
    }
    resolve(pos, side = 0) {
      return resolveNode(this, pos, side, false);
    }
    resolveInner(pos, side = 0) {
      return resolveNode(this, pos, side, true);
    }
    matchContext(context) {
      return matchNodeContext(this.parent, context);
    }
    enterUnfinishedNodesBefore(pos) {
      let scan = this.childBefore(pos), node = this;
      while (scan) {
        let last = scan.lastChild;
        if (!last || last.to != scan.to)
          break;
        if (last.type.isError && last.from == last.to) {
          node = scan;
          scan = last.prevSibling;
        } else {
          scan = last;
        }
      }
      return node;
    }
    get node() {
      return this;
    }
    get next() {
      return this.parent;
    }
  };
  var TreeNode = class _TreeNode extends BaseNode {
    constructor(_tree, from, index, _parent) {
      super();
      this._tree = _tree;
      this.from = from;
      this.index = index;
      this._parent = _parent;
    }
    get type() {
      return this._tree.type;
    }
    get name() {
      return this._tree.type.name;
    }
    get to() {
      return this.from + this._tree.length;
    }
    nextChild(i, dir, pos, side, mode = 0) {
      for (let parent = this; ; ) {
        for (let { children, positions } = parent._tree, e = dir > 0 ? children.length : -1; i != e; i += dir) {
          let next = children[i], start = positions[i] + parent.from, mounted;
          if (!(mode & IterMode.EnterBracketed && next instanceof Tree && (mounted = MountedTree.get(next)) && !mounted.overlay && mounted.bracketed && pos >= start && pos <= start + next.length) && !checkSide(side, pos, start, start + next.length))
            continue;
          if (next instanceof TreeBuffer) {
            if (mode & IterMode.ExcludeBuffers)
              continue;
            let index = next.findChild(0, next.buffer.length, dir, pos - start, side);
            if (index > -1)
              return new BufferNode(new BufferContext(parent, next, i, start), null, index);
          } else if (mode & IterMode.IncludeAnonymous || (!next.type.isAnonymous || hasChild(next))) {
            let mounted2;
            if (!(mode & IterMode.IgnoreMounts) && (mounted2 = MountedTree.get(next)) && !mounted2.overlay)
              return new _TreeNode(mounted2.tree, start, i, parent);
            let inner = new _TreeNode(next, start, i, parent);
            return mode & IterMode.IncludeAnonymous || !inner.type.isAnonymous ? inner : inner.nextChild(dir < 0 ? next.children.length - 1 : 0, dir, pos, side, mode);
          }
        }
        if (mode & IterMode.IncludeAnonymous || !parent.type.isAnonymous)
          return null;
        if (parent.index >= 0)
          i = parent.index + dir;
        else
          i = dir < 0 ? -1 : parent._parent._tree.children.length;
        parent = parent._parent;
        if (!parent)
          return null;
      }
    }
    get firstChild() {
      return this.nextChild(
        0,
        1,
        0,
        4
        /* Side.DontCare */
      );
    }
    get lastChild() {
      return this.nextChild(
        this._tree.children.length - 1,
        -1,
        0,
        4
        /* Side.DontCare */
      );
    }
    childAfter(pos) {
      return this.nextChild(
        0,
        1,
        pos,
        2
        /* Side.After */
      );
    }
    childBefore(pos) {
      return this.nextChild(
        this._tree.children.length - 1,
        -1,
        pos,
        -2
        /* Side.Before */
      );
    }
    prop(prop) {
      return this._tree.prop(prop);
    }
    enter(pos, side, mode = 0) {
      let mounted;
      if (!(mode & IterMode.IgnoreOverlays) && (mounted = MountedTree.get(this._tree)) && mounted.overlay) {
        let rPos = pos - this.from, enterBracketed = mode & IterMode.EnterBracketed && mounted.bracketed;
        for (let { from, to } of mounted.overlay) {
          if ((side > 0 || enterBracketed ? from <= rPos : from < rPos) && (side < 0 || enterBracketed ? to >= rPos : to > rPos))
            return new _TreeNode(mounted.tree, mounted.overlay[0].from + this.from, -1, this);
        }
      }
      return this.nextChild(0, 1, pos, side, mode);
    }
    nextSignificantParent() {
      let val = this;
      while (val.type.isAnonymous && val._parent)
        val = val._parent;
      return val;
    }
    get parent() {
      return this._parent ? this._parent.nextSignificantParent() : null;
    }
    get nextSibling() {
      return this._parent && this.index >= 0 ? this._parent.nextChild(
        this.index + 1,
        1,
        0,
        4
        /* Side.DontCare */
      ) : null;
    }
    get prevSibling() {
      return this._parent && this.index >= 0 ? this._parent.nextChild(
        this.index - 1,
        -1,
        0,
        4
        /* Side.DontCare */
      ) : null;
    }
    get tree() {
      return this._tree;
    }
    toTree() {
      return this._tree;
    }
    /**
    @internal
    */
    toString() {
      return this._tree.toString();
    }
  };
  function getChildren(node, type, before, after) {
    let cur = node.cursor(), result = [];
    if (!cur.firstChild())
      return result;
    if (before != null)
      for (let found = false; !found; ) {
        found = cur.type.is(before);
        if (!cur.nextSibling())
          return result;
      }
    for (; ; ) {
      if (after != null && cur.type.is(after))
        return result;
      if (cur.type.is(type))
        result.push(cur.node);
      if (!cur.nextSibling())
        return after == null ? result : [];
    }
  }
  function matchNodeContext(node, context, i = context.length - 1) {
    for (let p = node; i >= 0; p = p.parent) {
      if (!p)
        return false;
      if (!p.type.isAnonymous) {
        if (context[i] && context[i] != p.name)
          return false;
        i--;
      }
    }
    return true;
  }
  var BufferContext = class {
    constructor(parent, buffer, index, start) {
      this.parent = parent;
      this.buffer = buffer;
      this.index = index;
      this.start = start;
    }
  };
  var BufferNode = class _BufferNode extends BaseNode {
    get name() {
      return this.type.name;
    }
    get from() {
      return this.context.start + this.context.buffer.buffer[this.index + 1];
    }
    get to() {
      return this.context.start + this.context.buffer.buffer[this.index + 2];
    }
    constructor(context, _parent, index) {
      super();
      this.context = context;
      this._parent = _parent;
      this.index = index;
      this.type = context.buffer.set.types[context.buffer.buffer[index]];
    }
    child(dir, pos, side) {
      let { buffer } = this.context;
      let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], dir, pos - this.context.start, side);
      return index < 0 ? null : new _BufferNode(this.context, this, index);
    }
    get firstChild() {
      return this.child(
        1,
        0,
        4
        /* Side.DontCare */
      );
    }
    get lastChild() {
      return this.child(
        -1,
        0,
        4
        /* Side.DontCare */
      );
    }
    childAfter(pos) {
      return this.child(
        1,
        pos,
        2
        /* Side.After */
      );
    }
    childBefore(pos) {
      return this.child(
        -1,
        pos,
        -2
        /* Side.Before */
      );
    }
    prop(prop) {
      return this.type.prop(prop);
    }
    enter(pos, side, mode = 0) {
      if (mode & IterMode.ExcludeBuffers)
        return null;
      let { buffer } = this.context;
      let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], side > 0 ? 1 : -1, pos - this.context.start, side);
      return index < 0 ? null : new _BufferNode(this.context, this, index);
    }
    get parent() {
      return this._parent || this.context.parent.nextSignificantParent();
    }
    externalSibling(dir) {
      return this._parent ? null : this.context.parent.nextChild(
        this.context.index + dir,
        dir,
        0,
        4
        /* Side.DontCare */
      );
    }
    get nextSibling() {
      let { buffer } = this.context;
      let after = buffer.buffer[this.index + 3];
      if (after < (this._parent ? buffer.buffer[this._parent.index + 3] : buffer.buffer.length))
        return new _BufferNode(this.context, this._parent, after);
      return this.externalSibling(1);
    }
    get prevSibling() {
      let { buffer } = this.context;
      let parentStart = this._parent ? this._parent.index + 4 : 0;
      if (this.index == parentStart)
        return this.externalSibling(-1);
      return new _BufferNode(this.context, this._parent, buffer.findChild(
        parentStart,
        this.index,
        -1,
        0,
        4
        /* Side.DontCare */
      ));
    }
    get tree() {
      return null;
    }
    toTree() {
      let children = [], positions = [];
      let { buffer } = this.context;
      let startI = this.index + 4, endI = buffer.buffer[this.index + 3];
      if (endI > startI) {
        let from = buffer.buffer[this.index + 1];
        children.push(buffer.slice(startI, endI, from));
        positions.push(0);
      }
      return new Tree(this.type, children, positions, this.to - this.from);
    }
    /**
    @internal
    */
    toString() {
      return this.context.buffer.childString(this.index);
    }
  };
  function iterStack(heads) {
    if (!heads.length)
      return null;
    let pick = 0, picked = heads[0];
    for (let i = 1; i < heads.length; i++) {
      let node = heads[i];
      if (node.from > picked.from || node.to < picked.to) {
        picked = node;
        pick = i;
      }
    }
    let next = picked instanceof TreeNode && picked.index < 0 ? null : picked.parent;
    let newHeads = heads.slice();
    if (next)
      newHeads[pick] = next;
    else
      newHeads.splice(pick, 1);
    return new StackIterator(newHeads, picked);
  }
  var StackIterator = class {
    constructor(heads, node) {
      this.heads = heads;
      this.node = node;
    }
    get next() {
      return iterStack(this.heads);
    }
  };
  function stackIterator(tree, pos, side) {
    let inner = tree.resolveInner(pos, side), layers = null;
    for (let scan = inner instanceof TreeNode ? inner : inner.context.parent; scan; scan = scan.parent) {
      if (scan.index < 0) {
        let parent = scan.parent;
        (layers || (layers = [inner])).push(parent.resolve(pos, side));
        scan = parent;
      } else {
        let mount = MountedTree.get(scan.tree);
        if (mount && mount.overlay && mount.overlay[0].from <= pos && mount.overlay[mount.overlay.length - 1].to >= pos) {
          let root = new TreeNode(mount.tree, mount.overlay[0].from + scan.from, -1, scan);
          (layers || (layers = [inner])).push(resolveNode(root, pos, side, false));
        }
      }
    }
    return layers ? iterStack(layers) : inner;
  }
  var TreeCursor = class {
    /**
    Shorthand for `.type.name`.
    */
    get name() {
      return this.type.name;
    }
    /**
    @internal
    */
    constructor(node, mode = 0) {
      this.buffer = null;
      this.stack = [];
      this.index = 0;
      this.bufferNode = null;
      this.mode = mode & ~IterMode.EnterBracketed;
      if (node instanceof TreeNode) {
        this.yieldNode(node);
      } else {
        this._tree = node.context.parent;
        this.buffer = node.context;
        for (let n = node._parent; n; n = n._parent)
          this.stack.unshift(n.index);
        this.bufferNode = node;
        this.yieldBuf(node.index);
      }
    }
    yieldNode(node) {
      if (!node)
        return false;
      this._tree = node;
      this.type = node.type;
      this.from = node.from;
      this.to = node.to;
      return true;
    }
    yieldBuf(index, type) {
      this.index = index;
      let { start, buffer } = this.buffer;
      this.type = type || buffer.set.types[buffer.buffer[index]];
      this.from = start + buffer.buffer[index + 1];
      this.to = start + buffer.buffer[index + 2];
      return true;
    }
    /**
    @internal
    */
    yield(node) {
      if (!node)
        return false;
      if (node instanceof TreeNode) {
        this.buffer = null;
        return this.yieldNode(node);
      }
      this.buffer = node.context;
      return this.yieldBuf(node.index, node.type);
    }
    /**
    @internal
    */
    toString() {
      return this.buffer ? this.buffer.buffer.childString(this.index) : this._tree.toString();
    }
    /**
    @internal
    */
    enterChild(dir, pos, side) {
      if (!this.buffer)
        return this.yield(this._tree.nextChild(dir < 0 ? this._tree._tree.children.length - 1 : 0, dir, pos, side, this.mode));
      let { buffer } = this.buffer;
      let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], dir, pos - this.buffer.start, side);
      if (index < 0)
        return false;
      this.stack.push(this.index);
      return this.yieldBuf(index);
    }
    /**
    Move the cursor to this node's first child. When this returns
    false, the node has no child, and the cursor has not been moved.
    */
    firstChild() {
      return this.enterChild(
        1,
        0,
        4
        /* Side.DontCare */
      );
    }
    /**
    Move the cursor to this node's last child.
    */
    lastChild() {
      return this.enterChild(
        -1,
        0,
        4
        /* Side.DontCare */
      );
    }
    /**
    Move the cursor to the first child that ends after `pos`.
    */
    childAfter(pos) {
      return this.enterChild(
        1,
        pos,
        2
        /* Side.After */
      );
    }
    /**
    Move to the last child that starts before `pos`.
    */
    childBefore(pos) {
      return this.enterChild(
        -1,
        pos,
        -2
        /* Side.Before */
      );
    }
    /**
    Move the cursor to the child around `pos`. If side is -1 the
    child may end at that position, when 1 it may start there. This
    will also enter [overlaid](#common.MountedTree.overlay)
    [mounted](#common.NodeProp^mounted) trees unless `overlays` is
    set to false.
    */
    enter(pos, side, mode = this.mode) {
      if (!this.buffer)
        return this.yield(this._tree.enter(pos, side, mode));
      return mode & IterMode.ExcludeBuffers ? false : this.enterChild(1, pos, side);
    }
    /**
    Move to the node's parent node, if this isn't the top node.
    */
    parent() {
      if (!this.buffer)
        return this.yieldNode(this.mode & IterMode.IncludeAnonymous ? this._tree._parent : this._tree.parent);
      if (this.stack.length)
        return this.yieldBuf(this.stack.pop());
      let parent = this.mode & IterMode.IncludeAnonymous ? this.buffer.parent : this.buffer.parent.nextSignificantParent();
      this.buffer = null;
      return this.yieldNode(parent);
    }
    /**
    @internal
    */
    sibling(dir) {
      if (!this.buffer)
        return !this._tree._parent ? false : this.yield(this._tree.index < 0 ? null : this._tree._parent.nextChild(this._tree.index + dir, dir, 0, 4, this.mode));
      let { buffer } = this.buffer, d = this.stack.length - 1;
      if (dir < 0) {
        let parentStart = d < 0 ? 0 : this.stack[d] + 4;
        if (this.index != parentStart)
          return this.yieldBuf(buffer.findChild(
            parentStart,
            this.index,
            -1,
            0,
            4
            /* Side.DontCare */
          ));
      } else {
        let after = buffer.buffer[this.index + 3];
        if (after < (d < 0 ? buffer.buffer.length : buffer.buffer[this.stack[d] + 3]))
          return this.yieldBuf(after);
      }
      return d < 0 ? this.yield(this.buffer.parent.nextChild(this.buffer.index + dir, dir, 0, 4, this.mode)) : false;
    }
    /**
    Move to this node's next sibling, if any.
    */
    nextSibling() {
      return this.sibling(1);
    }
    /**
    Move to this node's previous sibling, if any.
    */
    prevSibling() {
      return this.sibling(-1);
    }
    atLastNode(dir) {
      let index, parent, { buffer } = this;
      if (buffer) {
        if (dir > 0) {
          if (this.index < buffer.buffer.buffer.length)
            return false;
        } else {
          for (let i = 0; i < this.index; i++)
            if (buffer.buffer.buffer[i + 3] < this.index)
              return false;
        }
        ({ index, parent } = buffer);
      } else {
        ({ index, _parent: parent } = this._tree);
      }
      for (; parent; { index, _parent: parent } = parent) {
        if (index > -1)
          for (let i = index + dir, e = dir < 0 ? -1 : parent._tree.children.length; i != e; i += dir) {
            let child = parent._tree.children[i];
            if (this.mode & IterMode.IncludeAnonymous || child instanceof TreeBuffer || !child.type.isAnonymous || hasChild(child))
              return false;
          }
      }
      return true;
    }
    move(dir, enter) {
      if (enter && this.enterChild(
        dir,
        0,
        4
        /* Side.DontCare */
      ))
        return true;
      for (; ; ) {
        if (this.sibling(dir))
          return true;
        if (this.atLastNode(dir) || !this.parent())
          return false;
      }
    }
    /**
    Move to the next node in a
    [pre-order](https://en.wikipedia.org/wiki/Tree_traversal#Pre-order,_NLR)
    traversal, going from a node to its first child or, if the
    current node is empty or `enter` is false, its next sibling or
    the next sibling of the first parent node that has one.
    */
    next(enter = true) {
      return this.move(1, enter);
    }
    /**
    Move to the next node in a last-to-first pre-order traversal. A
    node is followed by its last child or, if it has none, its
    previous sibling or the previous sibling of the first parent
    node that has one.
    */
    prev(enter = true) {
      return this.move(-1, enter);
    }
    /**
    Move the cursor to the innermost node that covers `pos`. If
    `side` is -1, it will enter nodes that end at `pos`. If it is 1,
    it will enter nodes that start at `pos`.
    */
    moveTo(pos, side = 0) {
      while (this.from == this.to || (side < 1 ? this.from >= pos : this.from > pos) || (side > -1 ? this.to <= pos : this.to < pos))
        if (!this.parent())
          break;
      while (this.enterChild(1, pos, side)) {
      }
      return this;
    }
    /**
    Get a [syntax node](#common.SyntaxNode) at the cursor's current
    position.
    */
    get node() {
      if (!this.buffer)
        return this._tree;
      let cache = this.bufferNode, result = null, depth = 0;
      if (cache && cache.context == this.buffer) {
        scan: for (let index = this.index, d = this.stack.length; d >= 0; ) {
          for (let c = cache; c; c = c._parent)
            if (c.index == index) {
              if (index == this.index)
                return c;
              result = c;
              depth = d + 1;
              break scan;
            }
          index = this.stack[--d];
        }
      }
      for (let i = depth; i < this.stack.length; i++)
        result = new BufferNode(this.buffer, result, this.stack[i]);
      return this.bufferNode = new BufferNode(this.buffer, result, this.index);
    }
    /**
    Get the [tree](#common.Tree) that represents the current node, if
    any. Will return null when the node is in a [tree
    buffer](#common.TreeBuffer).
    */
    get tree() {
      return this.buffer ? null : this._tree._tree;
    }
    /**
    Iterate over the current node and all its descendants, calling
    `enter` when entering a node and `leave`, if given, when leaving
    one. When `enter` returns `false`, any children of that node are
    skipped, and `leave` isn't called for it.
    */
    iterate(enter, leave) {
      for (let depth = 0; ; ) {
        let mustLeave = false;
        if (this.type.isAnonymous || enter(this) !== false) {
          if (this.firstChild()) {
            depth++;
            continue;
          }
          if (!this.type.isAnonymous)
            mustLeave = true;
        }
        for (; ; ) {
          if (mustLeave && leave)
            leave(this);
          mustLeave = this.type.isAnonymous;
          if (!depth)
            return;
          if (this.nextSibling())
            break;
          this.parent();
          depth--;
          mustLeave = true;
        }
      }
    }
    /**
    Test whether the current node matches a given context—a sequence
    of direct parent node names. Empty strings in the context array
    are treated as wildcards.
    */
    matchContext(context) {
      if (!this.buffer)
        return matchNodeContext(this.node.parent, context);
      let { buffer } = this.buffer, { types } = buffer.set;
      for (let i = context.length - 1, d = this.stack.length - 1; i >= 0; d--) {
        if (d < 0)
          return matchNodeContext(this._tree, context, i);
        let type = types[buffer.buffer[this.stack[d]]];
        if (!type.isAnonymous) {
          if (context[i] && context[i] != type.name)
            return false;
          i--;
        }
      }
      return true;
    }
  };
  function hasChild(tree) {
    return tree.children.some((ch) => ch instanceof TreeBuffer || !ch.type.isAnonymous || hasChild(ch));
  }
  function buildTree(data) {
    var _a;
    let { buffer, nodeSet, maxBufferLength = DefaultBufferLength, reused = [], minRepeatType = nodeSet.types.length } = data;
    let cursor = Array.isArray(buffer) ? new FlatBufferCursor(buffer, buffer.length) : buffer;
    let types = nodeSet.types;
    let contextHash = 0, lookAhead = 0;
    function takeNode(parentStart, minPos, children2, positions2, inRepeat, depth) {
      let { id: id2, start, end, size } = cursor;
      let lookAheadAtStart = lookAhead, contextAtStart = contextHash;
      if (size < 0) {
        cursor.next();
        if (size == -1) {
          let node2 = reused[id2];
          children2.push(node2);
          positions2.push(start - parentStart);
          return;
        } else if (size == -3) {
          contextHash = id2;
          return;
        } else if (size == -4) {
          lookAhead = id2;
          return;
        } else {
          throw new RangeError(`Unrecognized record size: ${size}`);
        }
      }
      let type = types[id2], node, buffer2;
      let startPos = start - parentStart;
      if (end - start <= maxBufferLength && (buffer2 = findBufferSize(cursor.pos - minPos, inRepeat))) {
        let data2 = new Uint16Array(buffer2.size - buffer2.skip);
        let endPos = cursor.pos - buffer2.size, index = data2.length;
        while (cursor.pos > endPos)
          index = copyToBuffer(buffer2.start, data2, index);
        node = new TreeBuffer(data2, end - buffer2.start, nodeSet);
        startPos = buffer2.start - parentStart;
      } else {
        let endPos = cursor.pos - size;
        cursor.next();
        let localChildren = [], localPositions = [];
        let localInRepeat = id2 >= minRepeatType ? id2 : -1;
        let lastGroup = 0, lastEnd = end;
        while (cursor.pos > endPos) {
          if (localInRepeat >= 0 && cursor.id == localInRepeat && cursor.size >= 0) {
            if (cursor.end <= lastEnd - maxBufferLength) {
              makeRepeatLeaf(localChildren, localPositions, start, lastGroup, cursor.end, lastEnd, localInRepeat, lookAheadAtStart, contextAtStart);
              lastGroup = localChildren.length;
              lastEnd = cursor.end;
            }
            cursor.next();
          } else if (depth > 2500) {
            takeFlatNode(start, endPos, localChildren, localPositions);
          } else {
            takeNode(start, endPos, localChildren, localPositions, localInRepeat, depth + 1);
          }
        }
        if (localInRepeat >= 0 && lastGroup > 0 && lastGroup < localChildren.length)
          makeRepeatLeaf(localChildren, localPositions, start, lastGroup, start, lastEnd, localInRepeat, lookAheadAtStart, contextAtStart);
        localChildren.reverse();
        localPositions.reverse();
        if (localInRepeat > -1 && lastGroup > 0) {
          let make = makeBalanced(type, contextAtStart);
          node = balanceRange(type, localChildren, localPositions, 0, localChildren.length, 0, end - start, make, make);
        } else {
          node = makeTree(type, localChildren, localPositions, end - start, lookAheadAtStart - end, contextAtStart);
        }
      }
      children2.push(node);
      positions2.push(startPos);
    }
    function takeFlatNode(parentStart, minPos, children2, positions2) {
      let nodes = [];
      let nodeCount = 0, stopAt = -1;
      while (cursor.pos > minPos) {
        let { id: id2, start, end, size } = cursor;
        if (size > 4) {
          cursor.next();
        } else if (stopAt > -1 && start < stopAt) {
          break;
        } else {
          if (stopAt < 0)
            stopAt = end - maxBufferLength;
          nodes.push(id2, start, end);
          nodeCount++;
          cursor.next();
        }
      }
      if (nodeCount) {
        let buffer2 = new Uint16Array(nodeCount * 4);
        let start = nodes[nodes.length - 2];
        for (let i = nodes.length - 3, j = 0; i >= 0; i -= 3) {
          buffer2[j++] = nodes[i];
          buffer2[j++] = nodes[i + 1] - start;
          buffer2[j++] = nodes[i + 2] - start;
          buffer2[j++] = j;
        }
        children2.push(new TreeBuffer(buffer2, nodes[2] - start, nodeSet));
        positions2.push(start - parentStart);
      }
    }
    function makeBalanced(type, contextHash2) {
      return (children2, positions2, length2) => {
        let lookAhead2 = 0, lastI = children2.length - 1, last, lookAheadProp;
        if (lastI >= 0 && (last = children2[lastI]) instanceof Tree) {
          if (!lastI && last.type == type && last.length == length2)
            return last;
          if (lookAheadProp = last.prop(NodeProp.lookAhead))
            lookAhead2 = positions2[lastI] + last.length + lookAheadProp;
        }
        return makeTree(type, children2, positions2, length2, lookAhead2, contextHash2);
      };
    }
    function makeRepeatLeaf(children2, positions2, base, i, from, to, type, lookAhead2, contextHash2) {
      let localChildren = [], localPositions = [];
      while (children2.length > i) {
        localChildren.push(children2.pop());
        localPositions.push(positions2.pop() + base - from);
      }
      children2.push(makeTree(nodeSet.types[type], localChildren, localPositions, to - from, lookAhead2 - to, contextHash2));
      positions2.push(from - base);
    }
    function makeTree(type, children2, positions2, length2, lookAhead2, contextHash2, props) {
      if (contextHash2) {
        let pair2 = [NodeProp.contextHash, contextHash2];
        props = props ? [pair2].concat(props) : [pair2];
      }
      if (lookAhead2 > 25) {
        let pair2 = [NodeProp.lookAhead, lookAhead2];
        props = props ? [pair2].concat(props) : [pair2];
      }
      return new Tree(type, children2, positions2, length2, props);
    }
    function findBufferSize(maxSize, inRepeat) {
      let fork = cursor.fork();
      let size = 0, start = 0, skip = 0, minStart = fork.end - maxBufferLength;
      let result = { size: 0, start: 0, skip: 0 };
      scan: for (let minPos = fork.pos - maxSize; fork.pos > minPos; ) {
        let nodeSize2 = fork.size;
        if (fork.id == inRepeat && nodeSize2 >= 0) {
          result.size = size;
          result.start = start;
          result.skip = skip;
          skip += 4;
          size += 4;
          fork.next();
          continue;
        }
        let startPos = fork.pos - nodeSize2;
        if (nodeSize2 < 0 || startPos < minPos || fork.start < minStart)
          break;
        let localSkipped = fork.id >= minRepeatType ? 4 : 0;
        let nodeStart = fork.start;
        fork.next();
        while (fork.pos > startPos) {
          if (fork.size < 0) {
            if (fork.size == -3 || fork.size == -4)
              localSkipped += 4;
            else
              break scan;
          } else if (fork.id >= minRepeatType) {
            localSkipped += 4;
          }
          fork.next();
        }
        start = nodeStart;
        size += nodeSize2;
        skip += localSkipped;
      }
      if (inRepeat < 0 || size == maxSize) {
        result.size = size;
        result.start = start;
        result.skip = skip;
      }
      return result.size > 4 ? result : void 0;
    }
    function copyToBuffer(bufferStart, buffer2, index) {
      let { id: id2, start, end, size } = cursor;
      cursor.next();
      if (size >= 0 && id2 < minRepeatType) {
        let startIndex = index;
        if (size > 4) {
          let endPos = cursor.pos - (size - 4);
          while (cursor.pos > endPos)
            index = copyToBuffer(bufferStart, buffer2, index);
        }
        buffer2[--index] = startIndex;
        buffer2[--index] = end - bufferStart;
        buffer2[--index] = start - bufferStart;
        buffer2[--index] = id2;
      } else if (size == -3) {
        contextHash = id2;
      } else if (size == -4) {
        lookAhead = id2;
      }
      return index;
    }
    let children = [], positions = [];
    while (cursor.pos > 0)
      takeNode(data.start || 0, data.bufferStart || 0, children, positions, -1, 0);
    let length = (_a = data.length) !== null && _a !== void 0 ? _a : children.length ? positions[0] + children[0].length : 0;
    return new Tree(types[data.topID], children.reverse(), positions.reverse(), length);
  }
  var nodeSizeCache = /* @__PURE__ */ new WeakMap();
  function nodeSize(balanceType, node) {
    if (!balanceType.isAnonymous || node instanceof TreeBuffer || node.type != balanceType)
      return 1;
    let size = nodeSizeCache.get(node);
    if (size == null) {
      size = 1;
      for (let child of node.children) {
        if (child.type != balanceType || !(child instanceof Tree)) {
          size = 1;
          break;
        }
        size += nodeSize(balanceType, child);
      }
      nodeSizeCache.set(node, size);
    }
    return size;
  }
  function balanceRange(balanceType, children, positions, from, to, start, length, mkTop, mkTree) {
    let total = 0;
    for (let i = from; i < to; i++)
      total += nodeSize(balanceType, children[i]);
    let maxChild = Math.ceil(
      total * 1.5 / 8
      /* Balance.BranchFactor */
    );
    let localChildren = [], localPositions = [];
    function divide(children2, positions2, from2, to2, offset) {
      for (let i = from2; i < to2; ) {
        let groupFrom = i, groupStart = positions2[i], groupSize = nodeSize(balanceType, children2[i]);
        i++;
        for (; i < to2; i++) {
          let nextSize = nodeSize(balanceType, children2[i]);
          if (groupSize + nextSize >= maxChild)
            break;
          groupSize += nextSize;
        }
        if (i == groupFrom + 1) {
          if (groupSize > maxChild) {
            let only = children2[groupFrom];
            divide(only.children, only.positions, 0, only.children.length, positions2[groupFrom] + offset);
            continue;
          }
          localChildren.push(children2[groupFrom]);
        } else {
          let length2 = positions2[i - 1] + children2[i - 1].length - groupStart;
          localChildren.push(balanceRange(balanceType, children2, positions2, groupFrom, i, groupStart, length2, null, mkTree));
        }
        localPositions.push(groupStart + offset - start);
      }
    }
    divide(children, positions, from, to, 0);
    return (mkTop || mkTree)(localChildren, localPositions, length);
  }
  var TreeFragment = class _TreeFragment {
    /**
    Construct a tree fragment. You'll usually want to use
    [`addTree`](#common.TreeFragment^addTree) and
    [`applyChanges`](#common.TreeFragment^applyChanges) instead of
    calling this directly.
    */
    constructor(from, to, tree, offset, openStart = false, openEnd = false) {
      this.from = from;
      this.to = to;
      this.tree = tree;
      this.offset = offset;
      this.open = (openStart ? 1 : 0) | (openEnd ? 2 : 0);
    }
    /**
    Whether the start of the fragment represents the start of a
    parse, or the end of a change. (In the second case, it may not
    be safe to reuse some nodes at the start, depending on the
    parsing algorithm.)
    */
    get openStart() {
      return (this.open & 1) > 0;
    }
    /**
    Whether the end of the fragment represents the end of a
    full-document parse, or the start of a change.
    */
    get openEnd() {
      return (this.open & 2) > 0;
    }
    /**
    Create a set of fragments from a freshly parsed tree, or update
    an existing set of fragments by replacing the ones that overlap
    with a tree with content from the new tree. When `partial` is
    true, the parse is treated as incomplete, and the resulting
    fragment has [`openEnd`](#common.TreeFragment.openEnd) set to
    true.
    */
    static addTree(tree, fragments = [], partial = false) {
      let result = [new _TreeFragment(0, tree.length, tree, 0, false, partial)];
      for (let f of fragments)
        if (f.to > tree.length)
          result.push(f);
      return result;
    }
    /**
    Apply a set of edits to an array of fragments, removing or
    splitting fragments as necessary to remove edited ranges, and
    adjusting offsets for fragments that moved.
    */
    static applyChanges(fragments, changes, minGap = 128) {
      if (!changes.length)
        return fragments;
      let result = [];
      let fI = 1, nextF = fragments.length ? fragments[0] : null;
      for (let cI = 0, pos = 0, off = 0; ; cI++) {
        let nextC = cI < changes.length ? changes[cI] : null;
        let nextPos = nextC ? nextC.fromA : 1e9;
        if (nextPos - pos >= minGap)
          while (nextF && nextF.from < nextPos) {
            let cut = nextF;
            if (pos >= cut.from || nextPos <= cut.to || off) {
              let fFrom = Math.max(cut.from, pos) - off, fTo = Math.min(cut.to, nextPos) - off;
              cut = fFrom >= fTo ? null : new _TreeFragment(fFrom, fTo, cut.tree, cut.offset + off, cI > 0, !!nextC);
            }
            if (cut)
              result.push(cut);
            if (nextF.to > nextPos)
              break;
            nextF = fI < fragments.length ? fragments[fI++] : null;
          }
        if (!nextC)
          break;
        pos = nextC.toA;
        off = nextC.toA - nextC.toB;
      }
      return result;
    }
  };
  var Parser = class {
    /**
    Start a parse, returning a [partial parse](#common.PartialParse)
    object. [`fragments`](#common.TreeFragment) can be passed in to
    make the parse incremental.

    By default, the entire input is parsed. You can pass `ranges`,
    which should be a sorted array of non-empty, non-overlapping
    ranges, to parse only those ranges. The tree returned in that
    case will start at `ranges[0].from`.
    */
    startParse(input, fragments, ranges) {
      if (typeof input == "string")
        input = new StringInput(input);
      ranges = !ranges ? [new Range(0, input.length)] : ranges.length ? ranges.map((r) => new Range(r.from, r.to)) : [new Range(0, 0)];
      return this.createParse(input, fragments || [], ranges);
    }
    /**
    Run a full parse, returning the resulting tree.
    */
    parse(input, fragments, ranges) {
      let parse = this.startParse(input, fragments, ranges);
      for (; ; ) {
        let done = parse.advance();
        if (done)
          return done;
      }
    }
  };
  var StringInput = class {
    constructor(string2) {
      this.string = string2;
    }
    get length() {
      return this.string.length;
    }
    chunk(from) {
      return this.string.slice(from);
    }
    get lineChunks() {
      return false;
    }
    read(from, to) {
      return this.string.slice(from, to);
    }
  };
  function parseMixed(nest) {
    return (parse, input, fragments, ranges) => new MixedParse(parse, nest, input, fragments, ranges);
  }
  var InnerParse = class {
    constructor(parser7, parse, overlay, bracketed, target, from) {
      this.parser = parser7;
      this.parse = parse;
      this.overlay = overlay;
      this.bracketed = bracketed;
      this.target = target;
      this.from = from;
    }
  };
  function checkRanges(ranges) {
    if (!ranges.length || ranges.some((r) => r.from >= r.to))
      throw new RangeError("Invalid inner parse ranges given: " + JSON.stringify(ranges));
  }
  var ActiveOverlay = class {
    constructor(parser7, predicate, mounts, index, start, bracketed, target, prev) {
      this.parser = parser7;
      this.predicate = predicate;
      this.mounts = mounts;
      this.index = index;
      this.start = start;
      this.bracketed = bracketed;
      this.target = target;
      this.prev = prev;
      this.depth = 0;
      this.ranges = [];
    }
  };
  var stoppedInner = new NodeProp({ perNode: true });
  var MixedParse = class {
    constructor(base, nest, input, fragments, ranges) {
      this.nest = nest;
      this.input = input;
      this.fragments = fragments;
      this.ranges = ranges;
      this.inner = [];
      this.innerDone = 0;
      this.baseTree = null;
      this.stoppedAt = null;
      this.baseParse = base;
    }
    advance() {
      if (this.baseParse) {
        let done2 = this.baseParse.advance();
        if (!done2)
          return null;
        this.baseParse = null;
        this.baseTree = done2;
        this.startInner();
        if (this.stoppedAt != null)
          for (let inner2 of this.inner)
            inner2.parse.stopAt(this.stoppedAt);
      }
      if (this.innerDone == this.inner.length) {
        let result = this.baseTree;
        if (this.stoppedAt != null)
          result = new Tree(result.type, result.children, result.positions, result.length, result.propValues.concat([[stoppedInner, this.stoppedAt]]));
        return result;
      }
      let inner = this.inner[this.innerDone], done = inner.parse.advance();
      if (done) {
        this.innerDone++;
        let props = Object.assign(/* @__PURE__ */ Object.create(null), inner.target.props);
        props[NodeProp.mounted.id] = new MountedTree(done, inner.overlay, inner.parser, inner.bracketed);
        inner.target.props = props;
      }
      return null;
    }
    get parsedPos() {
      if (this.baseParse)
        return 0;
      let pos = this.input.length;
      for (let i = this.innerDone; i < this.inner.length; i++) {
        if (this.inner[i].from < pos)
          pos = Math.min(pos, this.inner[i].parse.parsedPos);
      }
      return pos;
    }
    stopAt(pos) {
      this.stoppedAt = pos;
      if (this.baseParse)
        this.baseParse.stopAt(pos);
      else
        for (let i = this.innerDone; i < this.inner.length; i++)
          this.inner[i].parse.stopAt(pos);
    }
    startInner() {
      let fragmentCursor = new FragmentCursor(this.fragments);
      let overlay = null;
      let covered = null;
      let cursor = new TreeCursor(new TreeNode(this.baseTree, this.ranges[0].from, 0, null), IterMode.IncludeAnonymous | IterMode.IgnoreMounts);
      scan: for (let nest, isCovered; ; ) {
        let enter = true, range;
        if (this.stoppedAt != null && cursor.from >= this.stoppedAt) {
          enter = false;
        } else if (fragmentCursor.hasNode(cursor)) {
          if (overlay) {
            let match = overlay.mounts.find((m) => m.frag.from <= cursor.from && m.frag.to >= cursor.to && m.mount.overlay);
            if (match)
              for (let r of match.mount.overlay) {
                let from = r.from + match.pos, to = r.to + match.pos;
                if (from >= cursor.from && to <= cursor.to && !overlay.ranges.some((r2) => r2.from < to && r2.to > from))
                  overlay.ranges.push({ from, to });
              }
          }
          enter = false;
        } else if (covered && (isCovered = checkCover(covered.ranges, cursor.from, cursor.to))) {
          enter = isCovered != 2;
        } else if (!cursor.type.isAnonymous && (nest = this.nest(cursor, this.input)) && (cursor.from < cursor.to || !nest.overlay)) {
          if (!cursor.tree) {
            materialize(cursor);
            if (overlay)
              overlay.depth++;
            if (covered)
              covered.depth++;
          }
          let oldMounts = fragmentCursor.findMounts(cursor.from, nest.parser);
          if (typeof nest.overlay == "function") {
            overlay = new ActiveOverlay(nest.parser, nest.overlay, oldMounts, this.inner.length, cursor.from, !!nest.bracketed, cursor.tree, overlay);
          } else {
            let ranges = punchRanges(this.ranges, nest.overlay || (cursor.from < cursor.to ? [new Range(cursor.from, cursor.to)] : []));
            if (ranges.length)
              checkRanges(ranges);
            if (ranges.length || !nest.overlay)
              this.inner.push(new InnerParse(nest.parser, ranges.length ? nest.parser.startParse(this.input, enterFragments(oldMounts, ranges), ranges) : nest.parser.startParse(""), nest.overlay ? nest.overlay.map((r) => new Range(r.from - cursor.from, r.to - cursor.from)) : null, !!nest.bracketed, cursor.tree, ranges.length ? ranges[0].from : cursor.from));
            if (!nest.overlay)
              enter = false;
            else if (ranges.length)
              covered = { ranges, depth: 0, prev: covered };
          }
        } else if (overlay && (range = overlay.predicate(cursor))) {
          if (range === true)
            range = new Range(cursor.from, cursor.to);
          if (range.from < range.to) {
            let last = overlay.ranges.length - 1;
            if (last >= 0 && overlay.ranges[last].to == range.from)
              overlay.ranges[last] = { from: overlay.ranges[last].from, to: range.to };
            else
              overlay.ranges.push(range);
          }
        }
        if (enter && cursor.firstChild()) {
          if (overlay)
            overlay.depth++;
          if (covered)
            covered.depth++;
        } else {
          for (; ; ) {
            if (cursor.nextSibling())
              break;
            if (!cursor.parent())
              break scan;
            if (overlay && !--overlay.depth) {
              let ranges = punchRanges(this.ranges, overlay.ranges);
              if (ranges.length) {
                checkRanges(ranges);
                this.inner.splice(overlay.index, 0, new InnerParse(overlay.parser, overlay.parser.startParse(this.input, enterFragments(overlay.mounts, ranges), ranges), overlay.ranges.map((r) => new Range(r.from - overlay.start, r.to - overlay.start)), overlay.bracketed, overlay.target, ranges[0].from));
              }
              overlay = overlay.prev;
            }
            if (covered && !--covered.depth)
              covered = covered.prev;
          }
        }
      }
    }
  };
  function checkCover(covered, from, to) {
    for (let range of covered) {
      if (range.from >= to)
        break;
      if (range.to > from)
        return range.from <= from && range.to >= to ? 2 : 1;
    }
    return 0;
  }
  function sliceBuf(buf, startI, endI, nodes, positions, off) {
    if (startI < endI) {
      let from = buf.buffer[startI + 1];
      nodes.push(buf.slice(startI, endI, from));
      positions.push(from - off);
    }
  }
  function materialize(cursor) {
    let { node } = cursor, stack = [];
    let buffer = node.context.buffer;
    do {
      stack.push(cursor.index);
      cursor.parent();
    } while (!cursor.tree);
    let base = cursor.tree, i = base.children.indexOf(buffer);
    let buf = base.children[i], b = buf.buffer, newStack = [i];
    function split(startI, endI, type, innerOffset, length, stackPos) {
      let targetI = stack[stackPos];
      let children = [], positions = [];
      sliceBuf(buf, startI, targetI, children, positions, innerOffset);
      let from = b[targetI + 1], to = b[targetI + 2];
      newStack.push(children.length);
      let child = stackPos ? split(targetI + 4, b[targetI + 3], buf.set.types[b[targetI]], from, to - from, stackPos - 1) : node.toTree();
      children.push(child);
      positions.push(from - innerOffset);
      sliceBuf(buf, b[targetI + 3], endI, children, positions, innerOffset);
      return new Tree(type, children, positions, length);
    }
    base.children[i] = split(0, b.length, NodeType.none, 0, buf.length, stack.length - 1);
    for (let index of newStack) {
      let tree = cursor.tree.children[index], pos = cursor.tree.positions[index];
      cursor.yield(new TreeNode(tree, pos + cursor.from, index, cursor._tree));
    }
  }
  var StructureCursor = class {
    constructor(root, offset) {
      this.offset = offset;
      this.done = false;
      this.cursor = root.cursor(IterMode.IncludeAnonymous | IterMode.IgnoreMounts);
    }
    // Move to the first node (in pre-order) that starts at or after `pos`.
    moveTo(pos) {
      let { cursor } = this, p = pos - this.offset;
      while (!this.done && cursor.from < p) {
        if (cursor.to >= pos && cursor.enter(p, 1, IterMode.IgnoreOverlays | IterMode.ExcludeBuffers)) ;
        else if (cursor.to <= pos) {
          if (!cursor.next(false))
            this.done = true;
        } else {
          break;
        }
      }
    }
    hasNode(cursor) {
      this.moveTo(cursor.from);
      if (!this.done && this.cursor.from + this.offset == cursor.from && this.cursor.tree) {
        for (let tree = this.cursor.tree; ; ) {
          if (tree == cursor.tree)
            return true;
          if (tree.children.length && tree.positions[0] == 0 && tree.children[0] instanceof Tree)
            tree = tree.children[0];
          else
            break;
        }
      }
      return false;
    }
  };
  var FragmentCursor = class {
    constructor(fragments) {
      var _a;
      this.fragments = fragments;
      this.curTo = 0;
      this.fragI = 0;
      if (fragments.length) {
        let first = this.curFrag = fragments[0];
        this.curTo = (_a = first.tree.prop(stoppedInner)) !== null && _a !== void 0 ? _a : first.to;
        this.inner = new StructureCursor(first.tree, -first.offset);
      } else {
        this.curFrag = this.inner = null;
      }
    }
    hasNode(node) {
      while (this.curFrag && node.from >= this.curTo)
        this.nextFrag();
      return this.curFrag && this.curFrag.from <= node.from && this.curTo >= node.to && this.inner.hasNode(node);
    }
    nextFrag() {
      var _a;
      this.fragI++;
      if (this.fragI == this.fragments.length) {
        this.curFrag = this.inner = null;
      } else {
        let frag = this.curFrag = this.fragments[this.fragI];
        this.curTo = (_a = frag.tree.prop(stoppedInner)) !== null && _a !== void 0 ? _a : frag.to;
        this.inner = new StructureCursor(frag.tree, -frag.offset);
      }
    }
    findMounts(pos, parser7) {
      var _a;
      let result = [];
      if (this.inner) {
        this.inner.cursor.moveTo(pos, 1);
        for (let pos2 = this.inner.cursor.node; pos2; pos2 = pos2.parent) {
          let mount = (_a = pos2.tree) === null || _a === void 0 ? void 0 : _a.prop(NodeProp.mounted);
          if (mount && mount.parser == parser7) {
            for (let i = this.fragI; i < this.fragments.length; i++) {
              let frag = this.fragments[i];
              if (frag.from >= pos2.to)
                break;
              if (frag.tree == this.curFrag.tree)
                result.push({
                  frag,
                  pos: pos2.from - frag.offset,
                  mount
                });
            }
          }
        }
      }
      return result;
    }
  };
  function punchRanges(outer, ranges) {
    let copy = null, current = ranges;
    for (let i = 1, j = 0; i < outer.length; i++) {
      let gapFrom = outer[i - 1].to, gapTo = outer[i].from;
      for (; j < current.length; j++) {
        let r = current[j];
        if (r.from >= gapTo)
          break;
        if (r.to <= gapFrom)
          continue;
        if (!copy)
          current = copy = ranges.slice();
        if (r.from < gapFrom) {
          copy[j] = new Range(r.from, gapFrom);
          if (r.to > gapTo)
            copy.splice(j + 1, 0, new Range(gapTo, r.to));
        } else if (r.to > gapTo) {
          copy[j--] = new Range(gapTo, r.to);
        } else {
          copy.splice(j--, 1);
        }
      }
    }
    return current;
  }
  function findCoverChanges(a2, b, from, to) {
    let iA = 0, iB = 0, inA = false, inB = false, pos = -1e9;
    let result = [];
    for (; ; ) {
      let nextA = iA == a2.length ? 1e9 : inA ? a2[iA].to : a2[iA].from;
      let nextB = iB == b.length ? 1e9 : inB ? b[iB].to : b[iB].from;
      if (inA != inB) {
        let start = Math.max(pos, from), end = Math.min(nextA, nextB, to);
        if (start < end)
          result.push(new Range(start, end));
      }
      pos = Math.min(nextA, nextB);
      if (pos == 1e9)
        break;
      if (nextA == pos) {
        if (!inA)
          inA = true;
        else {
          inA = false;
          iA++;
        }
      }
      if (nextB == pos) {
        if (!inB)
          inB = true;
        else {
          inB = false;
          iB++;
        }
      }
    }
    return result;
  }
  function enterFragments(mounts, ranges) {
    let result = [];
    for (let { pos, mount, frag } of mounts) {
      let startPos = pos + (mount.overlay ? mount.overlay[0].from : 0), endPos = startPos + mount.tree.length;
      let from = Math.max(frag.from, startPos), to = Math.min(frag.to, endPos);
      if (mount.overlay) {
        let overlay = mount.overlay.map((r) => new Range(r.from + pos, r.to + pos));
        let changes = findCoverChanges(ranges, overlay, from, to);
        for (let i = 0, pos2 = from; ; i++) {
          let last = i == changes.length, end = last ? to : changes[i].from;
          if (end > pos2)
            result.push(new TreeFragment(pos2, end, mount.tree, -startPos, frag.from >= pos2 || frag.openStart, frag.to <= end || frag.openEnd));
          if (last)
            break;
          pos2 = changes[i].to;
        }
      } else {
        result.push(new TreeFragment(from, to, mount.tree, -startPos, frag.from >= startPos || frag.openStart, frag.to <= endPos || frag.openEnd));
      }
    }
    return result;
  }

  // node_modules/@lezer/highlight/dist/index.js
  var nextTagID = 0;
  var Tag = class _Tag {
    /**
    @internal
    */
    constructor(name2, set, base, modified) {
      this.name = name2;
      this.set = set;
      this.base = base;
      this.modified = modified;
      this.id = nextTagID++;
    }
    toString() {
      let { name: name2 } = this;
      for (let mod of this.modified)
        if (mod.name)
          name2 = `${mod.name}(${name2})`;
      return name2;
    }
    static define(nameOrParent, parent) {
      let name2 = typeof nameOrParent == "string" ? nameOrParent : "?";
      if (nameOrParent instanceof _Tag)
        parent = nameOrParent;
      if (parent === null || parent === void 0 ? void 0 : parent.base)
        throw new Error("Can not derive from a modified tag");
      let tag = new _Tag(name2, [], null, []);
      tag.set.push(tag);
      if (parent)
        for (let t2 of parent.set)
          tag.set.push(t2);
      return tag;
    }
    /**
    Define a tag _modifier_, which is a function that, given a tag,
    will return a tag that is a subtag of the original. Applying the
    same modifier to a twice tag will return the same value (`m1(t1)
    == m1(t1)`) and applying multiple modifiers will, regardless or
    order, produce the same tag (`m1(m2(t1)) == m2(m1(t1))`).

    When multiple modifiers are applied to a given base tag, each
    smaller set of modifiers is registered as a parent, so that for
    example `m1(m2(m3(t1)))` is a subtype of `m1(m2(t1))`,
    `m1(m3(t1)`, and so on.
    */
    static defineModifier(name2) {
      let mod = new Modifier(name2);
      return (tag) => {
        if (tag.modified.indexOf(mod) > -1)
          return tag;
        return Modifier.get(tag.base || tag, tag.modified.concat(mod).sort((a2, b) => a2.id - b.id));
      };
    }
  };
  var nextModifierID = 0;
  var Modifier = class _Modifier {
    constructor(name2) {
      this.name = name2;
      this.instances = [];
      this.id = nextModifierID++;
    }
    static get(base, mods) {
      if (!mods.length)
        return base;
      let exists = mods[0].instances.find((t2) => t2.base == base && sameArray(mods, t2.modified));
      if (exists)
        return exists;
      let set = [], tag = new Tag(base.name, set, base, mods);
      for (let m of mods)
        m.instances.push(tag);
      let configs = powerSet(mods);
      for (let parent of base.set)
        if (!parent.modified.length)
          for (let config of configs)
            set.push(_Modifier.get(parent, config));
      return tag;
    }
  };
  function sameArray(a2, b) {
    return a2.length == b.length && a2.every((x, i) => x == b[i]);
  }
  function powerSet(array) {
    let sets = [[]];
    for (let i = 0; i < array.length; i++) {
      for (let j = 0, e = sets.length; j < e; j++) {
        sets.push(sets[j].concat(array[i]));
      }
    }
    return sets.sort((a2, b) => b.length - a2.length);
  }
  function styleTags(spec) {
    let byName = /* @__PURE__ */ Object.create(null);
    for (let prop in spec) {
      let tags2 = spec[prop];
      if (!Array.isArray(tags2))
        tags2 = [tags2];
      for (let part of prop.split(" "))
        if (part) {
          let pieces = [], mode = 2, rest = part;
          for (let pos = 0; ; ) {
            if (rest == "..." && pos > 0 && pos + 3 == part.length) {
              mode = 1;
              break;
            }
            let m = /^"(?:[^"\\]|\\.)*?"|[^\/!]+/.exec(rest);
            if (!m)
              throw new RangeError("Invalid path: " + part);
            pieces.push(m[0] == "*" ? "" : m[0][0] == '"' ? JSON.parse(m[0]) : m[0]);
            pos += m[0].length;
            if (pos == part.length)
              break;
            let next = part[pos++];
            if (pos == part.length && next == "!") {
              mode = 0;
              break;
            }
            if (next != "/")
              throw new RangeError("Invalid path: " + part);
            rest = part.slice(pos);
          }
          let last = pieces.length - 1, inner = pieces[last];
          if (!inner)
            throw new RangeError("Invalid path: " + part);
          let rule = new Rule(tags2, mode, last > 0 ? pieces.slice(0, last) : null);
          byName[inner] = rule.sort(byName[inner]);
        }
    }
    return ruleNodeProp.add(byName);
  }
  var ruleNodeProp = new NodeProp({
    combine(a2, b) {
      let cur, root, take;
      while (a2 || b) {
        if (!a2 || b && a2.depth >= b.depth) {
          take = b;
          b = b.next;
        } else {
          take = a2;
          a2 = a2.next;
        }
        if (cur && cur.mode == take.mode && !take.context && !cur.context)
          continue;
        let copy = new Rule(take.tags, take.mode, take.context);
        if (cur)
          cur.next = copy;
        else
          root = copy;
        cur = copy;
      }
      return root;
    }
  });
  var Rule = class {
    constructor(tags2, mode, context, next) {
      this.tags = tags2;
      this.mode = mode;
      this.context = context;
      this.next = next;
    }
    get opaque() {
      return this.mode == 0;
    }
    get inherit() {
      return this.mode == 1;
    }
    sort(other) {
      if (!other || other.depth < this.depth) {
        this.next = other;
        return this;
      }
      other.next = this.sort(other.next);
      return other;
    }
    get depth() {
      return this.context ? this.context.length : 0;
    }
  };
  Rule.empty = new Rule([], 2, null);
  function tagHighlighter(tags2, options) {
    let map = /* @__PURE__ */ Object.create(null);
    for (let style of tags2) {
      if (!Array.isArray(style.tag))
        map[style.tag.id] = style.class;
      else
        for (let tag of style.tag)
          map[tag.id] = style.class;
    }
    let { scope, all = null } = options || {};
    return {
      style: (tags3) => {
        let cls = all;
        for (let tag of tags3) {
          for (let sub of tag.set) {
            let tagClass = map[sub.id];
            if (tagClass) {
              cls = cls ? cls + " " + tagClass : tagClass;
              break;
            }
          }
        }
        return cls;
      },
      scope
    };
  }
  function highlightTags(highlighters, tags2) {
    let result = null;
    for (let highlighter of highlighters) {
      let value = highlighter.style(tags2);
      if (value)
        result = result ? result + " " + value : value;
    }
    return result;
  }
  function highlightTree(tree, highlighter, putStyle, from = 0, to = tree.length) {
    let builder = new HighlightBuilder(from, Array.isArray(highlighter) ? highlighter : [highlighter], putStyle);
    builder.highlightRange(tree.cursor(), from, to, "", builder.highlighters);
    builder.flush(to);
  }
  var HighlightBuilder = class {
    constructor(at, highlighters, span) {
      this.at = at;
      this.highlighters = highlighters;
      this.span = span;
      this.class = "";
    }
    startSpan(at, cls) {
      if (cls != this.class) {
        this.flush(at);
        if (at > this.at)
          this.at = at;
        this.class = cls;
      }
    }
    flush(to) {
      if (to > this.at && this.class)
        this.span(this.at, to, this.class);
    }
    highlightRange(cursor, from, to, inheritedClass, highlighters) {
      let { type, from: start, to: end } = cursor;
      if (start >= to || end <= from)
        return;
      if (type.isTop)
        highlighters = this.highlighters.filter((h) => !h.scope || h.scope(type));
      let cls = inheritedClass;
      let rule = getStyleTags(cursor) || Rule.empty;
      let tagCls = highlightTags(highlighters, rule.tags);
      if (tagCls) {
        if (cls)
          cls += " ";
        cls += tagCls;
        if (rule.mode == 1)
          inheritedClass += (inheritedClass ? " " : "") + tagCls;
      }
      this.startSpan(Math.max(from, start), cls);
      if (rule.opaque)
        return;
      let mounted = cursor.tree && cursor.tree.prop(NodeProp.mounted);
      if (mounted && mounted.overlay) {
        let inner = cursor.node.enter(mounted.overlay[0].from + start, 1);
        let innerHighlighters = this.highlighters.filter((h) => !h.scope || h.scope(mounted.tree.type));
        let hasChild2 = cursor.firstChild();
        for (let i = 0, pos = start; ; i++) {
          let next = i < mounted.overlay.length ? mounted.overlay[i] : null;
          let nextPos = next ? next.from + start : end;
          let rangeFrom = Math.max(from, pos), rangeTo = Math.min(to, nextPos);
          if (rangeFrom < rangeTo && hasChild2) {
            while (cursor.from < rangeTo) {
              this.highlightRange(cursor, rangeFrom, rangeTo, inheritedClass, highlighters);
              this.startSpan(Math.min(rangeTo, cursor.to), cls);
              if (cursor.to >= nextPos || !cursor.nextSibling())
                break;
            }
          }
          if (!next || nextPos > to)
            break;
          pos = next.to + start;
          if (pos > from) {
            this.highlightRange(inner.cursor(), Math.max(from, next.from + start), Math.min(to, pos), "", innerHighlighters);
            this.startSpan(Math.min(to, pos), cls);
          }
        }
        if (hasChild2)
          cursor.parent();
      } else if (cursor.firstChild()) {
        if (mounted)
          inheritedClass = "";
        do {
          if (cursor.to <= from)
            continue;
          if (cursor.from >= to)
            break;
          this.highlightRange(cursor, from, to, inheritedClass, highlighters);
          this.startSpan(Math.min(to, cursor.to), cls);
        } while (cursor.nextSibling());
        cursor.parent();
      }
    }
  };
  function getStyleTags(node) {
    let rule = node.type.prop(ruleNodeProp);
    while (rule && rule.context && !node.matchContext(rule.context))
      rule = rule.next;
    return rule || null;
  }
  var t = Tag.define;
  var comment = t();
  var name = t();
  var typeName = t(name);
  var propertyName = t(name);
  var literal = t();
  var string = t(literal);
  var number = t(literal);
  var content = t();
  var heading = t(content);
  var keyword = t();
  var operator = t();
  var punctuation = t();
  var bracket = t(punctuation);
  var meta = t();
  var tags = {
    /**
    A comment.
    */
    comment,
    /**
    A line [comment](#highlight.tags.comment).
    */
    lineComment: t(comment),
    /**
    A block [comment](#highlight.tags.comment).
    */
    blockComment: t(comment),
    /**
    A documentation [comment](#highlight.tags.comment).
    */
    docComment: t(comment),
    /**
    Any kind of identifier.
    */
    name,
    /**
    The [name](#highlight.tags.name) of a variable.
    */
    variableName: t(name),
    /**
    A type [name](#highlight.tags.name).
    */
    typeName,
    /**
    A tag name (subtag of [`typeName`](#highlight.tags.typeName)).
    */
    tagName: t(typeName),
    /**
    A property or field [name](#highlight.tags.name).
    */
    propertyName,
    /**
    An attribute name (subtag of [`propertyName`](#highlight.tags.propertyName)).
    */
    attributeName: t(propertyName),
    /**
    The [name](#highlight.tags.name) of a class.
    */
    className: t(name),
    /**
    A label [name](#highlight.tags.name).
    */
    labelName: t(name),
    /**
    A namespace [name](#highlight.tags.name).
    */
    namespace: t(name),
    /**
    The [name](#highlight.tags.name) of a macro.
    */
    macroName: t(name),
    /**
    A literal value.
    */
    literal,
    /**
    A string [literal](#highlight.tags.literal).
    */
    string,
    /**
    A documentation [string](#highlight.tags.string).
    */
    docString: t(string),
    /**
    A character literal (subtag of [string](#highlight.tags.string)).
    */
    character: t(string),
    /**
    An attribute value (subtag of [string](#highlight.tags.string)).
    */
    attributeValue: t(string),
    /**
    A number [literal](#highlight.tags.literal).
    */
    number,
    /**
    An integer [number](#highlight.tags.number) literal.
    */
    integer: t(number),
    /**
    A floating-point [number](#highlight.tags.number) literal.
    */
    float: t(number),
    /**
    A boolean [literal](#highlight.tags.literal).
    */
    bool: t(literal),
    /**
    Regular expression [literal](#highlight.tags.literal).
    */
    regexp: t(literal),
    /**
    An escape [literal](#highlight.tags.literal), for example a
    backslash escape in a string.
    */
    escape: t(literal),
    /**
    A color [literal](#highlight.tags.literal).
    */
    color: t(literal),
    /**
    A URL [literal](#highlight.tags.literal).
    */
    url: t(literal),
    /**
    A language keyword.
    */
    keyword,
    /**
    The [keyword](#highlight.tags.keyword) for the self or this
    object.
    */
    self: t(keyword),
    /**
    The [keyword](#highlight.tags.keyword) for null.
    */
    null: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) denoting some atomic value.
    */
    atom: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) that represents a unit.
    */
    unit: t(keyword),
    /**
    A modifier [keyword](#highlight.tags.keyword).
    */
    modifier: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) that acts as an operator.
    */
    operatorKeyword: t(keyword),
    /**
    A control-flow related [keyword](#highlight.tags.keyword).
    */
    controlKeyword: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) that defines something.
    */
    definitionKeyword: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) related to defining or
    interfacing with modules.
    */
    moduleKeyword: t(keyword),
    /**
    An operator.
    */
    operator,
    /**
    An [operator](#highlight.tags.operator) that dereferences something.
    */
    derefOperator: t(operator),
    /**
    Arithmetic-related [operator](#highlight.tags.operator).
    */
    arithmeticOperator: t(operator),
    /**
    Logical [operator](#highlight.tags.operator).
    */
    logicOperator: t(operator),
    /**
    Bit [operator](#highlight.tags.operator).
    */
    bitwiseOperator: t(operator),
    /**
    Comparison [operator](#highlight.tags.operator).
    */
    compareOperator: t(operator),
    /**
    [Operator](#highlight.tags.operator) that updates its operand.
    */
    updateOperator: t(operator),
    /**
    [Operator](#highlight.tags.operator) that defines something.
    */
    definitionOperator: t(operator),
    /**
    Type-related [operator](#highlight.tags.operator).
    */
    typeOperator: t(operator),
    /**
    Control-flow [operator](#highlight.tags.operator).
    */
    controlOperator: t(operator),
    /**
    Program or markup punctuation.
    */
    punctuation,
    /**
    [Punctuation](#highlight.tags.punctuation) that separates
    things.
    */
    separator: t(punctuation),
    /**
    Bracket-style [punctuation](#highlight.tags.punctuation).
    */
    bracket,
    /**
    Angle [brackets](#highlight.tags.bracket) (usually `<` and `>`
    tokens).
    */
    angleBracket: t(bracket),
    /**
    Square [brackets](#highlight.tags.bracket) (usually `[` and `]`
    tokens).
    */
    squareBracket: t(bracket),
    /**
    Parentheses (usually `(` and `)` tokens). Subtag of
    [bracket](#highlight.tags.bracket).
    */
    paren: t(bracket),
    /**
    Braces (usually `{` and `}` tokens). Subtag of
    [bracket](#highlight.tags.bracket).
    */
    brace: t(bracket),
    /**
    Content, for example plain text in XML or markup documents.
    */
    content,
    /**
    [Content](#highlight.tags.content) that represents a heading.
    */
    heading,
    /**
    A level 1 [heading](#highlight.tags.heading).
    */
    heading1: t(heading),
    /**
    A level 2 [heading](#highlight.tags.heading).
    */
    heading2: t(heading),
    /**
    A level 3 [heading](#highlight.tags.heading).
    */
    heading3: t(heading),
    /**
    A level 4 [heading](#highlight.tags.heading).
    */
    heading4: t(heading),
    /**
    A level 5 [heading](#highlight.tags.heading).
    */
    heading5: t(heading),
    /**
    A level 6 [heading](#highlight.tags.heading).
    */
    heading6: t(heading),
    /**
    A prose [content](#highlight.tags.content) separator (such as a horizontal rule).
    */
    contentSeparator: t(content),
    /**
    [Content](#highlight.tags.content) that represents a list.
    */
    list: t(content),
    /**
    [Content](#highlight.tags.content) that represents a quote.
    */
    quote: t(content),
    /**
    [Content](#highlight.tags.content) that is emphasized.
    */
    emphasis: t(content),
    /**
    [Content](#highlight.tags.content) that is styled strong.
    */
    strong: t(content),
    /**
    [Content](#highlight.tags.content) that is part of a link.
    */
    link: t(content),
    /**
    [Content](#highlight.tags.content) that is styled as code or
    monospace.
    */
    monospace: t(content),
    /**
    [Content](#highlight.tags.content) that has a strike-through
    style.
    */
    strikethrough: t(content),
    /**
    Inserted text in a change-tracking format.
    */
    inserted: t(),
    /**
    Deleted text.
    */
    deleted: t(),
    /**
    Changed text.
    */
    changed: t(),
    /**
    An invalid or unsyntactic element.
    */
    invalid: t(),
    /**
    Metadata or meta-instruction.
    */
    meta,
    /**
    [Metadata](#highlight.tags.meta) that applies to the entire
    document.
    */
    documentMeta: t(meta),
    /**
    [Metadata](#highlight.tags.meta) that annotates or adds
    attributes to a given syntactic element.
    */
    annotation: t(meta),
    /**
    Processing instruction or preprocessor directive. Subtag of
    [meta](#highlight.tags.meta).
    */
    processingInstruction: t(meta),
    /**
    [Modifier](#highlight.Tag^defineModifier) that indicates that a
    given element is being defined. Expected to be used with the
    various [name](#highlight.tags.name) tags.
    */
    definition: Tag.defineModifier("definition"),
    /**
    [Modifier](#highlight.Tag^defineModifier) that indicates that
    something is constant. Mostly expected to be used with
    [variable names](#highlight.tags.variableName).
    */
    constant: Tag.defineModifier("constant"),
    /**
    [Modifier](#highlight.Tag^defineModifier) used to indicate that
    a [variable](#highlight.tags.variableName) or [property
    name](#highlight.tags.propertyName) is being called or defined
    as a function.
    */
    function: Tag.defineModifier("function"),
    /**
    [Modifier](#highlight.Tag^defineModifier) that can be applied to
    [names](#highlight.tags.name) to indicate that they belong to
    the language's standard environment.
    */
    standard: Tag.defineModifier("standard"),
    /**
    [Modifier](#highlight.Tag^defineModifier) that indicates a given
    [names](#highlight.tags.name) is local to some scope.
    */
    local: Tag.defineModifier("local"),
    /**
    A generic variant [modifier](#highlight.Tag^defineModifier) that
    can be used to tag language-specific alternative variants of
    some common tag. It is recommended for themes to define special
    forms of at least the [string](#highlight.tags.string) and
    [variable name](#highlight.tags.variableName) tags, since those
    come up a lot.
    */
    special: Tag.defineModifier("special")
  };
  for (let name2 in tags) {
    let val = tags[name2];
    if (val instanceof Tag)
      val.name = name2;
  }
  var classHighlighter = tagHighlighter([
    { tag: tags.link, class: "tok-link" },
    { tag: tags.heading, class: "tok-heading" },
    { tag: tags.emphasis, class: "tok-emphasis" },
    { tag: tags.strong, class: "tok-strong" },
    { tag: tags.keyword, class: "tok-keyword" },
    { tag: tags.atom, class: "tok-atom" },
    { tag: tags.bool, class: "tok-bool" },
    { tag: tags.url, class: "tok-url" },
    { tag: tags.labelName, class: "tok-labelName" },
    { tag: tags.inserted, class: "tok-inserted" },
    { tag: tags.deleted, class: "tok-deleted" },
    { tag: tags.literal, class: "tok-literal" },
    { tag: tags.string, class: "tok-string" },
    { tag: tags.number, class: "tok-number" },
    { tag: [tags.regexp, tags.escape, tags.special(tags.string)], class: "tok-string2" },
    { tag: tags.variableName, class: "tok-variableName" },
    { tag: tags.local(tags.variableName), class: "tok-variableName tok-local" },
    { tag: tags.definition(tags.variableName), class: "tok-variableName tok-definition" },
    { tag: tags.special(tags.variableName), class: "tok-variableName2" },
    { tag: tags.definition(tags.propertyName), class: "tok-propertyName tok-definition" },
    { tag: tags.typeName, class: "tok-typeName" },
    { tag: tags.namespace, class: "tok-namespace" },
    { tag: tags.className, class: "tok-className" },
    { tag: tags.macroName, class: "tok-macroName" },
    { tag: tags.propertyName, class: "tok-propertyName" },
    { tag: tags.operator, class: "tok-operator" },
    { tag: tags.comment, class: "tok-comment" },
    { tag: tags.meta, class: "tok-meta" },
    { tag: tags.invalid, class: "tok-invalid" },
    { tag: tags.punctuation, class: "tok-punctuation" }
  ]);

  // node_modules/@lezer/lr/dist/index.js
  var Stack = class _Stack {
    /**
    @internal
    */
    constructor(p, stack, state, reducePos, pos, score, buffer, bufferBase, curContext, lookAhead = 0, parent) {
      this.p = p;
      this.stack = stack;
      this.state = state;
      this.reducePos = reducePos;
      this.pos = pos;
      this.score = score;
      this.buffer = buffer;
      this.bufferBase = bufferBase;
      this.curContext = curContext;
      this.lookAhead = lookAhead;
      this.parent = parent;
    }
    /**
    @internal
    */
    toString() {
      return `[${this.stack.filter((_, i) => i % 3 == 0).concat(this.state)}]@${this.pos}${this.score ? "!" + this.score : ""}`;
    }
    // Start an empty stack
    /**
    @internal
    */
    static start(p, state, pos = 0) {
      let cx = p.parser.context;
      return new _Stack(p, [], state, pos, pos, 0, [], 0, cx ? new StackContext(cx, cx.start) : null, 0, null);
    }
    /**
    The stack's current [context](#lr.ContextTracker) value, if
    any. Its type will depend on the context tracker's type
    parameter, or it will be `null` if there is no context
    tracker.
    */
    get context() {
      return this.curContext ? this.curContext.context : null;
    }
    // Push a state onto the stack, tracking its start position as well
    // as the buffer base at that point.
    /**
    @internal
    */
    pushState(state, start) {
      this.stack.push(this.state, start, this.bufferBase + this.buffer.length);
      this.state = state;
    }
    // Apply a reduce action
    /**
    @internal
    */
    reduce(action) {
      var _a;
      let depth = action >> 19, type = action & 65535;
      let { parser: parser7 } = this.p;
      let lookaheadRecord = this.reducePos < this.pos - 25 && this.setLookAhead(this.pos);
      let dPrec = parser7.dynamicPrecedence(type);
      if (dPrec)
        this.score += dPrec;
      if (depth == 0) {
        if (type < parser7.minRepeatTerm && this.reducePos < this.pos)
          this.reducePos = this.pos;
        this.pushState(parser7.getGoto(this.state, type, true), this.reducePos);
        if (type < parser7.minRepeatTerm)
          this.storeNode(type, this.reducePos, this.reducePos, lookaheadRecord ? 8 : 4, true);
        this.reduceContext(type, this.reducePos);
        return;
      }
      let base = this.stack.length - (depth - 1) * 3 - (action & 262144 ? 6 : 0);
      let start = base ? this.stack[base - 2] : this.p.ranges[0].from;
      if (type < parser7.minRepeatTerm && start == this.reducePos && this.reducePos < this.pos)
        this.reducePos = this.pos;
      let size = this.reducePos - start;
      if (size >= 2e3 && !((_a = this.p.parser.nodeSet.types[type]) === null || _a === void 0 ? void 0 : _a.isAnonymous)) {
        if (start == this.p.lastBigReductionStart) {
          this.p.bigReductionCount++;
          this.p.lastBigReductionSize = size;
        } else if (this.p.lastBigReductionSize < size) {
          this.p.bigReductionCount = 1;
          this.p.lastBigReductionStart = start;
          this.p.lastBigReductionSize = size;
        }
      }
      let bufferBase = base ? this.stack[base - 1] : 0, count = this.bufferBase + this.buffer.length - bufferBase;
      if (type < parser7.minRepeatTerm || action & 131072) {
        let pos = parser7.stateFlag(
          this.state,
          1
          /* StateFlag.Skipped */
        ) ? this.pos : this.reducePos;
        this.storeNode(type, start, pos, count + 4, true);
      }
      if (action & 262144) {
        this.state = this.stack[base];
      } else {
        let baseStateID = this.stack[base - 3];
        this.state = parser7.getGoto(baseStateID, type, true);
      }
      while (this.stack.length > base)
        this.stack.pop();
      this.reduceContext(type, start);
    }
    // Shift a value into the buffer
    /**
    @internal
    */
    storeNode(term, start, end, size = 4, mustSink = false) {
      if (term == 0 && (!this.stack.length || this.stack[this.stack.length - 1] < this.buffer.length + this.bufferBase)) {
        let top = this.buffer.length;
        if (top > 0 && this.buffer[top - 4] == 0 && this.buffer[top - 1] > -1) {
          if (start == end)
            return;
          if (this.buffer[top - 2] >= start) {
            this.buffer[top - 2] = end;
            return;
          }
        }
      }
      if (!mustSink || this.pos == end) {
        this.buffer.push(term, start, end, size);
      } else {
        let index = this.buffer.length;
        if (index > 0 && (this.buffer[index - 4] != 0 || this.buffer[index - 1] < 0)) {
          let mustMove = false;
          for (let scan = index; scan > 0 && this.buffer[scan - 2] > end; scan -= 4) {
            if (this.buffer[scan - 1] >= 0) {
              mustMove = true;
              break;
            }
          }
          if (mustMove)
            while (index > 0 && this.buffer[index - 2] > end) {
              this.buffer[index] = this.buffer[index - 4];
              this.buffer[index + 1] = this.buffer[index - 3];
              this.buffer[index + 2] = this.buffer[index - 2];
              this.buffer[index + 3] = this.buffer[index - 1];
              index -= 4;
              if (size > 4)
                size -= 4;
            }
        }
        this.buffer[index] = term;
        this.buffer[index + 1] = start;
        this.buffer[index + 2] = end;
        this.buffer[index + 3] = size;
      }
    }
    // Apply a shift action
    /**
    @internal
    */
    shift(action, type, start, end) {
      if (action & 131072) {
        this.pushState(action & 65535, this.pos);
      } else if ((action & 262144) == 0) {
        let nextState = action, { parser: parser7 } = this.p;
        this.pos = end;
        let skipped = parser7.stateFlag(
          nextState,
          1
          /* StateFlag.Skipped */
        );
        if (!skipped && (end > start || type <= parser7.maxNode))
          this.reducePos = end;
        this.pushState(nextState, skipped ? start : Math.min(start, this.reducePos));
        this.shiftContext(type, start);
        if (type <= parser7.maxNode)
          this.buffer.push(type, start, end, 4);
      } else {
        this.pos = end;
        this.shiftContext(type, start);
        if (type <= this.p.parser.maxNode)
          this.buffer.push(type, start, end, 4);
      }
    }
    // Apply an action
    /**
    @internal
    */
    apply(action, next, nextStart, nextEnd) {
      if (action & 65536)
        this.reduce(action);
      else
        this.shift(action, next, nextStart, nextEnd);
    }
    // Add a prebuilt (reused) node into the buffer.
    /**
    @internal
    */
    useNode(value, next) {
      let index = this.p.reused.length - 1;
      if (index < 0 || this.p.reused[index] != value) {
        this.p.reused.push(value);
        index++;
      }
      let start = this.pos;
      this.reducePos = this.pos = start + value.length;
      this.pushState(next, start);
      this.buffer.push(
        index,
        start,
        this.reducePos,
        -1
        /* size == -1 means this is a reused value */
      );
      if (this.curContext)
        this.updateContext(this.curContext.tracker.reuse(this.curContext.context, value, this, this.p.stream.reset(this.pos - value.length)));
    }
    // Split the stack. Due to the buffer sharing and the fact
    // that `this.stack` tends to stay quite shallow, this isn't very
    // expensive.
    /**
    @internal
    */
    split() {
      let parent = this;
      let off = parent.buffer.length;
      if (off && parent.buffer[off - 4] == 0)
        off -= 4;
      while (off > 0 && parent.buffer[off - 2] > parent.reducePos)
        off -= 4;
      let buffer = parent.buffer.slice(off), base = parent.bufferBase + off;
      while (parent && base == parent.bufferBase)
        parent = parent.parent;
      return new _Stack(this.p, this.stack.slice(), this.state, this.reducePos, this.pos, this.score, buffer, base, this.curContext, this.lookAhead, parent);
    }
    // Try to recover from an error by 'deleting' (ignoring) one token.
    /**
    @internal
    */
    recoverByDelete(next, nextEnd) {
      let isNode = next <= this.p.parser.maxNode;
      if (isNode)
        this.storeNode(next, this.pos, nextEnd, 4);
      this.storeNode(0, this.pos, nextEnd, isNode ? 8 : 4);
      this.pos = this.reducePos = nextEnd;
      this.score -= 190;
    }
    /**
    Check if the given term would be able to be shifted (optionally
    after some reductions) on this stack. This can be useful for
    external tokenizers that want to make sure they only provide a
    given token when it applies.
    */
    canShift(term) {
      for (let sim = new SimulatedStack(this); ; ) {
        let action = this.p.parser.stateSlot(
          sim.state,
          4
          /* ParseState.DefaultReduce */
        ) || this.p.parser.hasAction(sim.state, term);
        if (action == 0)
          return false;
        if ((action & 65536) == 0)
          return true;
        sim.reduce(action);
      }
    }
    // Apply up to Recover.MaxNext recovery actions that conceptually
    // inserts some missing token or rule.
    /**
    @internal
    */
    recoverByInsert(next) {
      if (this.stack.length >= 300)
        return [];
      let nextStates = this.p.parser.nextStates(this.state);
      if (nextStates.length > 4 << 1 || this.stack.length >= 120) {
        let best = [];
        for (let i = 0, s; i < nextStates.length; i += 2) {
          if ((s = nextStates[i + 1]) != this.state && this.p.parser.hasAction(s, next))
            best.push(nextStates[i], s);
        }
        if (this.stack.length < 120)
          for (let i = 0; best.length < 4 << 1 && i < nextStates.length; i += 2) {
            let s = nextStates[i + 1];
            if (!best.some((v, i2) => i2 & 1 && v == s))
              best.push(nextStates[i], s);
          }
        nextStates = best;
      }
      let result = [];
      for (let i = 0; i < nextStates.length && result.length < 4; i += 2) {
        let s = nextStates[i + 1];
        if (s == this.state)
          continue;
        let stack = this.split();
        stack.pushState(s, this.pos);
        stack.storeNode(0, stack.pos, stack.pos, 4, true);
        stack.shiftContext(nextStates[i], this.pos);
        stack.reducePos = this.pos;
        stack.score -= 200;
        result.push(stack);
      }
      return result;
    }
    // Force a reduce, if possible. Return false if that can't
    // be done.
    /**
    @internal
    */
    forceReduce() {
      let { parser: parser7 } = this.p;
      let reduce = parser7.stateSlot(
        this.state,
        5
        /* ParseState.ForcedReduce */
      );
      if ((reduce & 65536) == 0)
        return false;
      if (!parser7.validAction(this.state, reduce)) {
        let depth = reduce >> 19, term = reduce & 65535;
        let target = this.stack.length - depth * 3;
        if (target < 0 || parser7.getGoto(this.stack[target], term, false) < 0) {
          let backup = this.findForcedReduction();
          if (backup == null)
            return false;
          reduce = backup;
        }
        this.storeNode(0, this.pos, this.pos, 4, true);
        this.score -= 100;
      }
      this.reducePos = this.pos;
      this.reduce(reduce);
      return true;
    }
    /**
    Try to scan through the automaton to find some kind of reduction
    that can be applied. Used when the regular ForcedReduce field
    isn't a valid action. @internal
    */
    findForcedReduction() {
      let { parser: parser7 } = this.p, seen = [];
      let explore = (state, depth) => {
        if (seen.includes(state))
          return;
        seen.push(state);
        return parser7.allActions(state, (action) => {
          if (action & (262144 | 131072)) ;
          else if (action & 65536) {
            let rDepth = (action >> 19) - depth;
            if (rDepth > 1) {
              let term = action & 65535, target = this.stack.length - rDepth * 3;
              if (target >= 0 && parser7.getGoto(this.stack[target], term, false) >= 0)
                return rDepth << 19 | 65536 | term;
            }
          } else {
            let found = explore(action, depth + 1);
            if (found != null)
              return found;
          }
        });
      };
      return explore(this.state, 0);
    }
    /**
    @internal
    */
    forceAll() {
      while (!this.p.parser.stateFlag(
        this.state,
        2
        /* StateFlag.Accepting */
      )) {
        if (!this.forceReduce()) {
          this.storeNode(0, this.pos, this.pos, 4, true);
          break;
        }
      }
      return this;
    }
    /**
    Check whether this state has no further actions (assumed to be a direct descendant of the
    top state, since any other states must be able to continue
    somehow). @internal
    */
    get deadEnd() {
      if (this.stack.length != 3)
        return false;
      let { parser: parser7 } = this.p;
      return parser7.data[parser7.stateSlot(
        this.state,
        1
        /* ParseState.Actions */
      )] == 65535 && !parser7.stateSlot(
        this.state,
        4
        /* ParseState.DefaultReduce */
      );
    }
    /**
    Restart the stack (put it back in its start state). Only safe
    when this.stack.length == 3 (state is directly below the top
    state). @internal
    */
    restart() {
      this.storeNode(0, this.pos, this.pos, 4, true);
      this.state = this.stack[0];
      this.stack.length = 0;
    }
    /**
    @internal
    */
    sameState(other) {
      if (this.state != other.state || this.stack.length != other.stack.length)
        return false;
      for (let i = 0; i < this.stack.length; i += 3)
        if (this.stack[i] != other.stack[i])
          return false;
      return true;
    }
    /**
    Get the parser used by this stack.
    */
    get parser() {
      return this.p.parser;
    }
    /**
    Test whether a given dialect (by numeric ID, as exported from
    the terms file) is enabled.
    */
    dialectEnabled(dialectID) {
      return this.p.parser.dialect.flags[dialectID];
    }
    shiftContext(term, start) {
      if (this.curContext)
        this.updateContext(this.curContext.tracker.shift(this.curContext.context, term, this, this.p.stream.reset(start)));
    }
    reduceContext(term, start) {
      if (this.curContext)
        this.updateContext(this.curContext.tracker.reduce(this.curContext.context, term, this, this.p.stream.reset(start)));
    }
    /**
    @internal
    */
    emitContext() {
      let last = this.buffer.length - 1;
      if (last < 0 || this.buffer[last] != -3)
        this.buffer.push(this.curContext.hash, this.pos, this.pos, -3);
    }
    /**
    @internal
    */
    emitLookAhead() {
      let last = this.buffer.length - 1;
      if (last < 0 || this.buffer[last] != -4)
        this.buffer.push(this.lookAhead, this.pos, this.pos, -4);
    }
    updateContext(context) {
      if (context != this.curContext.context) {
        let newCx = new StackContext(this.curContext.tracker, context);
        if (newCx.hash != this.curContext.hash)
          this.emitContext();
        this.curContext = newCx;
      }
    }
    /**
    @internal
    */
    setLookAhead(lookAhead) {
      if (lookAhead <= this.lookAhead)
        return false;
      this.emitLookAhead();
      this.lookAhead = lookAhead;
      return true;
    }
    /**
    @internal
    */
    close() {
      if (this.curContext && this.curContext.tracker.strict)
        this.emitContext();
      if (this.lookAhead > 0)
        this.emitLookAhead();
    }
  };
  var StackContext = class {
    constructor(tracker, context) {
      this.tracker = tracker;
      this.context = context;
      this.hash = tracker.strict ? tracker.hash(context) : 0;
    }
  };
  var SimulatedStack = class {
    constructor(start) {
      this.start = start;
      this.state = start.state;
      this.stack = start.stack;
      this.base = this.stack.length;
    }
    reduce(action) {
      let term = action & 65535, depth = action >> 19;
      if (depth == 0) {
        if (this.stack == this.start.stack)
          this.stack = this.stack.slice();
        this.stack.push(this.state, 0, 0);
        this.base += 3;
      } else {
        this.base -= (depth - 1) * 3;
      }
      let goto = this.start.p.parser.getGoto(this.stack[this.base - 3], term, true);
      this.state = goto;
    }
  };
  var StackBufferCursor = class _StackBufferCursor {
    constructor(stack, pos, index) {
      this.stack = stack;
      this.pos = pos;
      this.index = index;
      this.buffer = stack.buffer;
      if (this.index == 0)
        this.maybeNext();
    }
    static create(stack, pos = stack.bufferBase + stack.buffer.length) {
      return new _StackBufferCursor(stack, pos, pos - stack.bufferBase);
    }
    maybeNext() {
      let next = this.stack.parent;
      if (next != null) {
        this.index = this.stack.bufferBase - next.bufferBase;
        this.stack = next;
        this.buffer = next.buffer;
      }
    }
    get id() {
      return this.buffer[this.index - 4];
    }
    get start() {
      return this.buffer[this.index - 3];
    }
    get end() {
      return this.buffer[this.index - 2];
    }
    get size() {
      return this.buffer[this.index - 1];
    }
    next() {
      this.index -= 4;
      this.pos -= 4;
      if (this.index == 0)
        this.maybeNext();
    }
    fork() {
      return new _StackBufferCursor(this.stack, this.pos, this.index);
    }
  };
  function decodeArray(input, Type2 = Uint16Array) {
    if (typeof input != "string")
      return input;
    let array = null;
    for (let pos = 0, out = 0; pos < input.length; ) {
      let value = 0;
      for (; ; ) {
        let next = input.charCodeAt(pos++), stop = false;
        if (next == 126) {
          value = 65535;
          break;
        }
        if (next >= 92)
          next--;
        if (next >= 34)
          next--;
        let digit = next - 32;
        if (digit >= 46) {
          digit -= 46;
          stop = true;
        }
        value += digit;
        if (stop)
          break;
        value *= 46;
      }
      if (array)
        array[out++] = value;
      else
        array = new Type2(value);
    }
    return array;
  }
  var CachedToken = class {
    constructor() {
      this.start = -1;
      this.value = -1;
      this.end = -1;
      this.extended = -1;
      this.lookAhead = 0;
      this.mask = 0;
      this.context = 0;
    }
  };
  var nullToken = new CachedToken();
  var InputStream = class {
    /**
    @internal
    */
    constructor(input, ranges) {
      this.input = input;
      this.ranges = ranges;
      this.chunk = "";
      this.chunkOff = 0;
      this.chunk2 = "";
      this.chunk2Pos = 0;
      this.next = -1;
      this.token = nullToken;
      this.rangeIndex = 0;
      this.pos = this.chunkPos = ranges[0].from;
      this.range = ranges[0];
      this.end = ranges[ranges.length - 1].to;
      this.readNext();
    }
    /**
    @internal
    */
    resolveOffset(offset, assoc) {
      let range = this.range, index = this.rangeIndex;
      let pos = this.pos + offset;
      while (pos < range.from) {
        if (!index)
          return null;
        let next = this.ranges[--index];
        pos -= range.from - next.to;
        range = next;
      }
      while (assoc < 0 ? pos > range.to : pos >= range.to) {
        if (index == this.ranges.length - 1)
          return null;
        let next = this.ranges[++index];
        pos += next.from - range.to;
        range = next;
      }
      return pos;
    }
    /**
    @internal
    */
    clipPos(pos) {
      if (pos >= this.range.from && pos < this.range.to)
        return pos;
      for (let range of this.ranges)
        if (range.to > pos)
          return Math.max(pos, range.from);
      return this.end;
    }
    /**
    Look at a code unit near the stream position. `.peek(0)` equals
    `.next`, `.peek(-1)` gives you the previous character, and so
    on.

    Note that looking around during tokenizing creates dependencies
    on potentially far-away content, which may reduce the
    effectiveness incremental parsing—when looking forward—or even
    cause invalid reparses when looking backward more than 25 code
    units, since the library does not track lookbehind.
    */
    peek(offset) {
      let idx = this.chunkOff + offset, pos, result;
      if (idx >= 0 && idx < this.chunk.length) {
        pos = this.pos + offset;
        result = this.chunk.charCodeAt(idx);
      } else {
        let resolved = this.resolveOffset(offset, 1);
        if (resolved == null)
          return -1;
        pos = resolved;
        if (pos >= this.chunk2Pos && pos < this.chunk2Pos + this.chunk2.length) {
          result = this.chunk2.charCodeAt(pos - this.chunk2Pos);
        } else {
          let i = this.rangeIndex, range = this.range;
          while (range.to <= pos)
            range = this.ranges[++i];
          this.chunk2 = this.input.chunk(this.chunk2Pos = pos);
          if (pos + this.chunk2.length > range.to)
            this.chunk2 = this.chunk2.slice(0, range.to - pos);
          result = this.chunk2.charCodeAt(0);
        }
      }
      if (pos >= this.token.lookAhead)
        this.token.lookAhead = pos + 1;
      return result;
    }
    /**
    Accept a token. By default, the end of the token is set to the
    current stream position, but you can pass an offset (relative to
    the stream position) to change that.
    */
    acceptToken(token, endOffset = 0) {
      let end = endOffset ? this.resolveOffset(endOffset, -1) : this.pos;
      if (end == null || end < this.token.start)
        throw new RangeError("Token end out of bounds");
      this.token.value = token;
      this.token.end = end;
    }
    /**
    Accept a token ending at a specific given position.
    */
    acceptTokenTo(token, endPos) {
      this.token.value = token;
      this.token.end = endPos;
    }
    getChunk() {
      if (this.pos >= this.chunk2Pos && this.pos < this.chunk2Pos + this.chunk2.length) {
        let { chunk, chunkPos } = this;
        this.chunk = this.chunk2;
        this.chunkPos = this.chunk2Pos;
        this.chunk2 = chunk;
        this.chunk2Pos = chunkPos;
        this.chunkOff = this.pos - this.chunkPos;
      } else {
        this.chunk2 = this.chunk;
        this.chunk2Pos = this.chunkPos;
        let nextChunk = this.input.chunk(this.pos);
        let end = this.pos + nextChunk.length;
        this.chunk = end > this.range.to ? nextChunk.slice(0, this.range.to - this.pos) : nextChunk;
        this.chunkPos = this.pos;
        this.chunkOff = 0;
      }
    }
    readNext() {
      if (this.chunkOff >= this.chunk.length) {
        this.getChunk();
        if (this.chunkOff == this.chunk.length)
          return this.next = -1;
      }
      return this.next = this.chunk.charCodeAt(this.chunkOff);
    }
    /**
    Move the stream forward N (defaults to 1) code units. Returns
    the new value of [`next`](#lr.InputStream.next).
    */
    advance(n = 1) {
      this.chunkOff += n;
      while (this.pos + n >= this.range.to) {
        if (this.rangeIndex == this.ranges.length - 1)
          return this.setDone();
        n -= this.range.to - this.pos;
        this.range = this.ranges[++this.rangeIndex];
        this.pos = this.range.from;
      }
      this.pos += n;
      if (this.pos >= this.token.lookAhead)
        this.token.lookAhead = this.pos + 1;
      return this.readNext();
    }
    setDone() {
      this.pos = this.chunkPos = this.end;
      this.range = this.ranges[this.rangeIndex = this.ranges.length - 1];
      this.chunk = "";
      return this.next = -1;
    }
    /**
    @internal
    */
    reset(pos, token) {
      if (token) {
        this.token = token;
        token.start = pos;
        token.lookAhead = pos + 1;
        token.value = token.extended = -1;
      } else {
        this.token = nullToken;
      }
      if (this.pos != pos) {
        this.pos = pos;
        if (pos == this.end) {
          this.setDone();
          return this;
        }
        while (pos < this.range.from)
          this.range = this.ranges[--this.rangeIndex];
        while (pos >= this.range.to)
          this.range = this.ranges[++this.rangeIndex];
        if (pos >= this.chunkPos && pos < this.chunkPos + this.chunk.length) {
          this.chunkOff = pos - this.chunkPos;
        } else {
          this.chunk = "";
          this.chunkOff = 0;
        }
        this.readNext();
      }
      return this;
    }
    /**
    @internal
    */
    read(from, to) {
      if (from >= this.chunkPos && to <= this.chunkPos + this.chunk.length)
        return this.chunk.slice(from - this.chunkPos, to - this.chunkPos);
      if (from >= this.chunk2Pos && to <= this.chunk2Pos + this.chunk2.length)
        return this.chunk2.slice(from - this.chunk2Pos, to - this.chunk2Pos);
      if (from >= this.range.from && to <= this.range.to)
        return this.input.read(from, to);
      let result = "";
      for (let r of this.ranges) {
        if (r.from >= to)
          break;
        if (r.to > from)
          result += this.input.read(Math.max(r.from, from), Math.min(r.to, to));
      }
      return result;
    }
  };
  var TokenGroup = class {
    constructor(data, id2) {
      this.data = data;
      this.id = id2;
    }
    token(input, stack) {
      let { parser: parser7 } = stack.p;
      readToken(this.data, input, stack, this.id, parser7.data, parser7.tokenPrecTable);
    }
  };
  TokenGroup.prototype.contextual = TokenGroup.prototype.fallback = TokenGroup.prototype.extend = false;
  var LocalTokenGroup = class {
    constructor(data, precTable, elseToken) {
      this.precTable = precTable;
      this.elseToken = elseToken;
      this.data = typeof data == "string" ? decodeArray(data) : data;
    }
    token(input, stack) {
      let start = input.pos, skipped = 0;
      for (; ; ) {
        let atEof = input.next < 0, nextPos = input.resolveOffset(1, 1);
        readToken(this.data, input, stack, 0, this.data, this.precTable);
        if (input.token.value > -1)
          break;
        if (this.elseToken == null)
          return;
        if (!atEof)
          skipped++;
        if (nextPos == null)
          break;
        input.reset(nextPos, input.token);
      }
      if (skipped) {
        input.reset(start, input.token);
        input.acceptToken(this.elseToken, skipped);
      }
    }
  };
  LocalTokenGroup.prototype.contextual = TokenGroup.prototype.fallback = TokenGroup.prototype.extend = false;
  var ExternalTokenizer = class {
    /**
    Create a tokenizer. The first argument is the function that,
    given an input stream, scans for the types of tokens it
    recognizes at the stream's position, and calls
    [`acceptToken`](#lr.InputStream.acceptToken) when it finds
    one.
    */
    constructor(token, options = {}) {
      this.token = token;
      this.contextual = !!options.contextual;
      this.fallback = !!options.fallback;
      this.extend = !!options.extend;
    }
  };
  function readToken(data, input, stack, group, precTable, precOffset) {
    let state = 0, groupMask = 1 << group, { dialect } = stack.p.parser;
    scan: for (; ; ) {
      if ((groupMask & data[state]) == 0)
        break;
      let accEnd = data[state + 1];
      for (let i = state + 3; i < accEnd; i += 2)
        if ((data[i + 1] & groupMask) > 0) {
          let term = data[i];
          if (dialect.allows(term) && (input.token.value == -1 || input.token.value == term || overrides(term, input.token.value, precTable, precOffset))) {
            input.acceptToken(term);
            break;
          }
        }
      let next = input.next, low = 0, high = data[state + 2];
      if (input.next < 0 && high > low && data[accEnd + high * 3 - 3] == 65535) {
        state = data[accEnd + high * 3 - 1];
        continue scan;
      }
      for (; low < high; ) {
        let mid = low + high >> 1;
        let index = accEnd + mid + (mid << 1);
        let from = data[index], to = data[index + 1] || 65536;
        if (next < from)
          high = mid;
        else if (next >= to)
          low = mid + 1;
        else {
          state = data[index + 2];
          input.advance();
          continue scan;
        }
      }
      break;
    }
  }
  function findOffset(data, start, term) {
    for (let i = start, next; (next = data[i]) != 65535; i++)
      if (next == term)
        return i - start;
    return -1;
  }
  function overrides(token, prev, tableData, tableOffset) {
    let iPrev = findOffset(tableData, tableOffset, prev);
    return iPrev < 0 || findOffset(tableData, tableOffset, token) < iPrev;
  }
  var verbose = typeof process != "undefined" && process.env && /\bparse\b/.test(process.env.LOG);
  var stackIDs = null;
  function cutAt(tree, pos, side) {
    let cursor = tree.cursor(IterMode.IncludeAnonymous);
    cursor.moveTo(pos);
    for (; ; ) {
      if (!(side < 0 ? cursor.childBefore(pos) : cursor.childAfter(pos)))
        for (; ; ) {
          if ((side < 0 ? cursor.to < pos : cursor.from > pos) && !cursor.type.isError)
            return side < 0 ? Math.max(0, Math.min(
              cursor.to - 1,
              pos - 25
              /* Lookahead.Margin */
            )) : Math.min(tree.length, Math.max(
              cursor.from + 1,
              pos + 25
              /* Lookahead.Margin */
            ));
          if (side < 0 ? cursor.prevSibling() : cursor.nextSibling())
            break;
          if (!cursor.parent())
            return side < 0 ? 0 : tree.length;
        }
    }
  }
  var FragmentCursor2 = class {
    constructor(fragments, nodeSet) {
      this.fragments = fragments;
      this.nodeSet = nodeSet;
      this.i = 0;
      this.fragment = null;
      this.safeFrom = -1;
      this.safeTo = -1;
      this.trees = [];
      this.start = [];
      this.index = [];
      this.nextFragment();
    }
    nextFragment() {
      let fr = this.fragment = this.i == this.fragments.length ? null : this.fragments[this.i++];
      if (fr) {
        this.safeFrom = fr.openStart ? cutAt(fr.tree, fr.from + fr.offset, 1) - fr.offset : fr.from;
        this.safeTo = fr.openEnd ? cutAt(fr.tree, fr.to + fr.offset, -1) - fr.offset : fr.to;
        while (this.trees.length) {
          this.trees.pop();
          this.start.pop();
          this.index.pop();
        }
        this.trees.push(fr.tree);
        this.start.push(-fr.offset);
        this.index.push(0);
        this.nextStart = this.safeFrom;
      } else {
        this.nextStart = 1e9;
      }
    }
    // `pos` must be >= any previously given `pos` for this cursor
    nodeAt(pos) {
      if (pos < this.nextStart)
        return null;
      while (this.fragment && this.safeTo <= pos)
        this.nextFragment();
      if (!this.fragment)
        return null;
      for (; ; ) {
        let last = this.trees.length - 1;
        if (last < 0) {
          this.nextFragment();
          return null;
        }
        let top = this.trees[last], index = this.index[last];
        if (index == top.children.length) {
          this.trees.pop();
          this.start.pop();
          this.index.pop();
          continue;
        }
        let next = top.children[index];
        let start = this.start[last] + top.positions[index];
        if (start > pos) {
          this.nextStart = start;
          return null;
        }
        if (next instanceof Tree) {
          if (start == pos) {
            if (start < this.safeFrom)
              return null;
            let end = start + next.length;
            if (end <= this.safeTo) {
              let lookAhead = next.prop(NodeProp.lookAhead);
              if (!lookAhead || end + lookAhead < this.fragment.to)
                return next;
            }
          }
          this.index[last]++;
          if (start + next.length >= Math.max(this.safeFrom, pos)) {
            this.trees.push(next);
            this.start.push(start);
            this.index.push(0);
          }
        } else {
          this.index[last]++;
          this.nextStart = start + next.length;
        }
      }
    }
  };
  var TokenCache = class {
    constructor(parser7, stream) {
      this.stream = stream;
      this.tokens = [];
      this.mainToken = null;
      this.actions = [];
      this.tokens = parser7.tokenizers.map((_) => new CachedToken());
    }
    getActions(stack) {
      let actionIndex = 0;
      let main = null;
      let { parser: parser7 } = stack.p, { tokenizers } = parser7;
      let mask = parser7.stateSlot(
        stack.state,
        3
        /* ParseState.TokenizerMask */
      );
      let context = stack.curContext ? stack.curContext.hash : 0;
      let lookAhead = 0;
      for (let i = 0; i < tokenizers.length; i++) {
        if ((1 << i & mask) == 0)
          continue;
        let tokenizer = tokenizers[i], token = this.tokens[i];
        if (main && !tokenizer.fallback)
          continue;
        if (tokenizer.contextual || token.start != stack.pos || token.mask != mask || token.context != context) {
          this.updateCachedToken(token, tokenizer, stack);
          token.mask = mask;
          token.context = context;
        }
        if (token.lookAhead > token.end + 25)
          lookAhead = Math.max(token.lookAhead, lookAhead);
        if (token.value != 0) {
          let startIndex = actionIndex;
          if (token.extended > -1)
            actionIndex = this.addActions(stack, token.extended, token.end, actionIndex);
          actionIndex = this.addActions(stack, token.value, token.end, actionIndex);
          if (!tokenizer.extend) {
            main = token;
            if (actionIndex > startIndex)
              break;
          }
        }
      }
      while (this.actions.length > actionIndex)
        this.actions.pop();
      if (lookAhead)
        stack.setLookAhead(lookAhead);
      if (!main && stack.pos == this.stream.end) {
        main = new CachedToken();
        main.value = stack.p.parser.eofTerm;
        main.start = main.end = stack.pos;
        actionIndex = this.addActions(stack, main.value, main.end, actionIndex);
      }
      this.mainToken = main;
      return this.actions;
    }
    getMainToken(stack) {
      if (this.mainToken)
        return this.mainToken;
      let main = new CachedToken(), { pos, p } = stack;
      main.start = pos;
      main.end = Math.min(pos + 1, p.stream.end);
      main.value = pos == p.stream.end ? p.parser.eofTerm : 0;
      return main;
    }
    updateCachedToken(token, tokenizer, stack) {
      let start = this.stream.clipPos(stack.pos);
      tokenizer.token(this.stream.reset(start, token), stack);
      if (token.value > -1) {
        let { parser: parser7 } = stack.p;
        for (let i = 0; i < parser7.specialized.length; i++)
          if (parser7.specialized[i] == token.value) {
            let result = parser7.specializers[i](this.stream.read(token.start, token.end), stack);
            if (result >= 0 && stack.p.parser.dialect.allows(result >> 1)) {
              if ((result & 1) == 0)
                token.value = result >> 1;
              else
                token.extended = result >> 1;
              break;
            }
          }
      } else {
        token.value = 0;
        token.end = this.stream.clipPos(start + 1);
      }
    }
    putAction(action, token, end, index) {
      for (let i = 0; i < index; i += 3)
        if (this.actions[i] == action)
          return index;
      this.actions[index++] = action;
      this.actions[index++] = token;
      this.actions[index++] = end;
      return index;
    }
    addActions(stack, token, end, index) {
      let { state } = stack, { parser: parser7 } = stack.p, { data } = parser7;
      for (let set = 0; set < 2; set++) {
        for (let i = parser7.stateSlot(
          state,
          set ? 2 : 1
          /* ParseState.Actions */
        ); ; i += 3) {
          if (data[i] == 65535) {
            if (data[i + 1] == 1) {
              i = pair(data, i + 2);
            } else {
              if (index == 0 && data[i + 1] == 2)
                index = this.putAction(pair(data, i + 2), token, end, index);
              break;
            }
          }
          if (data[i] == token)
            index = this.putAction(pair(data, i + 1), token, end, index);
        }
      }
      return index;
    }
  };
  var Parse = class {
    constructor(parser7, input, fragments, ranges) {
      this.parser = parser7;
      this.input = input;
      this.ranges = ranges;
      this.recovering = 0;
      this.nextStackID = 9812;
      this.minStackPos = 0;
      this.reused = [];
      this.stoppedAt = null;
      this.lastBigReductionStart = -1;
      this.lastBigReductionSize = 0;
      this.bigReductionCount = 0;
      this.stream = new InputStream(input, ranges);
      this.tokens = new TokenCache(parser7, this.stream);
      this.topTerm = parser7.top[1];
      let { from } = ranges[0];
      this.stacks = [Stack.start(this, parser7.top[0], from)];
      this.fragments = fragments.length && this.stream.end - from > parser7.bufferLength * 4 ? new FragmentCursor2(fragments, parser7.nodeSet) : null;
    }
    get parsedPos() {
      return this.minStackPos;
    }
    // Move the parser forward. This will process all parse stacks at
    // `this.pos` and try to advance them to a further position. If no
    // stack for such a position is found, it'll start error-recovery.
    //
    // When the parse is finished, this will return a syntax tree. When
    // not, it returns `null`.
    advance() {
      let stacks = this.stacks, pos = this.minStackPos;
      let newStacks = this.stacks = [];
      let stopped, stoppedTokens;
      if (this.bigReductionCount > 300 && stacks.length == 1) {
        let [s] = stacks;
        while (s.forceReduce() && s.stack.length && s.stack[s.stack.length - 2] >= this.lastBigReductionStart) {
        }
        this.bigReductionCount = this.lastBigReductionSize = 0;
      }
      for (let i = 0; i < stacks.length; i++) {
        let stack = stacks[i];
        for (; ; ) {
          this.tokens.mainToken = null;
          if (stack.pos > pos) {
            newStacks.push(stack);
          } else if (this.advanceStack(stack, newStacks, stacks)) {
            continue;
          } else {
            if (!stopped) {
              stopped = [];
              stoppedTokens = [];
            }
            stopped.push(stack);
            let tok = this.tokens.getMainToken(stack);
            stoppedTokens.push(tok.value, tok.end);
          }
          break;
        }
      }
      if (!newStacks.length) {
        let finished = stopped && findFinished(stopped);
        if (finished) {
          if (verbose)
            console.log("Finish with " + this.stackID(finished));
          return this.stackToTree(finished);
        }
        if (this.parser.strict) {
          if (verbose && stopped)
            console.log("Stuck with token " + (this.tokens.mainToken ? this.parser.getName(this.tokens.mainToken.value) : "none"));
          throw new SyntaxError("No parse at " + pos);
        }
        if (!this.recovering)
          this.recovering = 5;
      }
      if (this.recovering && stopped) {
        let finished = this.stoppedAt != null && stopped[0].pos > this.stoppedAt ? stopped[0] : this.runRecovery(stopped, stoppedTokens, newStacks);
        if (finished) {
          if (verbose)
            console.log("Force-finish " + this.stackID(finished));
          return this.stackToTree(finished.forceAll());
        }
      }
      if (this.recovering) {
        let maxRemaining = this.recovering == 1 ? 1 : this.recovering * 3;
        if (newStacks.length > maxRemaining) {
          newStacks.sort((a2, b) => b.score - a2.score);
          while (newStacks.length > maxRemaining)
            newStacks.pop();
        }
        if (newStacks.some((s) => s.reducePos > pos))
          this.recovering--;
      } else if (newStacks.length > 1) {
        outer: for (let i = 0; i < newStacks.length - 1; i++) {
          let stack = newStacks[i];
          for (let j = i + 1; j < newStacks.length; j++) {
            let other = newStacks[j];
            if (stack.sameState(other) || stack.buffer.length > 500 && other.buffer.length > 500) {
              if ((stack.score - other.score || stack.buffer.length - other.buffer.length) > 0) {
                newStacks.splice(j--, 1);
              } else {
                newStacks.splice(i--, 1);
                continue outer;
              }
            }
          }
        }
        if (newStacks.length > 12) {
          newStacks.sort((a2, b) => b.score - a2.score);
          newStacks.splice(
            12,
            newStacks.length - 12
            /* Rec.MaxStackCount */
          );
        }
      }
      this.minStackPos = newStacks[0].pos;
      for (let i = 1; i < newStacks.length; i++)
        if (newStacks[i].pos < this.minStackPos)
          this.minStackPos = newStacks[i].pos;
      return null;
    }
    stopAt(pos) {
      if (this.stoppedAt != null && this.stoppedAt < pos)
        throw new RangeError("Can't move stoppedAt forward");
      this.stoppedAt = pos;
    }
    // Returns an updated version of the given stack, or null if the
    // stack can't advance normally. When `split` and `stacks` are
    // given, stacks split off by ambiguous operations will be pushed to
    // `split`, or added to `stacks` if they move `pos` forward.
    advanceStack(stack, stacks, split) {
      let start = stack.pos, { parser: parser7 } = this;
      let base = verbose ? this.stackID(stack) + " -> " : "";
      if (this.stoppedAt != null && start > this.stoppedAt)
        return stack.forceReduce() ? stack : null;
      if (this.fragments) {
        let strictCx = stack.curContext && stack.curContext.tracker.strict, cxHash = strictCx ? stack.curContext.hash : 0;
        for (let cached = this.fragments.nodeAt(start); cached; ) {
          let match = this.parser.nodeSet.types[cached.type.id] == cached.type ? parser7.getGoto(stack.state, cached.type.id) : -1;
          if (match > -1 && cached.length && (!strictCx || (cached.prop(NodeProp.contextHash) || 0) == cxHash)) {
            stack.useNode(cached, match);
            if (verbose)
              console.log(base + this.stackID(stack) + ` (via reuse of ${parser7.getName(cached.type.id)})`);
            return true;
          }
          if (!(cached instanceof Tree) || cached.children.length == 0 || cached.positions[0] > 0)
            break;
          let inner = cached.children[0];
          if (inner instanceof Tree && cached.positions[0] == 0)
            cached = inner;
          else
            break;
        }
      }
      let defaultReduce = parser7.stateSlot(
        stack.state,
        4
        /* ParseState.DefaultReduce */
      );
      if (defaultReduce > 0) {
        stack.reduce(defaultReduce);
        if (verbose)
          console.log(base + this.stackID(stack) + ` (via always-reduce ${parser7.getName(
            defaultReduce & 65535
            /* Action.ValueMask */
          )})`);
        return true;
      }
      if (stack.stack.length >= 8400) {
        while (stack.stack.length > 6e3 && stack.forceReduce()) {
        }
      }
      let actions = this.tokens.getActions(stack);
      for (let i = 0; i < actions.length; ) {
        let action = actions[i++], term = actions[i++], end = actions[i++];
        let last = i == actions.length || !split;
        let localStack = last ? stack : stack.split();
        let main = this.tokens.mainToken;
        localStack.apply(action, term, main ? main.start : localStack.pos, end);
        if (verbose)
          console.log(base + this.stackID(localStack) + ` (via ${(action & 65536) == 0 ? "shift" : `reduce of ${parser7.getName(
            action & 65535
            /* Action.ValueMask */
          )}`} for ${parser7.getName(term)} @ ${start}${localStack == stack ? "" : ", split"})`);
        if (last)
          return true;
        else if (localStack.pos > start)
          stacks.push(localStack);
        else
          split.push(localStack);
      }
      return false;
    }
    // Advance a given stack forward as far as it will go. Returns the
    // (possibly updated) stack if it got stuck, or null if it moved
    // forward and was given to `pushStackDedup`.
    advanceFully(stack, newStacks) {
      let pos = stack.pos;
      for (; ; ) {
        if (!this.advanceStack(stack, null, null))
          return false;
        if (stack.pos > pos) {
          pushStackDedup(stack, newStacks);
          return true;
        }
      }
    }
    runRecovery(stacks, tokens, newStacks) {
      let finished = null, restarted = false;
      for (let i = 0; i < stacks.length; i++) {
        let stack = stacks[i], token = tokens[i << 1], tokenEnd = tokens[(i << 1) + 1];
        let base = verbose ? this.stackID(stack) + " -> " : "";
        if (stack.deadEnd) {
          if (restarted)
            continue;
          restarted = true;
          stack.restart();
          if (verbose)
            console.log(base + this.stackID(stack) + " (restarted)");
          let done = this.advanceFully(stack, newStacks);
          if (done)
            continue;
        }
        let force = stack.split(), forceBase = base;
        for (let j = 0; j < 10 && force.forceReduce(); j++) {
          if (verbose)
            console.log(forceBase + this.stackID(force) + " (via force-reduce)");
          let done = this.advanceFully(force, newStacks);
          if (done)
            break;
          if (verbose)
            forceBase = this.stackID(force) + " -> ";
        }
        for (let insert of stack.recoverByInsert(token)) {
          if (verbose)
            console.log(base + this.stackID(insert) + " (via recover-insert)");
          this.advanceFully(insert, newStacks);
        }
        if (this.stream.end > stack.pos) {
          if (tokenEnd == stack.pos) {
            tokenEnd++;
            token = 0;
          }
          stack.recoverByDelete(token, tokenEnd);
          if (verbose)
            console.log(base + this.stackID(stack) + ` (via recover-delete ${this.parser.getName(token)})`);
          pushStackDedup(stack, newStacks);
        } else if (!finished || finished.score < force.score) {
          finished = force;
        }
      }
      return finished;
    }
    // Convert the stack's buffer to a syntax tree.
    stackToTree(stack) {
      stack.close();
      return Tree.build({
        buffer: StackBufferCursor.create(stack),
        nodeSet: this.parser.nodeSet,
        topID: this.topTerm,
        maxBufferLength: this.parser.bufferLength,
        reused: this.reused,
        start: this.ranges[0].from,
        length: stack.pos - this.ranges[0].from,
        minRepeatType: this.parser.minRepeatTerm
      });
    }
    stackID(stack) {
      let id2 = (stackIDs || (stackIDs = /* @__PURE__ */ new WeakMap())).get(stack);
      if (!id2)
        stackIDs.set(stack, id2 = String.fromCodePoint(this.nextStackID++));
      return id2 + stack;
    }
  };
  function pushStackDedup(stack, newStacks) {
    for (let i = 0; i < newStacks.length; i++) {
      let other = newStacks[i];
      if (other.pos == stack.pos && other.sameState(stack)) {
        if (newStacks[i].score < stack.score)
          newStacks[i] = stack;
        return;
      }
    }
    newStacks.push(stack);
  }
  var Dialect = class {
    constructor(source, flags, disabled) {
      this.source = source;
      this.flags = flags;
      this.disabled = disabled;
    }
    allows(term) {
      return !this.disabled || this.disabled[term] == 0;
    }
  };
  var id = (x) => x;
  var ContextTracker = class {
    /**
    Define a context tracker.
    */
    constructor(spec) {
      this.start = spec.start;
      this.shift = spec.shift || id;
      this.reduce = spec.reduce || id;
      this.reuse = spec.reuse || id;
      this.hash = spec.hash || (() => 0);
      this.strict = spec.strict !== false;
    }
  };
  var LRParser = class _LRParser extends Parser {
    /**
    @internal
    */
    constructor(spec) {
      super();
      this.wrappers = [];
      if (spec.version != 14)
        throw new RangeError(`Parser version (${spec.version}) doesn't match runtime version (${14})`);
      let nodeNames = spec.nodeNames.split(" ");
      this.minRepeatTerm = nodeNames.length;
      for (let i = 0; i < spec.repeatNodeCount; i++)
        nodeNames.push("");
      let topTerms = Object.keys(spec.topRules).map((r) => spec.topRules[r][1]);
      let nodeProps = [];
      for (let i = 0; i < nodeNames.length; i++)
        nodeProps.push([]);
      function setProp(nodeID, prop, value) {
        nodeProps[nodeID].push([prop, prop.deserialize(String(value))]);
      }
      if (spec.nodeProps)
        for (let propSpec of spec.nodeProps) {
          let prop = propSpec[0];
          if (typeof prop == "string")
            prop = NodeProp[prop];
          for (let i = 1; i < propSpec.length; ) {
            let next = propSpec[i++];
            if (next >= 0) {
              setProp(next, prop, propSpec[i++]);
            } else {
              let value = propSpec[i + -next];
              for (let j = -next; j > 0; j--)
                setProp(propSpec[i++], prop, value);
              i++;
            }
          }
        }
      this.nodeSet = new NodeSet(nodeNames.map((name2, i) => NodeType.define({
        name: i >= this.minRepeatTerm ? void 0 : name2,
        id: i,
        props: nodeProps[i],
        top: topTerms.indexOf(i) > -1,
        error: i == 0,
        skipped: spec.skippedNodes && spec.skippedNodes.indexOf(i) > -1
      })));
      if (spec.propSources)
        this.nodeSet = this.nodeSet.extend(...spec.propSources);
      this.strict = false;
      this.bufferLength = DefaultBufferLength;
      let tokenArray = decodeArray(spec.tokenData);
      this.context = spec.context;
      this.specializerSpecs = spec.specialized || [];
      this.specialized = new Uint16Array(this.specializerSpecs.length);
      for (let i = 0; i < this.specializerSpecs.length; i++)
        this.specialized[i] = this.specializerSpecs[i].term;
      this.specializers = this.specializerSpecs.map(getSpecializer);
      this.states = decodeArray(spec.states, Uint32Array);
      this.data = decodeArray(spec.stateData);
      this.goto = decodeArray(spec.goto);
      this.maxTerm = spec.maxTerm;
      this.tokenizers = spec.tokenizers.map((value) => typeof value == "number" ? new TokenGroup(tokenArray, value) : value);
      this.topRules = spec.topRules;
      this.dialects = spec.dialects || {};
      this.dynamicPrecedences = spec.dynamicPrecedences || null;
      this.tokenPrecTable = spec.tokenPrec;
      this.termNames = spec.termNames || null;
      this.maxNode = this.nodeSet.types.length - 1;
      this.dialect = this.parseDialect();
      this.top = this.topRules[Object.keys(this.topRules)[0]];
    }
    createParse(input, fragments, ranges) {
      let parse = new Parse(this, input, fragments, ranges);
      for (let w of this.wrappers)
        parse = w(parse, input, fragments, ranges);
      return parse;
    }
    /**
    Get a goto table entry @internal
    */
    getGoto(state, term, loose = false) {
      let table = this.goto;
      if (term >= table[0])
        return -1;
      for (let pos = table[term + 1]; ; ) {
        let groupTag = table[pos++], last = groupTag & 1;
        let target = table[pos++];
        if (last && loose)
          return target;
        for (let end = pos + (groupTag >> 1); pos < end; pos++)
          if (table[pos] == state)
            return target;
        if (last)
          return -1;
      }
    }
    /**
    Check if this state has an action for a given terminal @internal
    */
    hasAction(state, terminal) {
      let data = this.data;
      for (let set = 0; set < 2; set++) {
        for (let i = this.stateSlot(
          state,
          set ? 2 : 1
          /* ParseState.Actions */
        ), next; ; i += 3) {
          if ((next = data[i]) == 65535) {
            if (data[i + 1] == 1)
              next = data[i = pair(data, i + 2)];
            else if (data[i + 1] == 2)
              return pair(data, i + 2);
            else
              break;
          }
          if (next == terminal || next == 0)
            return pair(data, i + 1);
        }
      }
      return 0;
    }
    /**
    @internal
    */
    stateSlot(state, slot) {
      return this.states[state * 6 + slot];
    }
    /**
    @internal
    */
    stateFlag(state, flag) {
      return (this.stateSlot(
        state,
        0
        /* ParseState.Flags */
      ) & flag) > 0;
    }
    /**
    @internal
    */
    validAction(state, action) {
      return !!this.allActions(state, (a2) => a2 == action ? true : null);
    }
    /**
    @internal
    */
    allActions(state, action) {
      let deflt = this.stateSlot(
        state,
        4
        /* ParseState.DefaultReduce */
      );
      let result = deflt ? action(deflt) : void 0;
      for (let i = this.stateSlot(
        state,
        1
        /* ParseState.Actions */
      ); result == null; i += 3) {
        if (this.data[i] == 65535) {
          if (this.data[i + 1] == 1)
            i = pair(this.data, i + 2);
          else
            break;
        }
        result = action(pair(this.data, i + 1));
      }
      return result;
    }
    /**
    Get the states that can follow this one through shift actions or
    goto jumps. @internal
    */
    nextStates(state) {
      let result = [];
      for (let i = this.stateSlot(
        state,
        1
        /* ParseState.Actions */
      ); ; i += 3) {
        if (this.data[i] == 65535) {
          if (this.data[i + 1] == 1)
            i = pair(this.data, i + 2);
          else
            break;
        }
        if ((this.data[i + 2] & 65536 >> 16) == 0) {
          let value = this.data[i + 1];
          if (!result.some((v, i2) => i2 & 1 && v == value))
            result.push(this.data[i], value);
        }
      }
      return result;
    }
    /**
    Configure the parser. Returns a new parser instance that has the
    given settings modified. Settings not provided in `config` are
    kept from the original parser.
    */
    configure(config) {
      let copy = Object.assign(Object.create(_LRParser.prototype), this);
      if (config.props)
        copy.nodeSet = this.nodeSet.extend(...config.props);
      if (config.top) {
        let info = this.topRules[config.top];
        if (!info)
          throw new RangeError(`Invalid top rule name ${config.top}`);
        copy.top = info;
      }
      if (config.tokenizers)
        copy.tokenizers = this.tokenizers.map((t2) => {
          let found = config.tokenizers.find((r) => r.from == t2);
          return found ? found.to : t2;
        });
      if (config.specializers) {
        copy.specializers = this.specializers.slice();
        copy.specializerSpecs = this.specializerSpecs.map((s, i) => {
          let found = config.specializers.find((r) => r.from == s.external);
          if (!found)
            return s;
          let spec = Object.assign(Object.assign({}, s), { external: found.to });
          copy.specializers[i] = getSpecializer(spec);
          return spec;
        });
      }
      if (config.contextTracker)
        copy.context = config.contextTracker;
      if (config.dialect)
        copy.dialect = this.parseDialect(config.dialect);
      if (config.strict != null)
        copy.strict = config.strict;
      if (config.wrap)
        copy.wrappers = copy.wrappers.concat(config.wrap);
      if (config.bufferLength != null)
        copy.bufferLength = config.bufferLength;
      return copy;
    }
    /**
    Tells you whether any [parse wrappers](#lr.ParserConfig.wrap)
    are registered for this parser.
    */
    hasWrappers() {
      return this.wrappers.length > 0;
    }
    /**
    Returns the name associated with a given term. This will only
    work for all terms when the parser was generated with the
    `--names` option. By default, only the names of tagged terms are
    stored.
    */
    getName(term) {
      return this.termNames ? this.termNames[term] : String(term <= this.maxNode && this.nodeSet.types[term].name || term);
    }
    /**
    The eof term id is always allocated directly after the node
    types. @internal
    */
    get eofTerm() {
      return this.maxNode + 1;
    }
    /**
    The type of top node produced by the parser.
    */
    get topNode() {
      return this.nodeSet.types[this.top[1]];
    }
    /**
    @internal
    */
    dynamicPrecedence(term) {
      let prec = this.dynamicPrecedences;
      return prec == null ? 0 : prec[term] || 0;
    }
    /**
    @internal
    */
    parseDialect(dialect) {
      let values = Object.keys(this.dialects), flags = values.map(() => false);
      if (dialect)
        for (let part of dialect.split(" ")) {
          let id2 = values.indexOf(part);
          if (id2 >= 0)
            flags[id2] = true;
        }
      let disabled = null;
      for (let i = 0; i < values.length; i++)
        if (!flags[i]) {
          for (let j = this.dialects[values[i]], id2; (id2 = this.data[j++]) != 65535; )
            (disabled || (disabled = new Uint8Array(this.maxTerm + 1)))[id2] = 1;
        }
      return new Dialect(dialect, flags, disabled);
    }
    /**
    Used by the output of the parser generator. Not available to
    user code. @hide
    */
    static deserialize(spec) {
      return new _LRParser(spec);
    }
  };
  function pair(data, off) {
    return data[off] | data[off + 1] << 16;
  }
  function findFinished(stacks) {
    let best = null;
    for (let stack of stacks) {
      let stopped = stack.p.stoppedAt;
      if ((stack.pos == stack.p.stream.end || stopped != null && stack.pos > stopped) && stack.p.parser.stateFlag(
        stack.state,
        2
        /* StateFlag.Accepting */
      ) && (!best || best.score < stack.score))
        best = stack;
    }
    return best;
  }
  function getSpecializer(spec) {
    if (spec.external) {
      let mask = spec.extend ? 1 : 0;
      return (value, stack) => spec.external(value, stack) << 1 | mask;
    }
    return spec.get;
  }

  // node_modules/@lezer/html/dist/index.js
  var scriptText = 55;
  var StartCloseScriptTag = 1;
  var styleText = 56;
  var StartCloseStyleTag = 2;
  var textareaText = 57;
  var StartCloseTextareaTag = 3;
  var EndTag = 4;
  var SelfClosingEndTag = 5;
  var StartTag = 6;
  var StartScriptTag = 7;
  var StartStyleTag = 8;
  var StartTextareaTag = 9;
  var StartSelfClosingTag = 10;
  var StartCloseTag = 11;
  var NoMatchStartCloseTag = 12;
  var MismatchedStartCloseTag = 13;
  var missingCloseTag = 58;
  var IncompleteTag = 14;
  var IncompleteCloseTag = 15;
  var commentContent$1 = 59;
  var Element = 21;
  var OpenTag = 37;
  var Dialect_noMatch = 0;
  var Dialect_selfClosing = 1;
  var selfClosers = {
    area: true,
    base: true,
    br: true,
    col: true,
    command: true,
    embed: true,
    frame: true,
    hr: true,
    img: true,
    input: true,
    keygen: true,
    link: true,
    meta: true,
    param: true,
    source: true,
    track: true,
    wbr: true,
    menuitem: true
  };
  var implicitlyClosed = {
    dd: true,
    li: true,
    optgroup: true,
    option: true,
    p: true,
    rp: true,
    rt: true,
    tbody: true,
    td: true,
    tfoot: true,
    th: true,
    tr: true
  };
  var closeOnOpen = {
    dd: { dd: true, dt: true },
    dt: { dd: true, dt: true },
    li: { li: true },
    option: { option: true, optgroup: true },
    optgroup: { optgroup: true },
    p: {
      address: true,
      article: true,
      aside: true,
      blockquote: true,
      dir: true,
      div: true,
      dl: true,
      fieldset: true,
      footer: true,
      form: true,
      h1: true,
      h2: true,
      h3: true,
      h4: true,
      h5: true,
      h6: true,
      header: true,
      hgroup: true,
      hr: true,
      menu: true,
      nav: true,
      ol: true,
      p: true,
      pre: true,
      section: true,
      table: true,
      ul: true
    },
    rp: { rp: true, rt: true },
    rt: { rp: true, rt: true },
    tbody: { tbody: true, tfoot: true },
    td: { td: true, th: true },
    tfoot: { tbody: true },
    th: { td: true, th: true },
    thead: { tbody: true, tfoot: true },
    tr: { tr: true }
  };
  function nameChar(ch) {
    return ch == 45 || ch == 46 || ch == 58 || ch >= 65 && ch <= 90 || ch == 95 || ch >= 97 && ch <= 122 || ch >= 161;
  }
  var cachedName = null;
  var cachedInput = null;
  var cachedPos = 0;
  function tagNameAfter(input, offset) {
    let pos = input.pos + offset;
    if (cachedPos == pos && cachedInput == input) return cachedName;
    let next = input.peek(offset), name2 = "";
    for (; ; ) {
      if (!nameChar(next)) break;
      name2 += String.fromCharCode(next);
      next = input.peek(++offset);
    }
    cachedInput = input;
    cachedPos = pos;
    return cachedName = name2 ? name2.toLowerCase() : next == question || next == bang ? void 0 : null;
  }
  var lessThan = 60;
  var greaterThan = 62;
  var slash = 47;
  var question = 63;
  var bang = 33;
  var dash = 45;
  function ElementContext(name2, parent) {
    this.name = name2;
    this.parent = parent;
  }
  var startTagTerms = [StartTag, StartSelfClosingTag, StartScriptTag, StartStyleTag, StartTextareaTag];
  var elementContext = new ContextTracker({
    start: null,
    shift(context, term, stack, input) {
      return startTagTerms.indexOf(term) > -1 ? new ElementContext(tagNameAfter(input, 1) || "", context) : context;
    },
    reduce(context, term) {
      return term == Element && context ? context.parent : context;
    },
    reuse(context, node, stack, input) {
      let type = node.type.id;
      return type == StartTag || type == OpenTag ? new ElementContext(tagNameAfter(input, 1) || "", context) : context;
    },
    strict: false
  });
  var tagStart = new ExternalTokenizer((input, stack) => {
    if (input.next != lessThan) {
      if (input.next < 0 && stack.context) input.acceptToken(missingCloseTag);
      return;
    }
    input.advance();
    let close = input.next == slash;
    if (close) input.advance();
    let name2 = tagNameAfter(input, 0);
    if (name2 === void 0) return;
    if (!name2) return input.acceptToken(close ? IncompleteCloseTag : IncompleteTag);
    let parent = stack.context ? stack.context.name : null;
    if (close) {
      if (name2 == parent) return input.acceptToken(StartCloseTag);
      if (parent && implicitlyClosed[parent]) return input.acceptToken(missingCloseTag, -2);
      if (stack.dialectEnabled(Dialect_noMatch)) return input.acceptToken(NoMatchStartCloseTag);
      for (let cx = stack.context; cx; cx = cx.parent) if (cx.name == name2) return;
      input.acceptToken(MismatchedStartCloseTag);
    } else {
      if (name2 == "script") return input.acceptToken(StartScriptTag);
      if (name2 == "style") return input.acceptToken(StartStyleTag);
      if (name2 == "textarea") return input.acceptToken(StartTextareaTag);
      if (selfClosers.hasOwnProperty(name2)) return input.acceptToken(StartSelfClosingTag);
      if (parent && closeOnOpen[parent] && closeOnOpen[parent][name2]) input.acceptToken(missingCloseTag, -1);
      else input.acceptToken(StartTag);
    }
  }, { contextual: true });
  var commentContent = new ExternalTokenizer((input) => {
    for (let dashes = 0, i = 0; ; i++) {
      if (input.next < 0) {
        if (i) input.acceptToken(commentContent$1);
        break;
      }
      if (input.next == dash) {
        dashes++;
      } else if (input.next == greaterThan && dashes >= 2) {
        if (i >= 3) input.acceptToken(commentContent$1, -2);
        break;
      } else {
        dashes = 0;
      }
      input.advance();
    }
  });
  function inForeignElement(context) {
    for (; context; context = context.parent)
      if (context.name == "svg" || context.name == "math") return true;
    return false;
  }
  var endTag = new ExternalTokenizer((input, stack) => {
    if (input.next == slash && input.peek(1) == greaterThan) {
      let selfClosing = stack.dialectEnabled(Dialect_selfClosing) || inForeignElement(stack.context);
      input.acceptToken(selfClosing ? SelfClosingEndTag : EndTag, 2);
    } else if (input.next == greaterThan) {
      input.acceptToken(EndTag, 1);
    }
  });
  function contentTokenizer(tag, textToken, endToken) {
    let lastState = 2 + tag.length;
    return new ExternalTokenizer((input) => {
      for (let state = 0, matchedLen = 0, i = 0; ; i++) {
        if (input.next < 0) {
          if (i) input.acceptToken(textToken);
          break;
        }
        if (state == 0 && input.next == lessThan || state == 1 && input.next == slash || state >= 2 && state < lastState && input.next == tag.charCodeAt(state - 2)) {
          state++;
          matchedLen++;
        } else if (state == lastState && input.next == greaterThan) {
          if (i > matchedLen)
            input.acceptToken(textToken, -matchedLen);
          else
            input.acceptToken(endToken, -(matchedLen - 2));
          break;
        } else if ((input.next == 10 || input.next == 13) && i) {
          input.acceptToken(textToken, 1);
          break;
        } else {
          state = matchedLen = 0;
        }
        input.advance();
      }
    });
  }
  var scriptTokens = contentTokenizer("script", scriptText, StartCloseScriptTag);
  var styleTokens = contentTokenizer("style", styleText, StartCloseStyleTag);
  var textareaTokens = contentTokenizer("textarea", textareaText, StartCloseTextareaTag);
  var htmlHighlighting = styleTags({
    "Text RawText IncompleteTag IncompleteCloseTag": tags.content,
    "StartTag StartCloseTag SelfClosingEndTag EndTag": tags.angleBracket,
    TagName: tags.tagName,
    "MismatchedCloseTag/TagName": [tags.tagName, tags.invalid],
    AttributeName: tags.attributeName,
    "AttributeValue UnquotedAttributeValue": tags.attributeValue,
    Is: tags.definitionOperator,
    "EntityReference CharacterReference": tags.character,
    Comment: tags.blockComment,
    ProcessingInst: tags.processingInstruction,
    DoctypeDecl: tags.documentMeta
  });
  var parser = LRParser.deserialize({
    version: 14,
    states: ",xOVO!rOOO!ZQ#tO'#CrO!`Q#tO'#C{O!eQ#tO'#DOO!jQ#tO'#DRO!oQ#tO'#DTO!tOaO'#CqO#PObO'#CqO#[OdO'#CqO$kO!rO'#CqOOO`'#Cq'#CqO$rO$fO'#DUO$zQ#tO'#DWO%PQ#tO'#DXOOO`'#Dl'#DlOOO`'#DZ'#DZQVO!rOOO%UQ&rO,59^O%aQ&rO,59gO%lQ&rO,59jO%wQ&rO,59mO&SQ&rO,59oOOOa'#D_'#D_O&_OaO'#CyO&jOaO,59]OOOb'#D`'#D`O&rObO'#C|O&}ObO,59]OOOd'#Da'#DaO'VOdO'#DPO'bOdO,59]OOO`'#Db'#DbO'jO!rO,59]O'qQ#tO'#DSOOO`,59],59]OOOp'#Dc'#DcO'vO$fO,59pOOO`,59p,59pO(OQ#|O,59rO(TQ#|O,59sOOO`-E7X-E7XO(YQ&rO'#CtOOQW'#D['#D[O(hQ&rO1G.xOOOa1G.x1G.xOOO`1G/Z1G/ZO(sQ&rO1G/ROOOb1G/R1G/RO)OQ&rO1G/UOOOd1G/U1G/UO)ZQ&rO1G/XOOO`1G/X1G/XO)fQ&rO1G/ZOOOa-E7]-E7]O)qQ#tO'#CzOOO`1G.w1G.wOOOb-E7^-E7^O)vQ#tO'#C}OOOd-E7_-E7_O){Q#tO'#DQOOO`-E7`-E7`O*QQ#|O,59nOOOp-E7a-E7aOOO`1G/[1G/[OOO`1G/^1G/^OOO`1G/_1G/_O*VQ,UO,59`OOQW-E7Y-E7YOOOa7+$d7+$dOOO`7+$u7+$uOOOb7+$m7+$mOOOd7+$p7+$pOOO`7+$s7+$sO*bQ#|O,59fO*gQ#|O,59iO*lQ#|O,59lOOO`1G/Y1G/YO*qO7[O'#CwO+SOMhO'#CwOOQW1G.z1G.zOOO`1G/Q1G/QOOO`1G/T1G/TOOO`1G/W1G/WOOOO'#D]'#D]O+eO7[O,59cOOQW,59c,59cOOOO'#D^'#D^O+vOMhO,59cOOOO-E7Z-E7ZOOQW1G.}1G.}OOOO-E7[-E7[",
    stateData: ",c~O!_OS~OUSOVPOWQOXROYTO[]O][O^^O_^Oa^Ob^Oc^Od^Oy^O|_O!eZO~OgaO~OgbO~OgcO~OgdO~OgeO~O!XfOPmP![mP~O!YiOQpP![pP~O!ZlORsP![sP~OUSOVPOWQOXROYTOZqO[]O][O^^O_^Oa^Ob^Oc^Od^Oy^O!eZO~O![rO~P#gO!]sO!fuO~OgvO~OgwO~OS|OT}OiyO~OS!POT}OiyO~OS!ROT}OiyO~OS!TOT}OiyO~OS}OT}OiyO~O!XfOPmX![mX~OP!WO![!XO~O!YiOQpX![pX~OQ!ZO![!XO~O!ZlORsX![sX~OR!]O![!XO~O![!XO~P#gOg!_O~O!]sO!f!aO~OS!bO~OS!cO~Oj!dOShXThXihX~OS!fOT!gOiyO~OS!hOT!gOiyO~OS!iOT!gOiyO~OS!jOT!gOiyO~OS!gOT!gOiyO~Og!kO~Og!lO~Og!mO~OS!nO~Ol!qO!a!oO!c!pO~OS!rO~OS!sO~OS!tO~Ob!uOc!uOd!uO!a!wO!b!uO~Ob!xOc!xOd!xO!c!wO!d!xO~Ob!uOc!uOd!uO!a!{O!b!uO~Ob!xOc!xOd!xO!c!{O!d!xO~OT~cbd!ey|!e~",
    goto: "%q!aPPPPPPPPPPPPPPPPPPPPP!b!hP!nPP!zP!}#Q#T#Z#^#a#g#j#m#s#y!bP!b!bP$P$V$m$s$y%P%V%]%cPPPPPPPP%iX^OX`pXUOX`pezabcde{!O!Q!S!UR!q!dRhUR!XhXVOX`pRkVR!XkXWOX`pRnWR!XnXXOX`pQrXR!XpXYOX`pQ`ORx`Q{aQ!ObQ!QcQ!SdQ!UeZ!e{!O!Q!S!UQ!v!oR!z!vQ!y!pR!|!yQgUR!VgQjVR!YjQmWR![mQpXR!^pQtZR!`tS_O`ToXp",
    nodeNames: "\u26A0 StartCloseTag StartCloseTag StartCloseTag EndTag SelfClosingEndTag StartTag StartTag StartTag StartTag StartTag StartCloseTag StartCloseTag StartCloseTag IncompleteTag IncompleteCloseTag Document Text EntityReference CharacterReference InvalidEntity Element OpenTag TagName Attribute AttributeName Is AttributeValue UnquotedAttributeValue ScriptText CloseTag OpenTag StyleText CloseTag OpenTag TextareaText CloseTag OpenTag CloseTag SelfClosingTag Comment ProcessingInst MismatchedCloseTag CloseTag DoctypeDecl",
    maxTerm: 68,
    context: elementContext,
    nodeProps: [
      ["closedBy", -10, 1, 2, 3, 7, 8, 9, 10, 11, 12, 13, "EndTag", 6, "EndTag SelfClosingEndTag", -4, 22, 31, 34, 37, "CloseTag"],
      ["openedBy", 4, "StartTag StartCloseTag", 5, "StartTag", -4, 30, 33, 36, 38, "OpenTag"],
      ["group", -10, 14, 15, 18, 19, 20, 21, 40, 41, 42, 43, "Entity", 17, "Entity TextContent", -3, 29, 32, 35, "TextContent Entity"],
      ["isolate", -11, 22, 30, 31, 33, 34, 36, 37, 38, 39, 42, 43, "ltr", -3, 27, 28, 40, ""]
    ],
    propSources: [htmlHighlighting],
    skippedNodes: [0],
    repeatNodeCount: 9,
    tokenData: "!<p!aR!YOX$qXY,QYZ,QZ[$q[]&X]^,Q^p$qpq,Qqr-_rs3_sv-_vw3}wxHYx}-_}!OH{!O!P-_!P!Q$q!Q![-_![!]Mz!]!^-_!^!_!$S!_!`!;x!`!a&X!a!c-_!c!}Mz!}#R-_#R#SMz#S#T1k#T#oMz#o#s-_#s$f$q$f%W-_%W%oMz%o%p-_%p&aMz&a&b-_&b1pMz1p4U-_4U4dMz4d4e-_4e$ISMz$IS$I`-_$I`$IbMz$Ib$Kh-_$Kh%#tMz%#t&/x-_&/x&EtMz&Et&FV-_&FV;'SMz;'S;:j!#|;:j;=`3X<%l?&r-_?&r?AhMz?Ah?BY$q?BY?MnMz?MnO$q!Z$|caPlW!b`!dpOX$qXZ&XZ[$q[^&X^p$qpq&Xqr$qrs&}sv$qvw+Pwx(tx!^$q!^!_*V!_!a&X!a#S$q#S#T&X#T;'S$q;'S;=`+z<%lO$q!R&bXaP!b`!dpOr&Xrs&}sv&Xwx(tx!^&X!^!_*V!_;'S&X;'S;=`*y<%lO&Xq'UVaP!dpOv&}wx'kx!^&}!^!_(V!_;'S&};'S;=`(n<%lO&}P'pTaPOv'kw!^'k!_;'S'k;'S;=`(P<%lO'kP(SP;=`<%l'kp([S!dpOv(Vx;'S(V;'S;=`(h<%lO(Vp(kP;=`<%l(Vq(qP;=`<%l&}a({WaP!b`Or(trs'ksv(tw!^(t!^!_)e!_;'S(t;'S;=`*P<%lO(t`)jT!b`Or)esv)ew;'S)e;'S;=`)y<%lO)e`)|P;=`<%l)ea*SP;=`<%l(t!Q*^V!b`!dpOr*Vrs(Vsv*Vwx)ex;'S*V;'S;=`*s<%lO*V!Q*vP;=`<%l*V!R*|P;=`<%l&XW+UYlWOX+PZ[+P^p+Pqr+Psw+Px!^+P!a#S+P#T;'S+P;'S;=`+t<%lO+PW+wP;=`<%l+P!Z+}P;=`<%l$q!a,]`aP!b`!dp!_^OX&XXY,QYZ,QZ]&X]^,Q^p&Xpq,Qqr&Xrs&}sv&Xwx(tx!^&X!^!_*V!_;'S&X;'S;=`*y<%lO&X!_-ljiSaPlW!b`!dpOX$qXZ&XZ[$q[^&X^p$qpq&Xqr-_rs&}sv-_vw/^wx(tx!P-_!P!Q$q!Q!^-_!^!_*V!_!a&X!a#S-_#S#T1k#T#s-_#s$f$q$f;'S-_;'S;=`3X<%l?Ah-_?Ah?BY$q?BY?Mn-_?MnO$q[/ebiSlWOX+PZ[+P^p+Pqr/^sw/^x!P/^!P!Q+P!Q!^/^!a#S/^#S#T0m#T#s/^#s$f+P$f;'S/^;'S;=`1e<%l?Ah/^?Ah?BY+P?BY?Mn/^?MnO+PS0rXiSqr0msw0mx!P0m!Q!^0m!a#s0m$f;'S0m;'S;=`1_<%l?Ah0m?BY?Mn0mS1bP;=`<%l0m[1hP;=`<%l/^!V1vciSaP!b`!dpOq&Xqr1krs&}sv1kvw0mwx(tx!P1k!P!Q&X!Q!^1k!^!_*V!_!a&X!a#s1k#s$f&X$f;'S1k;'S;=`3R<%l?Ah1k?Ah?BY&X?BY?Mn1k?MnO&X!V3UP;=`<%l1k!_3[P;=`<%l-_!Z3hV!ahaP!dpOv&}wx'kx!^&}!^!_(V!_;'S&};'S;=`(n<%lO&}!_4WiiSlWd!ROX5uXZ7SZ[5u[^7S^p5uqr8trs7Sst>]tw8twx7Sx!P8t!P!Q5u!Q!]8t!]!^/^!^!a7S!a#S8t#S#T;{#T#s8t#s$f5u$f;'S8t;'S;=`>V<%l?Ah8t?Ah?BY5u?BY?Mn8t?MnO5u!Z5zblWOX5uXZ7SZ[5u[^7S^p5uqr5urs7Sst+Ptw5uwx7Sx!]5u!]!^7w!^!a7S!a#S5u#S#T7S#T;'S5u;'S;=`8n<%lO5u!R7VVOp7Sqs7St!]7S!]!^7l!^;'S7S;'S;=`7q<%lO7S!R7qOb!R!R7tP;=`<%l7S!Z8OYlWb!ROX+PZ[+P^p+Pqr+Psw+Px!^+P!a#S+P#T;'S+P;'S;=`+t<%lO+P!Z8qP;=`<%l5u!_8{iiSlWOX5uXZ7SZ[5u[^7S^p5uqr8trs7Sst/^tw8twx7Sx!P8t!P!Q5u!Q!]8t!]!^:j!^!a7S!a#S8t#S#T;{#T#s8t#s$f5u$f;'S8t;'S;=`>V<%l?Ah8t?Ah?BY5u?BY?Mn8t?MnO5u!_:sbiSlWb!ROX+PZ[+P^p+Pqr/^sw/^x!P/^!P!Q+P!Q!^/^!a#S/^#S#T0m#T#s/^#s$f+P$f;'S/^;'S;=`1e<%l?Ah/^?Ah?BY+P?BY?Mn/^?MnO+P!V<QciSOp7Sqr;{rs7Sst0mtw;{wx7Sx!P;{!P!Q7S!Q!];{!]!^=]!^!a7S!a#s;{#s$f7S$f;'S;{;'S;=`>P<%l?Ah;{?Ah?BY7S?BY?Mn;{?MnO7S!V=dXiSb!Rqr0msw0mx!P0m!Q!^0m!a#s0m$f;'S0m;'S;=`1_<%l?Ah0m?BY?Mn0m!V>SP;=`<%l;{!_>YP;=`<%l8t!_>dhiSlWOX@OXZAYZ[@O[^AY^p@OqrBwrsAYswBwwxAYx!PBw!P!Q@O!Q!]Bw!]!^/^!^!aAY!a#SBw#S#TE{#T#sBw#s$f@O$f;'SBw;'S;=`HS<%l?AhBw?Ah?BY@O?BY?MnBw?MnO@O!Z@TalWOX@OXZAYZ[@O[^AY^p@Oqr@OrsAYsw@OwxAYx!]@O!]!^Az!^!aAY!a#S@O#S#TAY#T;'S@O;'S;=`Bq<%lO@O!RA]UOpAYq!]AY!]!^Ao!^;'SAY;'S;=`At<%lOAY!RAtOc!R!RAwP;=`<%lAY!ZBRYlWc!ROX+PZ[+P^p+Pqr+Psw+Px!^+P!a#S+P#T;'S+P;'S;=`+t<%lO+P!ZBtP;=`<%l@O!_COhiSlWOX@OXZAYZ[@O[^AY^p@OqrBwrsAYswBwwxAYx!PBw!P!Q@O!Q!]Bw!]!^Dj!^!aAY!a#SBw#S#TE{#T#sBw#s$f@O$f;'SBw;'S;=`HS<%l?AhBw?Ah?BY@O?BY?MnBw?MnO@O!_DsbiSlWc!ROX+PZ[+P^p+Pqr/^sw/^x!P/^!P!Q+P!Q!^/^!a#S/^#S#T0m#T#s/^#s$f+P$f;'S/^;'S;=`1e<%l?Ah/^?Ah?BY+P?BY?Mn/^?MnO+P!VFQbiSOpAYqrE{rsAYswE{wxAYx!PE{!P!QAY!Q!]E{!]!^GY!^!aAY!a#sE{#s$fAY$f;'SE{;'S;=`G|<%l?AhE{?Ah?BYAY?BY?MnE{?MnOAY!VGaXiSc!Rqr0msw0mx!P0m!Q!^0m!a#s0m$f;'S0m;'S;=`1_<%l?Ah0m?BY?Mn0m!VHPP;=`<%lE{!_HVP;=`<%lBw!ZHcW!cxaP!b`Or(trs'ksv(tw!^(t!^!_)e!_;'S(t;'S;=`*P<%lO(t!aIYliSaPlW!b`!dpOX$qXZ&XZ[$q[^&X^p$qpq&Xqr-_rs&}sv-_vw/^wx(tx}-_}!OKQ!O!P-_!P!Q$q!Q!^-_!^!_*V!_!a&X!a#S-_#S#T1k#T#s-_#s$f$q$f;'S-_;'S;=`3X<%l?Ah-_?Ah?BY$q?BY?Mn-_?MnO$q!aK_kiSaPlW!b`!dpOX$qXZ&XZ[$q[^&X^p$qpq&Xqr-_rs&}sv-_vw/^wx(tx!P-_!P!Q$q!Q!^-_!^!_*V!_!`&X!`!aMS!a#S-_#S#T1k#T#s-_#s$f$q$f;'S-_;'S;=`3X<%l?Ah-_?Ah?BY$q?BY?Mn-_?MnO$q!TM_XaP!b`!dp!fQOr&Xrs&}sv&Xwx(tx!^&X!^!_*V!_;'S&X;'S;=`*y<%lO&X!aNZ!ZiSgQaPlW!b`!dpOX$qXZ&XZ[$q[^&X^p$qpq&Xqr-_rs&}sv-_vw/^wx(tx}-_}!OMz!O!PMz!P!Q$q!Q![Mz![!]Mz!]!^-_!^!_*V!_!a&X!a!c-_!c!}Mz!}#R-_#R#SMz#S#T1k#T#oMz#o#s-_#s$f$q$f$}-_$}%OMz%O%W-_%W%oMz%o%p-_%p&aMz&a&b-_&b1pMz1p4UMz4U4dMz4d4e-_4e$ISMz$IS$I`-_$I`$IbMz$Ib$Je-_$Je$JgMz$Jg$Kh-_$Kh%#tMz%#t&/x-_&/x&EtMz&Et&FV-_&FV;'SMz;'S;:j!#|;:j;=`3X<%l?&r-_?&r?AhMz?Ah?BY$q?BY?MnMz?MnO$q!a!$PP;=`<%lMz!R!$ZY!b`!dpOq*Vqr!$yrs(Vsv*Vwx)ex!a*V!a!b!4t!b;'S*V;'S;=`*s<%lO*V!R!%Q]!b`!dpOr*Vrs(Vsv*Vwx)ex}*V}!O!%y!O!f*V!f!g!']!g#W*V#W#X!0`#X;'S*V;'S;=`*s<%lO*V!R!&QX!b`!dpOr*Vrs(Vsv*Vwx)ex}*V}!O!&m!O;'S*V;'S;=`*s<%lO*V!R!&vV!b`!dp!ePOr*Vrs(Vsv*Vwx)ex;'S*V;'S;=`*s<%lO*V!R!'dX!b`!dpOr*Vrs(Vsv*Vwx)ex!q*V!q!r!(P!r;'S*V;'S;=`*s<%lO*V!R!(WX!b`!dpOr*Vrs(Vsv*Vwx)ex!e*V!e!f!(s!f;'S*V;'S;=`*s<%lO*V!R!(zX!b`!dpOr*Vrs(Vsv*Vwx)ex!v*V!v!w!)g!w;'S*V;'S;=`*s<%lO*V!R!)nX!b`!dpOr*Vrs(Vsv*Vwx)ex!{*V!{!|!*Z!|;'S*V;'S;=`*s<%lO*V!R!*bX!b`!dpOr*Vrs(Vsv*Vwx)ex!r*V!r!s!*}!s;'S*V;'S;=`*s<%lO*V!R!+UX!b`!dpOr*Vrs(Vsv*Vwx)ex!g*V!g!h!+q!h;'S*V;'S;=`*s<%lO*V!R!+xY!b`!dpOr!+qrs!,hsv!+qvw!-Swx!.[x!`!+q!`!a!/j!a;'S!+q;'S;=`!0Y<%lO!+qq!,mV!dpOv!,hvx!-Sx!`!,h!`!a!-q!a;'S!,h;'S;=`!.U<%lO!,hP!-VTO!`!-S!`!a!-f!a;'S!-S;'S;=`!-k<%lO!-SP!-kO|PP!-nP;=`<%l!-Sq!-xS!dp|POv(Vx;'S(V;'S;=`(h<%lO(Vq!.XP;=`<%l!,ha!.aX!b`Or!.[rs!-Ssv!.[vw!-Sw!`!.[!`!a!.|!a;'S!.[;'S;=`!/d<%lO!.[a!/TT!b`|POr)esv)ew;'S)e;'S;=`)y<%lO)ea!/gP;=`<%l!.[!R!/sV!b`!dp|POr*Vrs(Vsv*Vwx)ex;'S*V;'S;=`*s<%lO*V!R!0]P;=`<%l!+q!R!0gX!b`!dpOr*Vrs(Vsv*Vwx)ex#c*V#c#d!1S#d;'S*V;'S;=`*s<%lO*V!R!1ZX!b`!dpOr*Vrs(Vsv*Vwx)ex#V*V#V#W!1v#W;'S*V;'S;=`*s<%lO*V!R!1}X!b`!dpOr*Vrs(Vsv*Vwx)ex#h*V#h#i!2j#i;'S*V;'S;=`*s<%lO*V!R!2qX!b`!dpOr*Vrs(Vsv*Vwx)ex#m*V#m#n!3^#n;'S*V;'S;=`*s<%lO*V!R!3eX!b`!dpOr*Vrs(Vsv*Vwx)ex#d*V#d#e!4Q#e;'S*V;'S;=`*s<%lO*V!R!4XX!b`!dpOr*Vrs(Vsv*Vwx)ex#X*V#X#Y!+q#Y;'S*V;'S;=`*s<%lO*V!R!4{Y!b`!dpOr!4trs!5ksv!4tvw!6Vwx!8]x!a!4t!a!b!:]!b;'S!4t;'S;=`!;r<%lO!4tq!5pV!dpOv!5kvx!6Vx!a!5k!a!b!7W!b;'S!5k;'S;=`!8V<%lO!5kP!6YTO!a!6V!a!b!6i!b;'S!6V;'S;=`!7Q<%lO!6VP!6lTO!`!6V!`!a!6{!a;'S!6V;'S;=`!7Q<%lO!6VP!7QOyPP!7TP;=`<%l!6Vq!7]V!dpOv!5kvx!6Vx!`!5k!`!a!7r!a;'S!5k;'S;=`!8V<%lO!5kq!7yS!dpyPOv(Vx;'S(V;'S;=`(h<%lO(Vq!8YP;=`<%l!5ka!8bX!b`Or!8]rs!6Vsv!8]vw!6Vw!a!8]!a!b!8}!b;'S!8];'S;=`!:V<%lO!8]a!9SX!b`Or!8]rs!6Vsv!8]vw!6Vw!`!8]!`!a!9o!a;'S!8];'S;=`!:V<%lO!8]a!9vT!b`yPOr)esv)ew;'S)e;'S;=`)y<%lO)ea!:YP;=`<%l!8]!R!:dY!b`!dpOr!4trs!5ksv!4tvw!6Vwx!8]x!`!4t!`!a!;S!a;'S!4t;'S;=`!;r<%lO!4t!R!;]V!b`!dpyPOr*Vrs(Vsv*Vwx)ex;'S*V;'S;=`*s<%lO*V!R!;uP;=`<%l!4t!V!<TXjSaP!b`!dpOr&Xrs&}sv&Xwx(tx!^&X!^!_*V!_;'S&X;'S;=`*y<%lO&X",
    tokenizers: [scriptTokens, styleTokens, textareaTokens, endTag, tagStart, commentContent, 0, 1, 2, 3, 4, 5],
    topRules: { "Document": [0, 16] },
    dialects: { noMatch: 0, selfClosing: 515 },
    tokenPrec: 517
  });

  // node_modules/@lezer/javascript/dist/index.js
  var noSemi = 316;
  var noSemiType = 317;
  var incdec = 1;
  var incdecPrefix = 2;
  var questionDot = 3;
  var JSXStartTag = 4;
  var insertSemi = 318;
  var spaces = 320;
  var newline = 321;
  var LineComment = 5;
  var BlockComment = 6;
  var Dialect_jsx = 0;
  var space = [
    9,
    10,
    11,
    12,
    13,
    32,
    133,
    160,
    5760,
    8192,
    8193,
    8194,
    8195,
    8196,
    8197,
    8198,
    8199,
    8200,
    8201,
    8202,
    8232,
    8233,
    8239,
    8287,
    12288
  ];
  var braceR = 125;
  var semicolon = 59;
  var slash2 = 47;
  var star = 42;
  var plus = 43;
  var minus = 45;
  var lt = 60;
  var comma = 44;
  var question2 = 63;
  var dot = 46;
  var bracketL = 91;
  var trackNewline = new ContextTracker({
    start: false,
    shift(context, term) {
      return term == LineComment || term == BlockComment || term == spaces ? context : term == newline;
    },
    strict: false
  });
  var insertSemicolon = new ExternalTokenizer((input, stack) => {
    let { next } = input;
    if (next == braceR || next == -1 || stack.context)
      input.acceptToken(insertSemi);
  }, { contextual: true, fallback: true });
  var noSemicolon = new ExternalTokenizer((input, stack) => {
    let { next } = input, after;
    if (space.indexOf(next) > -1) return;
    if (next == slash2 && ((after = input.peek(1)) == slash2 || after == star)) return;
    if (next != braceR && next != semicolon && next != -1 && !stack.context)
      input.acceptToken(noSemi);
  }, { contextual: true });
  var noSemicolonType = new ExternalTokenizer((input, stack) => {
    if (input.next == bracketL && !stack.context) input.acceptToken(noSemiType);
  }, { contextual: true });
  var operatorToken = new ExternalTokenizer((input, stack) => {
    let { next } = input;
    if (next == plus || next == minus) {
      input.advance();
      if (next == input.next) {
        input.advance();
        let mayPostfix = !stack.context && stack.canShift(incdec);
        input.acceptToken(mayPostfix ? incdec : incdecPrefix);
      }
    } else if (next == question2 && input.peek(1) == dot) {
      input.advance();
      input.advance();
      if (input.next < 48 || input.next > 57)
        input.acceptToken(questionDot);
    }
  }, { contextual: true });
  function identifierChar(ch, start) {
    return ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122 || ch == 95 || ch >= 192 || !start && ch >= 48 && ch <= 57;
  }
  var jsx = new ExternalTokenizer((input, stack) => {
    if (input.next != lt || !stack.dialectEnabled(Dialect_jsx)) return;
    input.advance();
    if (input.next == slash2) return;
    let back = 0;
    while (space.indexOf(input.next) > -1) {
      input.advance();
      back++;
    }
    if (identifierChar(input.next, true)) {
      input.advance();
      back++;
      while (identifierChar(input.next, false)) {
        input.advance();
        back++;
      }
      while (space.indexOf(input.next) > -1) {
        input.advance();
        back++;
      }
      if (input.next == comma) return;
      for (let i = 0; ; i++) {
        if (i == 7) {
          if (!identifierChar(input.next, true)) return;
          break;
        }
        if (input.next != "extends".charCodeAt(i)) break;
        input.advance();
        back++;
      }
    }
    input.acceptToken(JSXStartTag, -back);
  });
  var jsHighlight = styleTags({
    "get set async static": tags.modifier,
    "for while do if else switch try catch finally return throw break continue default case defer": tags.controlKeyword,
    "in of await yield void typeof delete instanceof as satisfies": tags.operatorKeyword,
    "let var const using function class extends": tags.definitionKeyword,
    "import export from": tags.moduleKeyword,
    "with debugger new": tags.keyword,
    TemplateString: tags.special(tags.string),
    super: tags.atom,
    BooleanLiteral: tags.bool,
    this: tags.self,
    null: tags.null,
    Star: tags.modifier,
    VariableName: tags.variableName,
    "CallExpression/VariableName TaggedTemplateExpression/VariableName": tags.function(tags.variableName),
    VariableDefinition: tags.definition(tags.variableName),
    Label: tags.labelName,
    PropertyName: tags.propertyName,
    PrivatePropertyName: tags.special(tags.propertyName),
    "CallExpression/MemberExpression/PropertyName": tags.function(tags.propertyName),
    "FunctionDeclaration/VariableDefinition": tags.function(tags.definition(tags.variableName)),
    "ClassDeclaration/VariableDefinition": tags.definition(tags.className),
    "NewExpression/VariableName": tags.className,
    PropertyDefinition: tags.definition(tags.propertyName),
    PrivatePropertyDefinition: tags.definition(tags.special(tags.propertyName)),
    UpdateOp: tags.updateOperator,
    "LineComment Hashbang": tags.lineComment,
    BlockComment: tags.blockComment,
    Number: tags.number,
    String: tags.string,
    Escape: tags.escape,
    ArithOp: tags.arithmeticOperator,
    LogicOp: tags.logicOperator,
    BitOp: tags.bitwiseOperator,
    CompareOp: tags.compareOperator,
    RegExp: tags.regexp,
    Equals: tags.definitionOperator,
    Arrow: tags.function(tags.punctuation),
    ": Spread": tags.punctuation,
    "( )": tags.paren,
    "[ ]": tags.squareBracket,
    "{ }": tags.brace,
    "InterpolationStart InterpolationEnd": tags.special(tags.brace),
    ".": tags.derefOperator,
    ", ;": tags.separator,
    "@": tags.meta,
    TypeName: tags.typeName,
    TypeDefinition: tags.definition(tags.typeName),
    "type enum interface implements namespace module declare": tags.definitionKeyword,
    "abstract global Privacy readonly override": tags.modifier,
    "is keyof unique infer asserts": tags.operatorKeyword,
    JSXAttributeValue: tags.attributeValue,
    JSXText: tags.content,
    "JSXStartTag JSXStartCloseTag JSXSelfCloseEndTag JSXEndTag": tags.angleBracket,
    "JSXIdentifier JSXNameSpacedName": tags.tagName,
    "JSXAttribute/JSXIdentifier JSXAttribute/JSXNameSpacedName": tags.attributeName,
    "JSXBuiltin/JSXIdentifier": tags.standard(tags.tagName)
  });
  var spec_identifier = { __proto__: null, export: 20, as: 25, from: 33, default: 36, async: 41, function: 42, in: 52, out: 55, const: 56, extends: 60, this: 64, true: 72, false: 72, null: 84, void: 88, typeof: 92, super: 108, new: 142, delete: 154, yield: 163, await: 167, class: 172, public: 235, private: 235, protected: 235, readonly: 237, instanceof: 256, satisfies: 259, import: 292, keyof: 349, unique: 353, infer: 359, asserts: 395, is: 397, abstract: 417, implements: 419, type: 421, let: 424, var: 426, using: 429, interface: 435, enum: 439, namespace: 445, module: 447, declare: 451, global: 455, defer: 471, for: 476, of: 485, while: 488, with: 492, do: 496, if: 500, else: 502, switch: 506, case: 512, try: 518, catch: 522, finally: 526, return: 530, throw: 534, break: 538, continue: 542, debugger: 546 };
  var spec_word = { __proto__: null, async: 129, get: 131, set: 133, declare: 195, public: 197, private: 197, protected: 197, static: 199, abstract: 201, override: 203, readonly: 209, accessor: 211, new: 401 };
  var spec_LessThan = { __proto__: null, "<": 193 };
  var parser2 = LRParser.deserialize({
    version: 14,
    states: "$F|Q%TQlOOO%[QlOOO'_QpOOP(lO`OOO*zQ!0MxO'#CiO+RO#tO'#CjO+aO&jO'#CjO+oO#@ItO'#DaO.QQlO'#DgO.bQlO'#DrO%[QlO'#DzO0fQlO'#ESOOQ!0Lf'#E['#E[O1PQ`O'#EXOOQO'#Ep'#EpOOQO'#Il'#IlO1XQ`O'#GsO1dQ`O'#EoO1iQ`O'#EoO3hQ!0MxO'#JrO6[Q!0MxO'#JsO6uQ`O'#F]O6zQ,UO'#FtOOQ!0Lf'#Ff'#FfO7VO7dO'#FfO9XQMhO'#F|O9`Q`O'#F{OOQ!0Lf'#Js'#JsOOQ!0Lb'#Jr'#JrO9eQ`O'#GwOOQ['#K_'#K_O9pQ`O'#IYO9uQ!0LrO'#IZOOQ['#J`'#J`OOQ['#I_'#I_Q`QlOOQ`QlOOO9}Q!L^O'#DvO:UQlO'#EOO:]QlO'#EQO9kQ`O'#GsO:dQMhO'#CoO:rQ`O'#EnO:}Q`O'#EyO;hQMhO'#FeO;xQ`O'#GsOOQO'#K`'#K`O;}Q`O'#K`O<]Q`O'#G{O<]Q`O'#G|O<]Q`O'#HOO9kQ`O'#HRO=SQ`O'#HUO>kQ`O'#CeO>{Q`O'#HcO?TQ`O'#HiO?TQ`O'#HkO`QlO'#HmO?TQ`O'#HoO?TQ`O'#HrO?YQ`O'#HxO?_Q!0LsO'#IOO%[QlO'#IQO?jQ!0LsO'#ISO?uQ!0LsO'#IUO9uQ!0LrO'#IWO@QQ!0MxO'#CiOASQpO'#DlQOQ`OOO%[QlO'#EQOAjQ`O'#ETO:dQMhO'#EnOAuQ`O'#EnOBQQ!bO'#FeOOQ['#Cg'#CgOOQ!0Lb'#Dq'#DqOOQ!0Lb'#Jv'#JvO%[QlO'#JvOOQO'#Jy'#JyOOQO'#Ih'#IhOCQQpO'#EgOOQ!0Lb'#Ef'#EfOOQ!0Lb'#J}'#J}OC|Q!0MSO'#EgODWQpO'#EWOOQO'#Jx'#JxODlQpO'#JyOEyQpO'#EWODWQpO'#EgPFWO&2DjO'#CbPOOO)CD})CD}OOOO'#I`'#I`OFcO#tO,59UOOQ!0Lh,59U,59UOOOO'#Ia'#IaOFqO&jO,59UOGPQ!L^O'#DcOOOO'#Ic'#IcOGWO#@ItO,59{OOQ!0Lf,59{,59{OGfQlO'#IdOGyQ`O'#JtOIxQ!fO'#JtO+}QlO'#JtOJPQ`O,5:ROJgQ`O'#EpOJtQ`O'#KTOKPQ`O'#KSOKPQ`O'#KSOKXQ`O,5;^OK^Q`O'#KROOQ!0Ln,5:^,5:^OKeQlO,5:^OMcQ!0MxO,5:fONSQ`O,5:nONmQ!0LrO'#KQONtQ`O'#KPO9eQ`O'#KPO! YQ`O'#KPO! bQ`O,5;]O! gQ`O'#KPO!#lQ!fO'#JsOOQ!0Lh'#Ci'#CiO%[QlO'#ESO!$[Q!fO,5:sOOQS'#Jz'#JzOOQO-E<j-E<jO9kQ`O,5=_O!$rQ`O,5=_O!$wQlO,5;ZO!&zQMhO'#EkO!(eQ`O,5;ZO!(jQlO'#DyO!(tQpO,5;dO!(|QpO,5;dO%[QlO,5;dOOQ['#FT'#FTOOQ['#FV'#FVO%[QlO,5;eO%[QlO,5;eO%[QlO,5;eO%[QlO,5;eO%[QlO,5;eO%[QlO,5;eO%[QlO,5;eO%[QlO,5;eO%[QlO,5;eO%[QlO,5;eOOQ['#FZ'#FZO!)[QlO,5;tOOQ!0Lf,5;y,5;yOOQ!0Lf,5;z,5;zOOQ!0Lf,5;|,5;|O%[QlO'#IpO!+_Q!0LrO,5<iO%[QlO,5;eO!&zQMhO,5;eO!+|QMhO,5;eO!-nQMhO'#E^O%[QlO,5;wOOQ!0Lf,5;{,5;{O!-uQ,UO'#FjO!.rQ,UO'#KXO!.^Q,UO'#KXO!.yQ,UO'#KXOOQO'#KX'#KXO!/_Q,UO,5<SOOOW,5<`,5<`O!/pQlO'#FvOOOW'#Io'#IoO7VO7dO,5<QO!/wQ,UO'#FxOOQ!0Lf,5<Q,5<QO!0hQ$IUO'#CyOOQ!0Lh'#C}'#C}O!0{O#@ItO'#DRO!1iQMjO,5<eO!1pQ`O,5<hO!3YQ(CWO'#GXO!3jQ`O'#GYO!3oQ`O'#GYO!5_Q(CWO'#G^O!6dQpO'#GbOOQO'#Gn'#GnO!,TQMhO'#GmOOQO'#Gp'#GpO!,TQMhO'#GoO!7VQ$IUO'#JlOOQ!0Lh'#Jl'#JlO!7aQ`O'#JkO!7oQ`O'#JjO!7wQ`O'#CuOOQ!0Lh'#C{'#C{O!8YQ`O'#C}OOQ!0Lh'#DV'#DVOOQ!0Lh'#DX'#DXO!8_Q`O,5<eO1SQ`O'#DZO!,TQMhO'#GPO!,TQMhO'#GRO!8gQ`O'#GTO!8lQ`O'#GUO!3oQ`O'#G[O!,TQMhO'#GaO<]Q`O'#JkO!8qQ`O'#EqO!9`Q`O,5<gOOQ!0Lb'#Cr'#CrO!9hQ`O'#ErO!:bQpO'#EsOOQ!0Lb'#KR'#KRO!:iQ!0LrO'#KaO9uQ!0LrO,5=cO`QlO,5>tOOQ['#Jh'#JhOOQ[,5>u,5>uOOQ[-E<]-E<]O!<hQ!0MxO,5:bO!:]QpO,5:`O!?RQ!0MxO,5:jO%[QlO,5:jO!AiQ!0MxO,5:lOOQO,5@z,5@zO!BYQMhO,5=_O!BhQ!0LrO'#JiO9`Q`O'#JiO!ByQ!0LrO,59ZO!CUQpO,59ZO!C^QMhO,59ZO:dQMhO,59ZO!CiQ`O,5;ZO!CqQ`O'#HbO!DVQ`O'#KdO%[QlO,5;}O!:]QpO,5<PO!D_Q`O,5=zO!DdQ`O,5=zO!DiQ`O,5=zO!DwQ`O,5=zO9uQ!0LrO,5=zO<]Q`O,5=jOOQO'#Cy'#CyO!EOQpO,5=gO!EWQMhO,5=hO!EcQ`O,5=jO!EhQ!bO,5=mO!EpQ`O'#K`O?YQ`O'#HWO9kQ`O'#HYO!EuQ`O'#HYO:dQMhO'#H[O!EzQ`O'#H[OOQ[,5=p,5=pO!FPQ`O'#H]O!FbQ`O'#CoO!FgQ`O,59PO!FqQ`O,59PO!HvQlO,59POOQ[,59P,59PO!IWQ!0LrO,59PO%[QlO,59PO!KcQlO'#HeOOQ['#Hf'#HfOOQ['#Hg'#HgO`QlO,5=}O!KyQ`O,5=}O`QlO,5>TO`QlO,5>VO!LOQ`O,5>XO`QlO,5>ZO!LTQ`O,5>^O!LYQlO,5>dOOQ[,5>j,5>jO%[QlO,5>jO9uQ!0LrO,5>lOOQ[,5>n,5>nO#!dQ`O,5>nOOQ[,5>p,5>pO#!dQ`O,5>pOOQ[,5>r,5>rO##QQpO'#D_O%[QlO'#JvO##sQpO'#JvO##}QpO'#DmO#$`QpO'#DmO#&qQlO'#DmO#&xQ`O'#JuO#'QQ`O,5:WO#'VQ`O'#EtO#'eQ`O'#KUO#'mQ`O,5;_O#'rQpO'#DmO#(PQpO'#EVOOQ!0Lf,5:o,5:oO%[QlO,5:oO#(WQ`O,5:oO?YQ`O,5;YO!CUQpO,5;YO!C^QMhO,5;YO:dQMhO,5;YO#(`Q`O,5@bO#(eQ07dO,5:sOOQO-E<f-E<fO#)kQ!0MSO,5;RODWQpO,5:rO#)uQpO,5:rODWQpO,5;RO!ByQ!0LrO,5:rOOQ!0Lb'#Ej'#EjOOQO,5;R,5;RO%[QlO,5;RO#*SQ!0LrO,5;RO#*_Q!0LrO,5;RO!CUQpO,5:rOOQO,5;X,5;XO#*mQ!0LrO,5;RPOOO'#I^'#I^P#+RO&2DjO,58|POOO,58|,58|OOOO-E<^-E<^OOQ!0Lh1G.p1G.pOOOO-E<_-E<_OOOO,59},59}O#+^Q!bO,59}OOOO-E<a-E<aOOQ!0Lf1G/g1G/gO#+cQ!fO,5?OO+}QlO,5?OOOQO,5?U,5?UO#+mQlO'#IdOOQO-E<b-E<bO#+zQ`O,5@`O#,SQ!fO,5@`O#,ZQ`O,5@nOOQ!0Lf1G/m1G/mO%[QlO,5@oO#,cQ`O'#IjOOQO-E<h-E<hO#,ZQ`O,5@nOOQ!0Lb1G0x1G0xOOQ!0Ln1G/x1G/xOOQ!0Ln1G0Y1G0YO%[QlO,5@lO#,wQ!0LrO,5@lO#-YQ!0LrO,5@lO#-aQ`O,5@kO9eQ`O,5@kO#-iQ`O,5@kO#-wQ`O'#ImO#-aQ`O,5@kOOQ!0Lb1G0w1G0wO!(tQpO,5:uO!)PQpO,5:uOOQS,5:w,5:wO#.iQdO,5:wO#.qQMhO1G2yO9kQ`O1G2yOOQ!0Lf1G0u1G0uO#/PQ!0MxO1G0uO#0UQ!0MvO,5;VOOQ!0Lh'#GW'#GWO#0rQ!0MzO'#JlO!$wQlO1G0uO#2}Q!fO'#JwO%[QlO'#JwO#3XQ`O,5:eOOQ!0Lh'#D_'#D_OOQ!0Lf1G1O1G1OO%[QlO1G1OOOQ!0Lf1G1f1G1fO#3^Q`O1G1OO#5rQ!0MxO1G1PO#5yQ!0MxO1G1PO#8aQ!0MxO1G1PO#8hQ!0MxO1G1PO#;OQ!0MxO1G1PO#=fQ!0MxO1G1PO#=mQ!0MxO1G1PO#=tQ!0MxO1G1PO#@[Q!0MxO1G1PO#@cQ!0MxO1G1PO#BpQ?MtO'#CiO#DkQ?MtO1G1`O#DrQ?MtO'#JsO#EVQ!0MxO,5?[OOQ!0Lb-E<n-E<nO#GdQ!0MxO1G1PO#HaQ!0MzO1G1POOQ!0Lf1G1P1G1PO#IdQMjO'#J|O#InQ`O,5:xO#IsQ!0MxO1G1cO#JgQ,UO,5<WO#JoQ,UO,5<XO#JwQ,UO'#FoO#K`Q`O'#FnOOQO'#KY'#KYOOQO'#In'#InO#KeQ,UO1G1nOOQ!0Lf1G1n1G1nOOOW1G1y1G1yO#KvQ?MtO'#JrO#LQQ`O,5<bO!)[QlO,5<bOOOW-E<m-E<mOOQ!0Lf1G1l1G1lO#LVQpO'#KXOOQ!0Lf,5<d,5<dO#L_QpO,5<dO#LdQMhO'#DTOOOO'#Ib'#IbO#LkO#@ItO,59mOOQ!0Lh,59m,59mO%[QlO1G2PO!8lQ`O'#IrO#LvQ`O,5<zOOQ!0Lh,5<w,5<wO!,TQMhO'#IuO#MdQMjO,5=XO!,TQMhO'#IwO#NVQMjO,5=ZO!&zQMhO,5=]OOQO1G2S1G2SO#NaQ!dO'#CrO#NtQ(CWO'#ErO$ |QpO'#GbO$!dQ!dO,5<sO$!kQ`O'#K[O9eQ`O'#K[O$!yQ`O,5<uO$#aQ!dO'#C{O!,TQMhO,5<tO$#kQ`O'#GZO$$PQ`O,5<tO$$UQ!dO'#GWO$$cQ!dO'#K]O$$mQ`O'#K]O!&zQMhO'#K]O$$rQ`O,5<xO$$wQlO'#JvO$%RQpO'#GcO#$`QpO'#GcO$%dQ`O'#GgO!3oQ`O'#GkO$%iQ!0LrO'#ItO$%tQpO,5<|OOQ!0Lp,5<|,5<|O$%{QpO'#GcO$&YQpO'#GdO$&kQpO'#GdO$&pQMjO,5=XO$'QQMjO,5=ZOOQ!0Lh,5=^,5=^O!,TQMhO,5@VO!,TQMhO,5@VO$'bQ`O'#IyO$'vQ`O,5@UO$(OQ`O,59aOOQ!0Lh,59i,59iO$(TQ`O,5@VO$)TQ$IYO,59uOOQ!0Lh'#Jp'#JpO$)vQMjO,5<kO$*iQMjO,5<mO@zQ`O,5<oOOQ!0Lh,5<p,5<pO$*sQ`O,5<vO$*xQMjO,5<{O$+YQ`O'#KPO!$wQlO1G2RO$+_Q`O1G2RO9eQ`O'#KSO9eQ`O'#EtO%[QlO'#EtO9eQ`O'#I{O$+dQ!0LrO,5@{OOQ[1G2}1G2}OOQ[1G4`1G4`OOQ!0Lf1G/|1G/|OOQ!0Lf1G/z1G/zO$-fQ!0MxO1G0UOOQ[1G2y1G2yO!&zQMhO1G2yO%[QlO1G2yO#.tQ`O1G2yO$/jQMhO'#EkOOQ!0Lb,5@T,5@TO$/wQ!0LrO,5@TOOQ[1G.u1G.uO!ByQ!0LrO1G.uO!CUQpO1G.uO!C^QMhO1G.uO$0YQ`O1G0uO$0_Q`O'#CiO$0jQ`O'#KeO$0rQ`O,5=|O$0wQ`O'#KeO$0|Q`O'#KeO$1[Q`O'#JRO$1jQ`O,5AOO$1rQ!fO1G1iOOQ!0Lf1G1k1G1kO9kQ`O1G3fO@zQ`O1G3fO$1yQ`O1G3fO$2OQ`O1G3fO!DiQ`O1G3fO9uQ!0LrO1G3fOOQ[1G3f1G3fO!EcQ`O1G3UO!&zQMhO1G3RO$2TQ`O1G3ROOQ[1G3S1G3SO!&zQMhO1G3SO$2YQ`O1G3SO$2bQpO'#HQOOQ[1G3U1G3UO!6_QpO'#I}O!EhQ!bO1G3XOOQ[1G3X1G3XOOQ[,5=r,5=rO$2jQMhO,5=tO9kQ`O,5=tO$%dQ`O,5=vO9`Q`O,5=vO!CUQpO,5=vO!C^QMhO,5=vO:dQMhO,5=vO$2xQ`O'#KcO$3TQ`O,5=wOOQ[1G.k1G.kO$3YQ!0LrO1G.kO@zQ`O1G.kO$3eQ`O1G.kO9uQ!0LrO1G.kO$5mQ!fO,5AQO$5zQ`O,5AQO9eQ`O,5AQO$6VQlO,5>PO$6^Q`O,5>POOQ[1G3i1G3iO`QlO1G3iOOQ[1G3o1G3oOOQ[1G3q1G3qO?TQ`O1G3sO$6cQlO1G3uO$:gQlO'#HtOOQ[1G3x1G3xO$:tQ`O'#HzO?YQ`O'#H|OOQ[1G4O1G4OO$:|QlO1G4OO9uQ!0LrO1G4UOOQ[1G4W1G4WOOQ!0Lb'#G_'#G_O9uQ!0LrO1G4YO9uQ!0LrO1G4[O$?TQ`O,5@bO!)[QlO,5;`O9eQ`O,5;`O?YQ`O,5:XO!)[QlO,5:XO!CUQpO,5:XO$?YQ?MtO,5:XOOQO,5;`,5;`O$?dQpO'#IeO$?zQ`O,5@aOOQ!0Lf1G/r1G/rO$@SQpO'#IkO$@^Q`O,5@pOOQ!0Lb1G0y1G0yO#$`QpO,5:XOOQO'#Ig'#IgO$@fQpO,5:qOOQ!0Ln,5:q,5:qO#(ZQ`O1G0ZOOQ!0Lf1G0Z1G0ZO%[QlO1G0ZOOQ!0Lf1G0t1G0tO?YQ`O1G0tO!CUQpO1G0tO!C^QMhO1G0tOOQ!0Lb1G5|1G5|O!ByQ!0LrO1G0^OOQO1G0m1G0mO%[QlO1G0mO$@mQ!0LrO1G0mO$@xQ!0LrO1G0mO!CUQpO1G0^ODWQpO1G0^O$AWQ!0LrO1G0mOOQO1G0^1G0^O$AlQ!0MxO1G0mPOOO-E<[-E<[POOO1G.h1G.hOOOO1G/i1G/iO$AvQ!bO,5<iO$BOQ!fO1G4jOOQO1G4p1G4pO%[QlO,5?OO$BYQ`O1G5zO$BbQ`O1G6YO$BjQ!fO1G6ZO9eQ`O,5?UO$BtQ!0MxO1G6WO%[QlO1G6WO$CUQ!0LrO1G6WO$CgQ`O1G6VO$CgQ`O1G6VO9eQ`O1G6VO$CoQ`O,5?XO9eQ`O,5?XOOQO,5?X,5?XO$DTQ`O,5?XO$+YQ`O,5?XOOQO-E<k-E<kOOQS1G0a1G0aOOQS1G0c1G0cO#.lQ`O1G0cOOQ[7+(e7+(eO!&zQMhO7+(eO%[QlO7+(eO$DcQ`O7+(eO$DnQMhO7+(eO$D|Q!0MzO,5=XO$GXQ!0MzO,5=ZO$IdQ!0MzO,5=XO$KuQ!0MzO,5=ZO$NWQ!0MzO,59uO%!]Q!0MzO,5<kO%$hQ!0MzO,5<mO%&sQ!0MzO,5<{OOQ!0Lf7+&a7+&aO%)UQ!0MxO7+&aO%)xQlO'#IfO%*VQ`O,5@cO%*_Q!fO,5@cOOQ!0Lf1G0P1G0PO%*iQ`O7+&jOOQ!0Lf7+&j7+&jO%*nQ?MtO,5:fO%[QlO7+&zO%*xQ?MtO,5:bO%+VQ?MtO,5:jO%+aQ?MtO,5:lO%+kQMhO'#IiO%+uQ`O,5@hOOQ!0Lh1G0d1G0dOOQO1G1r1G1rOOQO1G1s1G1sO%+}Q!jO,5<ZO!)[QlO,5<YOOQO-E<l-E<lOOQ!0Lf7+'Y7+'YOOOW7+'e7+'eOOOW1G1|1G1|O%,YQ`O1G1|OOQ!0Lf1G2O1G2OOOOO,59o,59oO%,_Q!dO,59oOOOO-E<`-E<`OOQ!0Lh1G/X1G/XO%,fQ!0MxO7+'kOOQ!0Lh,5?^,5?^O%-YQMhO1G2fP%-aQ`O'#IrPOQ!0Lh-E<p-E<pO%-}QMjO,5?aOOQ!0Lh-E<s-E<sO%.pQMjO,5?cOOQ!0Lh-E<u-E<uO%.zQ!dO1G2wO%/RQ!dO'#CrO%/iQMhO'#KSO$$wQlO'#JvOOQ!0Lh1G2_1G2_O%/sQ`O'#IqO%0[Q`O,5@vO%0[Q`O,5@vO%0dQ`O,5@vO%0oQ`O,5@vOOQO1G2a1G2aO%0}QMjO1G2`O$+YQ`O'#K[O!,TQMhO1G2`O%1_Q(CWO'#IsO%1lQ`O,5@wO!&zQMhO,5@wO%1tQ!dO,5@wOOQ!0Lh1G2d1G2dO%4UQ!fO'#CiO%4`Q`O,5=POOQ!0Lb,5<},5<}O%4hQpO,5<}OOQ!0Lb,5=O,5=OOCwQ`O,5<}O%4sQpO,5<}OOQ!0Lb,5=R,5=RO$+YQ`O,5=VOOQO,5?`,5?`OOQO-E<r-E<rOOQ!0Lp1G2h1G2hO#$`QpO,5<}O$$wQlO,5=PO%5RQ`O,5=OO%5^QpO,5=OO!,TQMhO'#IuO%6WQMjO1G2sO!,TQMhO'#IwO%6yQMjO1G2uO%7TQMjO1G5qO%7_QMjO1G5qOOQO,5?e,5?eOOQO-E<w-E<wOOQO1G.{1G.{O!,TQMhO1G5qO!,TQMhO1G5qO!:]QpO,59wO%[QlO,59wOOQ!0Lh,5<j,5<jO%7lQ`O1G2ZO!,TQMhO1G2bO%7qQ!0MxO7+'mOOQ!0Lf7+'m7+'mO!$wQlO7+'mO%8eQ`O,5;`OOQ!0Lb,5?g,5?gOOQ!0Lb-E<y-E<yO%8jQ!dO'#K^O#(ZQ`O7+(eO4UQ!fO7+(eO$DfQ`O7+(eO%8tQ!0MvO'#CiO%9XQ!0MvO,5=SO%9lQ`O,5=SO%9tQ`O,5=SOOQ!0Lb1G5o1G5oOOQ[7+$a7+$aO!ByQ!0LrO7+$aO!CUQpO7+$aO!$wQlO7+&aO%9yQ`O'#JQO%:bQ`O,5APOOQO1G3h1G3hO9kQ`O,5APO%:bQ`O,5APO%:jQ`O,5APOOQO,5?m,5?mOOQO-E=P-E=POOQ!0Lf7+'T7+'TO%:oQ`O7+)QO9uQ!0LrO7+)QO9kQ`O7+)QO@zQ`O7+)QO%:tQ`O7+)QOOQ[7+)Q7+)QOOQ[7+(p7+(pO%:yQ!0MvO7+(mO!&zQMhO7+(mO!E^Q`O7+(nOOQ[7+(n7+(nO!&zQMhO7+(nO%;TQ`O'#KbO%;`Q`O,5=lOOQO,5?i,5?iOOQO-E<{-E<{OOQ[7+(s7+(sO%<rQpO'#HZOOQ[1G3`1G3`O!&zQMhO1G3`O%[QlO1G3`O%<yQ`O1G3`O%=UQMhO1G3`O9uQ!0LrO1G3bO$%dQ`O1G3bO9`Q`O1G3bO!CUQpO1G3bO!C^QMhO1G3bO%=dQ`O'#JPO%=xQ`O,5@}O%>QQpO,5@}OOQ!0Lb1G3c1G3cOOQ[7+$V7+$VO@zQ`O7+$VO9uQ!0LrO7+$VO%>]Q`O7+$VO%[QlO1G6lO%[QlO1G6mO%>bQ!0LrO1G6lO%>lQlO1G3kO%>sQ`O1G3kO%>xQlO1G3kOOQ[7+)T7+)TO9uQ!0LrO7+)_O`QlO7+)aOOQ['#Kh'#KhOOQ['#JS'#JSO%?PQlO,5>`OOQ[,5>`,5>`O%[QlO'#HuO%?^Q`O'#HwOOQ[,5>f,5>fO9eQ`O,5>fOOQ[,5>h,5>hOOQ[7+)j7+)jOOQ[7+)p7+)pOOQ[7+)t7+)tOOQ[7+)v7+)vO%?cQpO1G5|O%?}Q?MtO1G0zO%@XQ`O1G0zOOQO1G/s1G/sO%@dQ?MtO1G/sO?YQ`O1G/sO!)[QlO'#DmOOQO,5?P,5?POOQO-E<c-E<cOOQO,5?V,5?VOOQO-E<i-E<iO!CUQpO1G/sOOQO-E<e-E<eOOQ!0Ln1G0]1G0]OOQ!0Lf7+%u7+%uO#(ZQ`O7+%uOOQ!0Lf7+&`7+&`O?YQ`O7+&`O!CUQpO7+&`OOQO7+%x7+%xO$AlQ!0MxO7+&XOOQO7+&X7+&XO%[QlO7+&XO%@nQ!0LrO7+&XO!ByQ!0LrO7+%xO!CUQpO7+%xO%@yQ!0LrO7+&XO%AXQ!0MxO7++rO%[QlO7++rO%AiQ`O7++qO%AiQ`O7++qOOQO1G4s1G4sO9eQ`O1G4sO%AqQ`O1G4sOOQS7+%}7+%}O#(ZQ`O<<LPO4UQ!fO<<LPO%BPQ`O<<LPOOQ[<<LP<<LPO!&zQMhO<<LPO%[QlO<<LPO%BXQ`O<<LPO%BdQ!0MzO,5?aO%DoQ!0MzO,5?cO%FzQ!0MzO1G2`O%I]Q!0MzO1G2sO%KhQ!0MzO1G2uO%MsQ!fO,5?QO%[QlO,5?QOOQO-E<d-E<dO%M}Q`O1G5}OOQ!0Lf<<JU<<JUO%NVQ?MtO1G0uO&!^Q?MtO1G1PO&!eQ?MtO1G1PO&$fQ?MtO1G1PO&$mQ?MtO1G1PO&&nQ?MtO1G1PO&(oQ?MtO1G1PO&(vQ?MtO1G1PO&(}Q?MtO1G1PO&+OQ?MtO1G1PO&+VQ?MtO1G1PO&+^Q!0MxO<<JfO&-UQ?MtO1G1PO&.RQ?MvO1G1PO&/UQ?MvO'#JlO&1[Q?MtO1G1cO&1iQ?MtO1G0UO&1sQMjO,5?TOOQO-E<g-E<gO!)[QlO'#FqOOQO'#KZ'#KZOOQO1G1u1G1uO&1}Q`O1G1tO&2SQ?MtO,5?[OOOW7+'h7+'hOOOO1G/Z1G/ZO&2^Q!dO1G4xOOQ!0Lh7+(Q7+(QP!&zQMhO,5?^O!,TQMhO7+(cO&2eQ`O,5?]O9eQ`O,5?]O$+YQ`O,5?]OOQO-E<o-E<oO&2sQ`O1G6bO&2sQ`O1G6bO&2{Q`O1G6bO&3WQMjO7+'zO&3hQ!dO,5?_O&3rQ`O,5?_O!&zQMhO,5?_OOQO-E<q-E<qO&3wQ!dO1G6cO&4RQ`O1G6cO&4ZQ`O1G2kO!&zQMhO1G2kOOQ!0Lb1G2i1G2iOOQ!0Lb1G2j1G2jO%4hQpO1G2iO!CUQpO1G2iOCwQ`O1G2iOOQ!0Lb1G2q1G2qO&4`QpO1G2iO&4nQ`O1G2kO$+YQ`O1G2jOCwQ`O1G2jO$$wQlO1G2kO&4vQ`O1G2jO&5jQMjO,5?aOOQ!0Lh-E<t-E<tO&6]QMjO,5?cOOQ!0Lh-E<v-E<vO!,TQMhO7++]O&6gQMjO7++]O&6qQMjO7++]OOQ!0Lh1G/c1G/cO&7OQ`O1G/cOOQ!0Lh7+'u7+'uO&7TQMjO7+'|O&7eQ!0MxO<<KXOOQ!0Lf<<KX<<KXO&8XQ`O1G0zO!&zQMhO'#IzO&8^Q`O,5@xO&:`Q!fO<<LPO!&zQMhO1G2nO&:gQ!0LrO1G2nOOQ[<<G{<<G{O!ByQ!0LrO<<G{O&:xQ!0MxO<<I{OOQ!0Lf<<I{<<I{OOQO,5?l,5?lO&;lQ`O,5?lO&;qQ`O,5?lOOQO-E=O-E=OO&<PQ`O1G6kO&<PQ`O1G6kO9kQ`O1G6kO@zQ`O<<LlOOQ[<<Ll<<LlO&<XQ`O<<LlO9uQ!0LrO<<LlO9kQ`O<<LlOOQ[<<LX<<LXO%:yQ!0MvO<<LXOOQ[<<LY<<LYO!E^Q`O<<LYO&<^QpO'#I|O&<iQ`O,5@|O!)[QlO,5@|OOQ[1G3W1G3WOOQO'#JO'#JOO9uQ!0LrO'#JOO&<qQpO,5=uOOQ[,5=u,5=uO&<xQpO'#EgO&=PQpO'#GeO&=UQ`O7+(zO&=ZQ`O7+(zOOQ[7+(z7+(zO!&zQMhO7+(zO%[QlO7+(zO&=cQ`O7+(zOOQ[7+(|7+(|O9uQ!0LrO7+(|O$%dQ`O7+(|O9`Q`O7+(|O!CUQpO7+(|O&=nQ`O,5?kOOQO-E<}-E<}OOQO'#H^'#H^O&=yQ`O1G6iO9uQ!0LrO<<GqOOQ[<<Gq<<GqO@zQ`O<<GqO&>RQ`O7+,WO&>WQ`O7+,XO%[QlO7+,WO%[QlO7+,XOOQ[7+)V7+)VO&>]Q`O7+)VO&>bQlO7+)VO&>iQ`O7+)VOOQ[<<Ly<<LyOOQ[<<L{<<L{OOQ[-E=Q-E=QOOQ[1G3z1G3zO&>nQ`O,5>aOOQ[,5>c,5>cO&>sQ`O1G4QO9eQ`O7+&fO!)[QlO7+&fOOQO7+%_7+%_O&>xQ?MtO1G6ZO?YQ`O7+%_OOQ!0Lf<<Ia<<IaOOQ!0Lf<<Iz<<IzO?YQ`O<<IzOOQO<<Is<<IsO$AlQ!0MxO<<IsO%[QlO<<IsOOQO<<Id<<IdO!ByQ!0LrO<<IdO&?SQ!0LrO<<IsO&?_Q!0MxO<= ^O&?oQ`O<= ]OOQO7+*_7+*_O9eQ`O7+*_OOQ[ANAkANAkO&?wQ!fOANAkO!&zQMhOANAkO#(ZQ`OANAkO4UQ!fOANAkO&@OQ`OANAkO%[QlOANAkO&@WQ!0MzO7+'zO&BiQ!0MzO,5?aO&DtQ!0MzO,5?cO&GPQ!0MzO7+'|O&IbQ!fO1G4lO&IlQ?MtO7+&aO&KpQ?MvO,5=XO&MwQ?MvO,5=ZO&NXQ?MvO,5=XO&NiQ?MvO,5=ZO&NyQ?MvO,59uO'#PQ?MvO,5<kO'%SQ?MvO,5<mO''hQ?MvO,5<{O')^Q?MtO7+'kO')kQ?MtO7+'mO')xQ`O,5<]OOQO7+'`7+'`OOQ!0Lh7+*d7+*dO')}QMjO<<K}OOQO1G4w1G4wO'*UQ`O1G4wO'*aQ`O1G4wO'*oQ`O7++|O'*oQ`O7++|O!&zQMhO1G4yO'*wQ!dO1G4yO'+RQ`O7++}O'+ZQ`O7+(VO'+fQ!dO7+(VOOQ!0Lb7+(T7+(TOOQ!0Lb7+(U7+(UO!CUQpO7+(TOCwQ`O7+(TO'+pQ`O7+(VO!&zQMhO7+(VO$+YQ`O7+(UO'+uQ`O7+(VOCwQ`O7+(UO'+}QMjO<<NwO!,TQMhO<<NwOOQ!0Lh7+$}7+$}O',XQ!dO,5?fOOQO-E<x-E<xO',cQ!0MvO7+(YO!&zQMhO7+(YOOQ[AN=gAN=gO9kQ`O1G5WOOQO1G5W1G5WO',sQ`O1G5WO',xQ`O7+,VO',xQ`O7+,VO9uQ!0LrOANBWO@zQ`OANBWOOQ[ANBWANBWO'-QQ`OANBWOOQ[ANAsANAsOOQ[ANAtANAtO'-VQ`O,5?hOOQO-E<z-E<zO'-bQ?MtO1G6hOOQO,5?j,5?jOOQO-E<|-E<|OOQ[1G3a1G3aO'-lQ`O,5=POOQ[<<Lf<<LfO!&zQMhO<<LfO&=UQ`O<<LfO'-qQ`O<<LfO%[QlO<<LfOOQ[<<Lh<<LhO9uQ!0LrO<<LhO$%dQ`O<<LhO9`Q`O<<LhO'-yQpO1G5VO'.UQ`O7+,TOOQ[AN=]AN=]O9uQ!0LrOAN=]OOQ[<= r<= rOOQ[<= s<= sO'.^Q`O<= rO'.cQ`O<= sOOQ[<<Lq<<LqO'.hQ`O<<LqO'.mQlO<<LqOOQ[1G3{1G3{O?YQ`O7+)lO'.tQ`O<<JQO'/PQ?MtO<<JQOOQO<<Hy<<HyOOQ!0LfAN?fAN?fOOQOAN?_AN?_O$AlQ!0MxOAN?_OOQOAN?OAN?OO%[QlOAN?_OOQO<<My<<MyOOQ[G27VG27VO!&zQMhOG27VO#(ZQ`OG27VO'/ZQ!fOG27VO4UQ!fOG27VO'/bQ`OG27VO'/jQ?MtO<<JfO'/wQ?MvO1G2`O'1mQ?MvO,5?aO'3pQ?MvO,5?cO'5sQ?MvO1G2sO'7vQ?MvO1G2uO'9yQ?MtO<<KXO':WQ?MtO<<I{OOQO1G1w1G1wO!,TQMhOANAiOOQO7+*c7+*cO':eQ`O7+*cO':pQ`O<= hO':xQ!dO7+*eOOQ!0Lb<<Kq<<KqO$+YQ`O<<KqOCwQ`O<<KqO';SQ`O<<KqO!&zQMhO<<KqOOQ!0Lb<<Ko<<KoO!CUQpO<<KoO';_Q!dO<<KqOOQ!0Lb<<Kp<<KpO';iQ`O<<KqO!&zQMhO<<KqO$+YQ`O<<KpO';nQMjOANDcO';xQ!0MvO<<KtOOQO7+*r7+*rO9kQ`O7+*rO'<YQ`O<= qOOQ[G27rG27rO9uQ!0LrOG27rO@zQ`OG27rO!)[QlO1G5SO'<bQ`O7+,SO'<jQ`O1G2kO&=UQ`OANBQOOQ[ANBQANBQO!&zQMhOANBQO'<oQ`OANBQOOQ[ANBSANBSO9uQ!0LrOANBSO$%dQ`OANBSOOQO'#H_'#H_OOQO7+*q7+*qOOQ[G22wG22wOOQ[ANE^ANE^OOQ[ANE_ANE_OOQ[ANB]ANB]O'<wQ`OANB]OOQ[<<MW<<MWO!)[QlOAN?lOOQOG24yG24yO$AlQ!0MxOG24yO#(ZQ`OLD,qOOQ[LD,qLD,qO!&zQMhOLD,qO'<|Q!fOLD,qO'=TQ?MvO7+'zO'>yQ?MvO,5?aO'@|Q?MvO,5?cO'CPQ?MvO7+'|O'DuQMjOG27TOOQO<<M}<<M}OOQ!0LbANA]ANA]O$+YQ`OANA]OCwQ`OANA]O'EVQ!dOANA]OOQ!0LbANAZANAZO'E^Q`OANA]O!&zQMhOANA]O'EiQ!dOANA]OOQ!0LbANA[ANA[OOQO<<N^<<N^OOQ[LD-^LD-^O9uQ!0LrOLD-^O'EsQ?MtO7+*nOOQO'#Gf'#GfOOQ[G27lG27lO&=UQ`OG27lO!&zQMhOG27lOOQ[G27nG27nO9uQ!0LrOG27nOOQ[G27wG27wO'E}Q?MtOG25WOOQOLD*eLD*eOOQ[!$(!]!$(!]O#(ZQ`O!$(!]O!&zQMhO!$(!]O'FXQ!0MzOG27TOOQ!0LbG26wG26wO$+YQ`OG26wO'HjQ`OG26wOCwQ`OG26wO'HuQ!dOG26wO!&zQMhOG26wOOQ[!$(!x!$(!xOOQ[LD-WLD-WO&=UQ`OLD-WOOQ[LD-YLD-YOOQ[!)9Ew!)9EwO#(ZQ`O!)9EwOOQ!0LbLD,cLD,cO$+YQ`OLD,cOCwQ`OLD,cO'H|Q`OLD,cO'IXQ!dOLD,cOOQ[!$(!r!$(!rOOQ[!.K;c!.K;cO'I`Q?MvOG27TOOQ!0Lb!$( }!$( }O$+YQ`O!$( }OCwQ`O!$( }O'KUQ`O!$( }OOQ!0Lb!)9Ei!)9EiO$+YQ`O!)9EiOCwQ`O!)9EiOOQ!0Lb!.K;T!.K;TO$+YQ`O!.K;TOOQ!0Lb!4/0o!4/0oO!)[QlO'#DzO1PQ`O'#EXO'KaQ!fO'#JrO'KhQ!L^O'#DvO'KoQlO'#EOO'KvQ!fO'#CiO'N^Q!fO'#CiO!)[QlO'#EQO'NnQlO,5;ZO!)[QlO,5;eO!)[QlO,5;eO!)[QlO,5;eO!)[QlO,5;eO!)[QlO,5;eO!)[QlO,5;eO!)[QlO,5;eO!)[QlO,5;eO!)[QlO,5;eO!)[QlO,5;eO!)[QlO'#IpO(!qQ`O,5<iO!)[QlO,5;eO(!yQMhO,5;eO($dQMhO,5;eO!)[QlO,5;wO!&zQMhO'#GmO(!yQMhO'#GmO!&zQMhO'#GoO(!yQMhO'#GoO1SQ`O'#DZO1SQ`O'#DZO!&zQMhO'#GPO(!yQMhO'#GPO!&zQMhO'#GRO(!yQMhO'#GRO!&zQMhO'#GaO(!yQMhO'#GaO!)[QlO,5:jO($kQpO'#D_O($uQpO'#JvO!)[QlO,5@oO'NnQlO1G0uO(%PQ?MtO'#CiO!)[QlO1G2PO!&zQMhO'#IuO(!yQMhO'#IuO!&zQMhO'#IwO(!yQMhO'#IwO(%ZQ!dO'#CrO!&zQMhO,5<tO(!yQMhO,5<tO'NnQlO1G2RO!)[QlO7+&zO!&zQMhO1G2`O(!yQMhO1G2`O!&zQMhO'#IuO(!yQMhO'#IuO!&zQMhO'#IwO(!yQMhO'#IwO!&zQMhO1G2bO(!yQMhO1G2bO'NnQlO7+'mO'NnQlO7+&aO!&zQMhOANAiO(!yQMhOANAiO(%nQ`O'#EoO(%sQ`O'#EoO(%{Q`O'#F]O(&QQ`O'#EyO(&VQ`O'#KTO(&bQ`O'#KRO(&mQ`O,5;ZO(&rQMjO,5<eO(&yQ`O'#GYO('OQ`O'#GYO('TQ`O,5<eO(']Q`O,5<gO('eQ`O,5;ZO('mQ?MtO1G1`O('tQ`O,5<tO('yQ`O,5<tO((OQ`O,5<vO((TQ`O,5<vO((YQ`O1G2RO((_Q`O1G0uO((dQMjO<<K}O((kQMjO<<K}O((rQMhO'#F|O9`Q`O'#F{OAuQ`O'#EnO!)[QlO,5;tO!3oQ`O'#GYO!3oQ`O'#GYO!3oQ`O'#G[O!3oQ`O'#G[O!,TQMhO7+(cO!,TQMhO7+(cO%.zQ!dO1G2wO%.zQ!dO1G2wO!&zQMhO,5=]O!&zQMhO,5=]",
    stateData: "()x~O'|OS'}OSTOS(ORQ~OPYOQYOSfOY!VOaqOdzOeyOl!POpkOrYOskOtkOzkO|YO!OYO!SWO!WkO!XkO!_XO!iuO!lZO!oYO!pYO!qYO!svO!uwO!xxO!|]O$W|O$niO%h}O%j!QO%l!OO%m!OO%n!OO%q!RO%s!SO%v!TO%w!TO%y!UO&W!WO&^!XO&`!YO&b!ZO&d![O&g!]O&m!^O&s!_O&u!`O&w!aO&y!bO&{!cO(TSO(VTO(YUO(aVO(o[O~OWtO~P`OPYOQYOSfOd!jOe!iOpkOrYOskOtkOzkO|YO!OYO!SWO!WkO!XkO!_!eO!iuO!lZO!oYO!pYO!qYO!svO!u!gO!x!hO$W!kO$niO(T!dO(VTO(YUO(aVO(o[O~Oa!wOs!nO!S!oO!b!yO!c!vO!d!vO!|<VO#T!pO#U!pO#V!xO#W!pO#X!pO#[!zO#]!zO(U!lO(VTO(YUO(e!mO(o!sO~O(O!{O~OP]XR]X[]Xa]Xj]Xr]X!Q]X!S]X!]]X!l]X!p]X#R]X#S]X#`]X#kfX#n]X#o]X#p]X#q]X#r]X#s]X#t]X#u]X#v]X#x]X#z]X#{]X$Q]X'z]X(a]X(r]X(y]X(z]X~O!g%RX~P(qO_!}O(V#PO(W!}O(X#PO~O_#QO(X#PO(Y#PO(Z#QO~Ox#SO!U#TO(b#TO(c#VO~OPYOQYOSfOd!jOe!iOpkOrYOskOtkOzkO|YO!OYO!SWO!WkO!XkO!_!eO!iuO!lZO!oYO!pYO!qYO!svO!u!gO!x!hO$W!kO$niO(T<ZO(VTO(YUO(aVO(o[O~O![#ZO!]#WO!Y(hP!Y(vP~P+}O!^#cO~P`OPYOQYOSfOd!jOe!iOrYOskOtkOzkO|YO!OYO!SWO!WkO!XkO!_!eO!iuO!lZO!oYO!pYO!qYO!svO!u!gO!x!hO$W!kO$niO(VTO(YUO(aVO(o[O~Op#mO![#iO!|]O#i#lO#j#iO(T<[O!k(sP~P.iO!l#oO(T#nO~O!x#sO!|]O%h#tO~O#k#uO~O!g#vO#k#uO~OP$[OR#zO[$cOj$ROr$aO!Q#yO!S#{O!]$_O!l#xO!p$[O#R$RO#n$OO#o$PO#p$PO#q$PO#r$QO#s$RO#t$RO#u$bO#v$SO#x$UO#z$WO#{$XO(aVO(r$YO(y#|O(z#}O~Oa(fX'z(fX'w(fX!k(fX!Y(fX!_(fX%i(fX!g(fX~P1qO#S$dO#`$eO$Q$eOP(gXR(gX[(gXj(gXr(gX!Q(gX!S(gX!](gX!l(gX!p(gX#R(gX#n(gX#o(gX#p(gX#q(gX#r(gX#s(gX#t(gX#u(gX#v(gX#x(gX#z(gX#{(gX(a(gX(r(gX(y(gX(z(gX!_(gX%i(gX~Oa(gX'z(gX'w(gX!Y(gX!k(gXv(gX!g(gX~P4UO#`$eO~O$]$hO$_$gO$f$mO~OSfO!_$nO$i$oO$k$qO~Oh%VOj%dOk%dOp%WOr%XOs$tOt$tOz%YO|%ZO!O%]O!S${O!_$|O!i%bO!l$xO#j%cO$W%`O$t%^O$v%_O$y%aO(T$sO(VTO(YUO(a$uO(y$}O(z%POg(^P~Ol%[O~P7eO!l%eO~O!S%hO!_%iO(T%gO~O!g%mO~Oa%nO'z%nO~O!Q%rO~P%[O(U!lO~P%[O%n%vO~P%[Oh%VO!l%eO(T%gO(U!lO~Oe%}O!l%eO(T%gO~Oj$RO~O!_&PO(T%gO(U!lO(VTO(YUO`)WP~O!Q&SO!l&RO%j&VO&T&WO~P;SO!x#sO~O%s&YO!S)SX!_)SX(T)SX~O(T&ZO~Ol!PO!u&`O%j!QO%l!OO%m!OO%n!OO%q!RO%s!SO%v!TO%w!TO~Od&eOe&dO!x&bO%h&cO%{&aO~P<bOd&hOeyOl!PO!_&gO!u&`O!xxO!|]O%h}O%l!OO%m!OO%n!OO%q!RO%s!SO%v!TO%w!TO%y!UO~Ob&kO#`&nO%j&iO(U!lO~P=gO!l&oO!u&sO~O!l#oO~O!_XO~Oa%nO'x&{O'z%nO~Oa%nO'x'OO'z%nO~Oa%nO'x'QO'z%nO~O'w]X!Y]Xv]X!k]X&[]X!_]X%i]X!g]X~P(qO!b'_O!c'WO!d'WO(U!lO(VTO(YUO~Os'UO!S'TO!['XO(e'SO!^(iP!^(xP~P@nOn'bO!_'`O(T%gO~Oe'gO!l%eO(T%gO~O!Q&SO!l&RO~Os!nO!S!oO!|<VO#T!pO#U!pO#W!pO#X!pO(U!lO(VTO(YUO(e!mO(o!sO~O!b'mO!c'lO!d'lO#V!pO#['nO#]'nO~PBYOa%nOh%VO!g#vO!l%eO'z%nO(r'pO~O!p'tO#`'rO~PChOs!nO!S!oO(VTO(YUO(e!mO(o!sO~O!_XOs(mX!S(mX!b(mX!c(mX!d(mX!|(mX#T(mX#U(mX#V(mX#W(mX#X(mX#[(mX#](mX(U(mX(V(mX(Y(mX(e(mX(o(mX~O!c'lO!d'lO(U!lO~PDWO(P'xO(Q'xO(R'zO~O_!}O(V'|O(W!}O(X'|O~O_#QO(X'|O(Y'|O(Z#QO~Ov(OO~P%[Ox#SO!U#TO(b#TO(c(RO~O![(TO!Y'WX!Y'^X!]'WX!]'^X~P+}O!](VO!Y(hX~OP$[OR#zO[$cOj$ROr$aO!Q#yO!S#{O!](VO!l#xO!p$[O#R$RO#n$OO#o$PO#p$PO#q$PO#r$QO#s$RO#t$RO#u$bO#v$SO#x$UO#z$WO#{$XO(aVO(r$YO(y#|O(z#}O~O!Y(hX~PHRO!Y([O~O!Y(uX!](uX!g(uX!k(uX(r(uX~O#`(uX#k#dX!^(uX~PJUO#`(]O!Y(wX!](wX~O!](^O!Y(vX~O!Y(aO~O#`$eO~PJUO!^(bO~P`OR#zO!Q#yO!S#{O!l#xO(aVOP!na[!naj!nar!na!]!na!p!na#R!na#n!na#o!na#p!na#q!na#r!na#s!na#t!na#u!na#v!na#x!na#z!na#{!na(r!na(y!na(z!na~Oa!na'z!na'w!na!Y!na!k!nav!na!_!na%i!na!g!na~PKlO!k(cO~O!g#vO#`(dO(r'pO!](tXa(tX'z(tX~O!k(tX~PNXO!S%hO!_%iO!|]O#i(iO#j(hO(T%gO~O!](jO!k(sX~O!k(lO~O!S%hO!_%iO#j(hO(T%gO~OP(gXR(gX[(gXj(gXr(gX!Q(gX!S(gX!](gX!l(gX!p(gX#R(gX#n(gX#o(gX#p(gX#q(gX#r(gX#s(gX#t(gX#u(gX#v(gX#x(gX#z(gX#{(gX(a(gX(r(gX(y(gX(z(gX~O!g#vO!k(gX~P! uOR(nO!Q(mO!l#xO#S$dO!|!{a!S!{a~O!x!{a%h!{a!_!{a#i!{a#j!{a(T!{a~P!#vO!x(rO~OPYOQYOSfOd!jOe!iOpkOrYOskOtkOzkO|YO!OYO!SWO!WkO!XkO!_XO!iuO!lZO!oYO!pYO!qYO!svO!u!gO!x!hO$W!kO$niO(T!dO(VTO(YUO(aVO(o[O~Oh%VOp%WOr%XOs$tOt$tOz%YO|%ZO!O<sO!S${O!_$|O!i>VO!l$xO#j<yO$W%`O$t<uO$v<wO$y%aO(T(vO(VTO(YUO(a$uO(y$}O(z%PO~O#k(xO~O![(zO!k(kP~P%[O(e(|O(o[O~O!S)OO!l#xO(e(|O(o[O~OP<UOQ<UOSfOd>ROe!iOpkOr<UOskOtkOzkO|<UO!O<UO!SWO!WkO!XkO!_!eO!i<XO!lZO!o<UO!p<UO!q<UO!s<YO!u<]O!x!hO$W!kO$n>PO(T)]O(VTO(YUO(aVO(o[O~O!]$_Oa$qa'z$qa'w$qa!k$qa!Y$qa!_$qa%i$qa!g$qa~Ol)dO~P!&zOh%VOp%WOr%XOs$tOt$tOz%YO|%ZO!O%]O!S${O!_$|O!i%bO!l$xO#j%cO$W%`O$t%^O$v%_O$y%aO(T(vO(VTO(YUO(a$uO(y$}O(z%PO~Og(pP~P!,TO!Q)iO!g)hO!_$^X$Z$^X$]$^X$_$^X$f$^X~O!g)hO!_({X$Z({X$]({X$_({X$f({X~O!Q)iO~P!.^O!Q)iO!_({X$Z({X$]({X$_({X$f({X~O!_)kO$Z)oO$])jO$_)jO$f)pO~O![)sO~P!)[O$]$hO$_$gO$f)wO~On$zX!Q$zX#S$zX'y$zX(y$zX(z$zX~OgmXg$zXnmX!]mX#`mX~P!0SOx)yO(b)zO(c)|O~On*VO!Q*OO'y*PO(y$}O(z%PO~Og)}O~P!1WOg*WO~Oh%VOr%XOs$tOt$tOz%YO|%ZO!O<sO!S*YO!_*ZO!i>VO!l$xO#j<yO$W%`O$t<uO$v<wO$y%aO(VTO(YUO(a$uO(y$}O(z%PO~Op*`O![*^O(T*XO!k)OP~P!1uO#k*aO~O!l*bO~Oh%VOp%WOr%XOs$tOt$tOz%YO|%ZO!O<sO!S${O!_$|O!i>VO!l$xO#j<yO$W%`O$t<uO$v<wO$y%aO(T*dO(VTO(YUO(a$uO(y$}O(z%PO~O![*gO!Y)PP~P!3tOr*sOs!nO!S*iO!b*qO!c*kO!d*kO!l*bO#[*rO%`*mO(U!lO(VTO(YUO(e!mO~O!^*pO~P!5iO#S$dOn(`X!Q(`X'y(`X(y(`X(z(`X!](`X#`(`X~Og(`X$O(`X~P!6kOn*xO#`*wOg(_X!](_X~O!]*yOg(^X~Oj%dOk%dOl%dO(T&ZOg(^P~Os*|O~Og)}O(T&ZO~O!l+SO~O(T(vO~Op+WO!S%hO![#iO!_%iO!|]O#i#lO#j#iO(T%gO!k(sP~O!g#vO#k+XO~O!S%hO![+ZO!](^O!_%iO(T%gO!Y(vP~Os'[O!S+]O![+[O(VTO(YUO(e(|O~O!^(xP~P!9|O!]+^Oa)TX'z)TX~OP$[OR#zO[$cOj$ROr$aO!Q#yO!S#{O!l#xO!p$[O#R$RO#n$OO#o$PO#p$PO#q$PO#r$QO#s$RO#t$RO#u$bO#v$SO#x$UO#z$WO#{$XO(aVO(r$YO(y#|O(z#}O~Oa!ja!]!ja'z!ja'w!ja!Y!ja!k!jav!ja!_!ja%i!ja!g!ja~P!:tOR#zO!Q#yO!S#{O!l#xO(aVOP!ra[!raj!rar!ra!]!ra!p!ra#R!ra#n!ra#o!ra#p!ra#q!ra#r!ra#s!ra#t!ra#u!ra#v!ra#x!ra#z!ra#{!ra(r!ra(y!ra(z!ra~Oa!ra'z!ra'w!ra!Y!ra!k!rav!ra!_!ra%i!ra!g!ra~P!=[OR#zO!Q#yO!S#{O!l#xO(aVOP!ta[!taj!tar!ta!]!ta!p!ta#R!ta#n!ta#o!ta#p!ta#q!ta#r!ta#s!ta#t!ta#u!ta#v!ta#x!ta#z!ta#{!ta(r!ta(y!ta(z!ta~Oa!ta'z!ta'w!ta!Y!ta!k!tav!ta!_!ta%i!ta!g!ta~P!?rOh%VOn+gO!_'`O%i+fO~O!g+iOa(]X!_(]X'z(]X!](]X~Oa%nO!_XO'z%nO~Oh%VO!l%eO~Oh%VO!l%eO(T%gO~O!g#vO#k(xO~Ob+tO%j+uO(T+qO(VTO(YUO!^)XP~O!]+vO`)WX~O[+zO~O`+{O~O!_&PO(T%gO(U!lO`)WP~O%j,OO~P;SOh%VO#`,SO~Oh%VOn,VO!_$|O~O!_,XO~O!Q,ZO!_XO~O%n%vO~O!x,`O~Oe,eO~Ob,fO(T#nO(VTO(YUO!^)VP~Oe%}O~O%j!QO(T&ZO~P=gO[,kO`,jO~OPYOQYOSfOdzOeyOpkOrYOskOtkOzkO|YO!OYO!SWO!WkO!XkO!iuO!lZO!oYO!pYO!qYO!svO!xxO!|]O$niO%h}O(VTO(YUO(aVO(o[O~O!_!eO!u!gO$W!kO(T!dO~P!FyO`,jOa%nO'z%nO~OPYOQYOSfOd!jOe!iOpkOrYOskOtkOzkO|YO!OYO!SWO!WkO!XkO!_!eO!iuO!lZO!oYO!pYO!qYO!svO!x!hO$W!kO$niO(T!dO(VTO(YUO(aVO(o[O~Oa,pOl!OO!uwO%l!OO%m!OO%n!OO~P!IcO!l&oO~O&^,vO~O!_,xO~O&o,zO&q,{OP&laQ&laS&laY&laa&lad&lae&lal&lap&lar&las&lat&laz&la|&la!O&la!S&la!W&la!X&la!_&la!i&la!l&la!o&la!p&la!q&la!s&la!u&la!x&la!|&la$W&la$n&la%h&la%j&la%l&la%m&la%n&la%q&la%s&la%v&la%w&la%y&la&W&la&^&la&`&la&b&la&d&la&g&la&m&la&s&la&u&la&w&la&y&la&{&la'w&la(T&la(V&la(Y&la(a&la(o&la!^&la&e&lab&la&j&la~O(T-QO~Oh!eX!]!RX!^!RX!g!RX!g!eX!l!eX#`!RX~O!]!eX!^!eX~P#!iO!g-VO#`-UOh(jX!]#hX!^#hX!g(jX!l(jX~O!](jX!^(jX~P##[Oh%VO!g-XO!l%eO!]!aX!^!aX~Os!nO!S!oO(VTO(YUO(e!mO~OP<UOQ<UOSfOd>ROe!iOpkOr<UOskOtkOzkO|<UO!O<UO!SWO!WkO!XkO!_!eO!i<XO!lZO!o<UO!p<UO!q<UO!s<YO!u<]O!x!hO$W!kO$n>PO(VTO(YUO(aVO(o[O~O(T=QO~P#$qO!]-]O!^(iX~O!^-_O~O!g-VO#`-UO!]#hX!^#hX~O!]-`O!^(xX~O!^-bO~O!c-cO!d-cO(U!lO~P#$`O!^-fO~P'_On-iO!_'`O~O!Y-nO~Os!{a!b!{a!c!{a!d!{a#T!{a#U!{a#V!{a#W!{a#X!{a#[!{a#]!{a(U!{a(V!{a(Y!{a(e!{a(o!{a~P!#vO!p-sO#`-qO~PChO!c-uO!d-uO(U!lO~PDWOa%nO#`-qO'z%nO~Oa%nO!g#vO#`-qO'z%nO~Oa%nO!g#vO!p-sO#`-qO'z%nO(r'pO~O(P'xO(Q'xO(R-zO~Ov-{O~O!Y'Wa!]'Wa~P!:tO![.PO!Y'WX!]'WX~P%[O!](VO!Y(ha~O!Y(ha~PHRO!](^O!Y(va~O!S%hO![.TO!_%iO(T%gO!Y'^X!]'^X~O#`.VO!](ta!k(taa(ta'z(ta~O!g#vO~P#,wO!](jO!k(sa~O!S%hO!_%iO#j.ZO(T%gO~Op.`O!S%hO![.]O!_%iO!|]O#i._O#j.]O(T%gO!]'aX!k'aX~OR.dO!l#xO~Oh%VOn.gO!_'`O%i.fO~Oa#ci!]#ci'z#ci'w#ci!Y#ci!k#civ#ci!_#ci%i#ci!g#ci~P!:tOn>]O!Q*OO'y*PO(y$}O(z%PO~O#k#_aa#_a#`#_a'z#_a!]#_a!k#_a!_#_a!Y#_a~P#/sO#k(`XP(`XR(`X[(`Xa(`Xj(`Xr(`X!S(`X!l(`X!p(`X#R(`X#n(`X#o(`X#p(`X#q(`X#r(`X#s(`X#t(`X#u(`X#v(`X#x(`X#z(`X#{(`X'z(`X(a(`X(r(`X!k(`X!Y(`X'w(`Xv(`X!_(`X%i(`X!g(`X~P!6kO!].tO!k(kX~P!:tO!k.wO~O!Y.yO~OP$[OR#zO!Q#yO!S#{O!l#xO!p$[O(aVO[#mia#mij#mir#mi!]#mi#R#mi#o#mi#p#mi#q#mi#r#mi#s#mi#t#mi#u#mi#v#mi#x#mi#z#mi#{#mi'z#mi(r#mi(y#mi(z#mi'w#mi!Y#mi!k#miv#mi!_#mi%i#mi!g#mi~O#n#mi~P#3cO#n$OO~P#3cOP$[OR#zOr$aO!Q#yO!S#{O!l#xO!p$[O#n$OO#o$PO#p$PO#q$PO(aVO[#mia#mij#mi!]#mi#R#mi#s#mi#t#mi#u#mi#v#mi#x#mi#z#mi#{#mi'z#mi(r#mi(y#mi(z#mi'w#mi!Y#mi!k#miv#mi!_#mi%i#mi!g#mi~O#r#mi~P#6QO#r$QO~P#6QOP$[OR#zO[$cOj$ROr$aO!Q#yO!S#{O!l#xO!p$[O#R$RO#n$OO#o$PO#p$PO#q$PO#r$QO#s$RO#t$RO#u$bO(aVOa#mi!]#mi#x#mi#z#mi#{#mi'z#mi(r#mi(y#mi(z#mi'w#mi!Y#mi!k#miv#mi!_#mi%i#mi!g#mi~O#v#mi~P#8oOP$[OR#zO[$cOj$ROr$aO!Q#yO!S#{O!l#xO!p$[O#R$RO#n$OO#o$PO#p$PO#q$PO#r$QO#s$RO#t$RO#u$bO#v$SO(aVO(z#}Oa#mi!]#mi#z#mi#{#mi'z#mi(r#mi(y#mi'w#mi!Y#mi!k#miv#mi!_#mi%i#mi!g#mi~O#x$UO~P#;VO#x#mi~P#;VO#v$SO~P#8oOP$[OR#zO[$cOj$ROr$aO!Q#yO!S#{O!l#xO!p$[O#R$RO#n$OO#o$PO#p$PO#q$PO#r$QO#s$RO#t$RO#u$bO#v$SO#x$UO(aVO(y#|O(z#}Oa#mi!]#mi#{#mi'z#mi(r#mi'w#mi!Y#mi!k#miv#mi!_#mi%i#mi!g#mi~O#z#mi~P#={O#z$WO~P#={OP]XR]X[]Xj]Xr]X!Q]X!S]X!l]X!p]X#R]X#S]X#`]X#kfX#n]X#o]X#p]X#q]X#r]X#s]X#t]X#u]X#v]X#x]X#z]X#{]X$Q]X(a]X(r]X(y]X(z]X!]]X!^]X~O$O]X~P#@jOP$[OR#zO[<mOj<bOr<kO!Q#yO!S#{O!l#xO!p$[O#R<bO#n<_O#o<`O#p<`O#q<`O#r<aO#s<bO#t<bO#u<lO#v<cO#x<eO#z<gO#{<hO(aVO(r$YO(y#|O(z#}O~O$O.{O~P#BwO#S$dO#`<nO$Q<nO$O(gX!^(gX~P! uOa'da!]'da'z'da'w'da!k'da!Y'dav'da!_'da%i'da!g'da~P!:tO[#mia#mij#mir#mi!]#mi#R#mi#r#mi#s#mi#t#mi#u#mi#v#mi#x#mi#z#mi#{#mi'z#mi(r#mi'w#mi!Y#mi!k#miv#mi!_#mi%i#mi!g#mi~OP$[OR#zO!Q#yO!S#{O!l#xO!p$[O#n$OO#o$PO#p$PO#q$PO(aVO(y#mi(z#mi~P#EyOn>]O!Q*OO'y*PO(y$}O(z%POP#miR#mi!S#mi!l#mi!p#mi#n#mi#o#mi#p#mi#q#mi(a#mi~P#EyO!]/POg(pX~P!1WOg/RO~Oa$Pi!]$Pi'z$Pi'w$Pi!Y$Pi!k$Piv$Pi!_$Pi%i$Pi!g$Pi~P!:tO$]/SO$_/SO~O$]/TO$_/TO~O!g)hO#`/UO!_$cX$Z$cX$]$cX$_$cX$f$cX~O![/VO~O!_)kO$Z/XO$])jO$_)jO$f/YO~O!]<iO!^(fX~P#BwO!^/ZO~O!g)hO$f({X~O$f/]O~Ov/^O~P!&zOx)yO(b)zO(c/aO~O!S/dO~O(y$}On%aa!Q%aa'y%aa(z%aa!]%aa#`%aa~Og%aa$O%aa~P#L{O(z%POn%ca!Q%ca'y%ca(y%ca!]%ca#`%ca~Og%ca$O%ca~P#MnO!]fX!gfX!kfX!k$zX(rfX~P!0SOp%WO![/mO!](^O(T/lO!Y(vP!Y)PP~P!1uOr*sO!b*qO!c*kO!d*kO!l*bO#[*rO%`*mO(U!lO(VTO(YUO~Os<}O!S/nO![+[O!^*pO(e<|O!^(xP~P$ [O!k/oO~P#/sO!]/pO!g#vO(r'pO!k)OX~O!k/uO~OnoX!QoX'yoX(yoX(zoX~O!g#vO!koX~P$#OOp/wO!S%hO![*^O!_%iO(T%gO!k)OP~O#k/xO~O!Y$zX!]$zX!g%RX~P!0SO!]/yO!Y)PX~P#/sO!g/{O~O!Y/}O~OpkO(T0OO~P.iOh%VOr0TO!g#vO!l%eO(r'pO~O!g+iO~Oa%nO!]0XO'z%nO~O!^0ZO~P!5iO!c0[O!d0[O(U!lO~P#$`Os!nO!S0]O(VTO(YUO(e!mO~O#[0_O~Og%aa!]%aa#`%aa$O%aa~P!1WOg%ca!]%ca#`%ca$O%ca~P!1WOj%dOk%dOl%dO(T&ZOg'mX!]'mX~O!]*yOg(^a~Og0hO~On0jO#`0iOg(_a!](_a~OR0kO!Q0kO!S0lO#S$dOn}a'y}a(y}a(z}a!]}a#`}a~Og}a$O}a~P$(cO!Q*OO'y*POn$sa(y$sa(z$sa!]$sa#`$sa~Og$sa$O$sa~P$)_O!Q*OO'y*POn$ua(y$ua(z$ua!]$ua#`$ua~Og$ua$O$ua~P$*QO#k0oO~Og%Ta!]%Ta#`%Ta$O%Ta~P!1WO!g#vO~O#k0rO~O!]+^Oa)Ta'z)Ta~OR#zO!Q#yO!S#{O!l#xO(aVOP!ri[!rij!rir!ri!]!ri!p!ri#R!ri#n!ri#o!ri#p!ri#q!ri#r!ri#s!ri#t!ri#u!ri#v!ri#x!ri#z!ri#{!ri(r!ri(y!ri(z!ri~Oa!ri'z!ri'w!ri!Y!ri!k!riv!ri!_!ri%i!ri!g!ri~P$+oOh%VOr%XOs$tOt$tOz%YO|%ZO!O<sO!S${O!_$|O!i>VO!l$xO#j<yO$W%`O$t<uO$v<wO$y%aO(VTO(YUO(a$uO(y$}O(z%PO~Op0{O%]0|O(T0zO~P$.VO!g+iOa(]a!_(]a'z(]a!](]a~O#k1SO~O[]X!]fX!^fX~O!]1TO!^)XX~O!^1VO~O[1WO~Ob1YO(T+qO(VTO(YUO~O!_&PO(T%gO`'uX!]'uX~O!]+vO`)Wa~O!k1]O~P!:tO[1`O~O`1aO~O#`1fO~On1iO!_$|O~O(e(|O!^)UP~Oh%VOn1rO!_1oO%i1qO~O[1|O!]1zO!^)VX~O!^1}O~O`2POa%nO'z%nO~O(T#nO(VTO(YUO~O#S$dO#`$eO$Q$eOP(gXR(gX[(gXr(gX!Q(gX!S(gX!](gX!l(gX!p(gX#R(gX#n(gX#o(gX#p(gX#q(gX#r(gX#s(gX#t(gX#u(gX#v(gX#x(gX#z(gX#{(gX(a(gX(r(gX(y(gX(z(gX~Oj2SO&[2TOa(gX~P$3pOj2SO#`$eO&[2TO~Oa2VO~P%[Oa2XO~O&e2[OP&ciQ&ciS&ciY&cia&cid&cie&cil&cip&cir&cis&cit&ciz&ci|&ci!O&ci!S&ci!W&ci!X&ci!_&ci!i&ci!l&ci!o&ci!p&ci!q&ci!s&ci!u&ci!x&ci!|&ci$W&ci$n&ci%h&ci%j&ci%l&ci%m&ci%n&ci%q&ci%s&ci%v&ci%w&ci%y&ci&W&ci&^&ci&`&ci&b&ci&d&ci&g&ci&m&ci&s&ci&u&ci&w&ci&y&ci&{&ci'w&ci(T&ci(V&ci(Y&ci(a&ci(o&ci!^&cib&ci&j&ci~Ob2bO!^2`O&j2aO~P`O!_XO!l2dO~O&q,{OP&liQ&liS&liY&lia&lid&lie&lil&lip&lir&lis&lit&liz&li|&li!O&li!S&li!W&li!X&li!_&li!i&li!l&li!o&li!p&li!q&li!s&li!u&li!x&li!|&li$W&li$n&li%h&li%j&li%l&li%m&li%n&li%q&li%s&li%v&li%w&li%y&li&W&li&^&li&`&li&b&li&d&li&g&li&m&li&s&li&u&li&w&li&y&li&{&li'w&li(T&li(V&li(Y&li(a&li(o&li!^&li&e&lib&li&j&li~O!Y2jO~O!]!aa!^!aa~P#BwOs!nO!S!oO![2pO(e!mO!]'XX!^'XX~P@nO!]-]O!^(ia~O!]'_X!^'_X~P!9|O!]-`O!^(xa~O!^2wO~P'_Oa%nO#`3QO'z%nO~Oa%nO!g#vO#`3QO'z%nO~Oa%nO!g#vO!p3UO#`3QO'z%nO(r'pO~Oa%nO'z%nO~P!:tO!]$_Ov$qa~O!Y'Wi!]'Wi~P!:tO!](VO!Y(hi~O!](^O!Y(vi~O!Y(wi!](wi~P!:tO!](ti!k(tia(ti'z(ti~P!:tO#`3WO!](ti!k(tia(ti'z(ti~O!](jO!k(si~O!S%hO!_%iO!|]O#i3]O#j3[O(T%gO~O!S%hO!_%iO#j3[O(T%gO~On3dO!_'`O%i3cO~Oh%VOn3dO!_'`O%i3cO~O#k%aaP%aaR%aa[%aaa%aaj%aar%aa!S%aa!l%aa!p%aa#R%aa#n%aa#o%aa#p%aa#q%aa#r%aa#s%aa#t%aa#u%aa#v%aa#x%aa#z%aa#{%aa'z%aa(a%aa(r%aa!k%aa!Y%aa'w%aav%aa!_%aa%i%aa!g%aa~P#L{O#k%caP%caR%ca[%caa%caj%car%ca!S%ca!l%ca!p%ca#R%ca#n%ca#o%ca#p%ca#q%ca#r%ca#s%ca#t%ca#u%ca#v%ca#x%ca#z%ca#{%ca'z%ca(a%ca(r%ca!k%ca!Y%ca'w%cav%ca!_%ca%i%ca!g%ca~P#MnO#k%aaP%aaR%aa[%aaa%aaj%aar%aa!S%aa!]%aa!l%aa!p%aa#R%aa#n%aa#o%aa#p%aa#q%aa#r%aa#s%aa#t%aa#u%aa#v%aa#x%aa#z%aa#{%aa'z%aa(a%aa(r%aa!k%aa!Y%aa'w%aa#`%aav%aa!_%aa%i%aa!g%aa~P#/sO#k%caP%caR%ca[%caa%caj%car%ca!S%ca!]%ca!l%ca!p%ca#R%ca#n%ca#o%ca#p%ca#q%ca#r%ca#s%ca#t%ca#u%ca#v%ca#x%ca#z%ca#{%ca'z%ca(a%ca(r%ca!k%ca!Y%ca'w%ca#`%cav%ca!_%ca%i%ca!g%ca~P#/sO#k}aP}a[}aa}aj}ar}a!l}a!p}a#R}a#n}a#o}a#p}a#q}a#r}a#s}a#t}a#u}a#v}a#x}a#z}a#{}a'z}a(a}a(r}a!k}a!Y}a'w}av}a!_}a%i}a!g}a~P$(cO#k$saP$saR$sa[$saa$saj$sar$sa!S$sa!l$sa!p$sa#R$sa#n$sa#o$sa#p$sa#q$sa#r$sa#s$sa#t$sa#u$sa#v$sa#x$sa#z$sa#{$sa'z$sa(a$sa(r$sa!k$sa!Y$sa'w$sav$sa!_$sa%i$sa!g$sa~P$)_O#k$uaP$uaR$ua[$uaa$uaj$uar$ua!S$ua!l$ua!p$ua#R$ua#n$ua#o$ua#p$ua#q$ua#r$ua#s$ua#t$ua#u$ua#v$ua#x$ua#z$ua#{$ua'z$ua(a$ua(r$ua!k$ua!Y$ua'w$uav$ua!_$ua%i$ua!g$ua~P$*QO#k%TaP%TaR%Ta[%Taa%Taj%Tar%Ta!S%Ta!]%Ta!l%Ta!p%Ta#R%Ta#n%Ta#o%Ta#p%Ta#q%Ta#r%Ta#s%Ta#t%Ta#u%Ta#v%Ta#x%Ta#z%Ta#{%Ta'z%Ta(a%Ta(r%Ta!k%Ta!Y%Ta'w%Ta#`%Tav%Ta!_%Ta%i%Ta!g%Ta~P#/sOa#cq!]#cq'z#cq'w#cq!Y#cq!k#cqv#cq!_#cq%i#cq!g#cq~P!:tO![3lO!]'YX!k'YX~P%[O!].tO!k(ka~O!].tO!k(ka~P!:tO!Y3oO~O$O!na!^!na~PKlO$O!ja!]!ja!^!ja~P#BwO$O!ra!^!ra~P!=[O$O!ta!^!ta~P!?rOg']X!]']X~P!,TO!]/POg(pa~OSfO!_4TO$d4UO~O!^4YO~Ov4ZO~P#/sOa$mq!]$mq'z$mq'w$mq!Y$mq!k$mqv$mq!_$mq%i$mq!g$mq~P!:tO!Y4]O~P!&zO!S4^O~O!Q*OO'y*PO(z%POn'ia(y'ia!]'ia#`'ia~Og'ia$O'ia~P%-fO!Q*OO'y*POn'ka(y'ka(z'ka!]'ka#`'ka~Og'ka$O'ka~P%.XO(r$YO~P#/sO!YfX!Y$zX!]fX!]$zX!g%RX#`fX~P!0SOp%WO(T=WO~P!1uOp4bO!S%hO![4aO!_%iO(T%gO!]'eX!k'eX~O!]/pO!k)Oa~O!]/pO!g#vO!k)Oa~O!]/pO!g#vO(r'pO!k)Oa~Og$|i!]$|i#`$|i$O$|i~P!1WO![4jO!Y'gX!]'gX~P!3tO!]/yO!Y)Pa~O!]/yO!Y)Pa~P#/sOP]XR]X[]Xj]Xr]X!Q]X!S]X!Y]X!]]X!l]X!p]X#R]X#S]X#`]X#kfX#n]X#o]X#p]X#q]X#r]X#s]X#t]X#u]X#v]X#x]X#z]X#{]X$Q]X(a]X(r]X(y]X(z]X~Oj%YX!g%YX~P%2OOj4oO!g#vO~Oh%VO!g#vO!l%eO~Oh%VOr4tO!l%eO(r'pO~Or4yO!g#vO(r'pO~Os!nO!S4zO(VTO(YUO(e!mO~O(y$}On%ai!Q%ai'y%ai(z%ai!]%ai#`%ai~Og%ai$O%ai~P%5oO(z%POn%ci!Q%ci'y%ci(y%ci!]%ci#`%ci~Og%ci$O%ci~P%6bOg(_i!](_i~P!1WO#`5QOg(_i!](_i~P!1WO!k5VO~Oa$oq!]$oq'z$oq'w$oq!Y$oq!k$oqv$oq!_$oq%i$oq!g$oq~P!:tO!Y5ZO~O!]5[O!_)QX~P#/sOa$zX!_$zX%^]X'z$zX!]$zX~P!0SO%^5_OaoX!_oX'zoX!]oX~P$#OOp5`O(T#nO~O%^5_O~Ob5fO%j5gO(T+qO(VTO(YUO!]'tX!^'tX~O!]1TO!^)Xa~O[5kO~O`5lO~O[5pO~Oa%nO'z%nO~P#/sO!]5uO#`5wO!^)UX~O!^5xO~Or6OOs!nO!S*iO!b!yO!c!vO!d!vO!|<VO#T!pO#U!pO#V!pO#W!pO#X!pO#[5}O#]!zO(U!lO(VTO(YUO(e!mO(o!sO~O!^5|O~P%;eOn6TO!_1oO%i6SO~Oh%VOn6TO!_1oO%i6SO~Ob6[O(T#nO(VTO(YUO!]'sX!^'sX~O!]1zO!^)Va~O(VTO(YUO(e6^O~O`6bO~Oj6eO&[6fO~PNXO!k6gO~P%[Oa6iO~Oa6iO~P%[Ob2bO!^6nO&j2aO~P`O!g6pO~O!g6rOh(ji!](ji!^(ji!g(ji!l(jir(ji(r(ji~O!]#hi!^#hi~P#BwO#`6sO!]#hi!^#hi~O!]!ai!^!ai~P#BwOa%nO#`6|O'z%nO~Oa%nO!g#vO#`6|O'z%nO~O!](tq!k(tqa(tq'z(tq~P!:tO!](jO!k(sq~O!S%hO!_%iO#j7TO(T%gO~O!_'`O%i7WO~On7[O!_'`O%i7WO~O#k'iaP'iaR'ia['iaa'iaj'iar'ia!S'ia!l'ia!p'ia#R'ia#n'ia#o'ia#p'ia#q'ia#r'ia#s'ia#t'ia#u'ia#v'ia#x'ia#z'ia#{'ia'z'ia(a'ia(r'ia!k'ia!Y'ia'w'iav'ia!_'ia%i'ia!g'ia~P%-fO#k'kaP'kaR'ka['kaa'kaj'kar'ka!S'ka!l'ka!p'ka#R'ka#n'ka#o'ka#p'ka#q'ka#r'ka#s'ka#t'ka#u'ka#v'ka#x'ka#z'ka#{'ka'z'ka(a'ka(r'ka!k'ka!Y'ka'w'kav'ka!_'ka%i'ka!g'ka~P%.XO#k$|iP$|iR$|i[$|ia$|ij$|ir$|i!S$|i!]$|i!l$|i!p$|i#R$|i#n$|i#o$|i#p$|i#q$|i#r$|i#s$|i#t$|i#u$|i#v$|i#x$|i#z$|i#{$|i'z$|i(a$|i(r$|i!k$|i!Y$|i'w$|i#`$|iv$|i!_$|i%i$|i!g$|i~P#/sO#k%aiP%aiR%ai[%aia%aij%air%ai!S%ai!l%ai!p%ai#R%ai#n%ai#o%ai#p%ai#q%ai#r%ai#s%ai#t%ai#u%ai#v%ai#x%ai#z%ai#{%ai'z%ai(a%ai(r%ai!k%ai!Y%ai'w%aiv%ai!_%ai%i%ai!g%ai~P%5oO#k%ciP%ciR%ci[%cia%cij%cir%ci!S%ci!l%ci!p%ci#R%ci#n%ci#o%ci#p%ci#q%ci#r%ci#s%ci#t%ci#u%ci#v%ci#x%ci#z%ci#{%ci'z%ci(a%ci(r%ci!k%ci!Y%ci'w%civ%ci!_%ci%i%ci!g%ci~P%6bO!]'Ya!k'Ya~P!:tO!].tO!k(ki~O$O#ci!]#ci!^#ci~P#BwOP$[OR#zO!Q#yO!S#{O!l#xO!p$[O(aVO[#mij#mir#mi#R#mi#o#mi#p#mi#q#mi#r#mi#s#mi#t#mi#u#mi#v#mi#x#mi#z#mi#{#mi$O#mi(r#mi(y#mi(z#mi!]#mi!^#mi~O#n#mi~P%NdO#n<_O~P%NdOP$[OR#zOr<kO!Q#yO!S#{O!l#xO!p$[O#n<_O#o<`O#p<`O#q<`O(aVO[#mij#mi#R#mi#s#mi#t#mi#u#mi#v#mi#x#mi#z#mi#{#mi$O#mi(r#mi(y#mi(z#mi!]#mi!^#mi~O#r#mi~P&!lO#r<aO~P&!lOP$[OR#zO[<mOj<bOr<kO!Q#yO!S#{O!l#xO!p$[O#R<bO#n<_O#o<`O#p<`O#q<`O#r<aO#s<bO#t<bO#u<lO(aVO#x#mi#z#mi#{#mi$O#mi(r#mi(y#mi(z#mi!]#mi!^#mi~O#v#mi~P&$tOP$[OR#zO[<mOj<bOr<kO!Q#yO!S#{O!l#xO!p$[O#R<bO#n<_O#o<`O#p<`O#q<`O#r<aO#s<bO#t<bO#u<lO#v<cO(aVO(z#}O#z#mi#{#mi$O#mi(r#mi(y#mi!]#mi!^#mi~O#x<eO~P&&uO#x#mi~P&&uO#v<cO~P&$tOP$[OR#zO[<mOj<bOr<kO!Q#yO!S#{O!l#xO!p$[O#R<bO#n<_O#o<`O#p<`O#q<`O#r<aO#s<bO#t<bO#u<lO#v<cO#x<eO(aVO(y#|O(z#}O#{#mi$O#mi(r#mi!]#mi!^#mi~O#z#mi~P&)UO#z<gO~P&)UOa#|y!]#|y'z#|y'w#|y!Y#|y!k#|yv#|y!_#|y%i#|y!g#|y~P!:tO[#mij#mir#mi#R#mi#r#mi#s#mi#t#mi#u#mi#v#mi#x#mi#z#mi#{#mi$O#mi(r#mi!]#mi!^#mi~OP$[OR#zO!Q#yO!S#{O!l#xO!p$[O#n<_O#o<`O#p<`O#q<`O(aVO(y#mi(z#mi~P&,QOn>^O!Q*OO'y*PO(y$}O(z%POP#miR#mi!S#mi!l#mi!p#mi#n#mi#o#mi#p#mi#q#mi(a#mi~P&,QO#S$dOP(`XR(`X[(`Xj(`Xn(`Xr(`X!Q(`X!S(`X!l(`X!p(`X#R(`X#n(`X#o(`X#p(`X#q(`X#r(`X#s(`X#t(`X#u(`X#v(`X#x(`X#z(`X#{(`X$O(`X'y(`X(a(`X(r(`X(y(`X(z(`X!](`X!^(`X~O$O$Pi!]$Pi!^$Pi~P#BwO$O!ri!^!ri~P$+oOg']a!]']a~P!1WO!^7nO~O!]'da!^'da~P#BwO!Y7oO~P#/sO!g#vO(r'pO!]'ea!k'ea~O!]/pO!k)Oi~O!]/pO!g#vO!k)Oi~Og$|q!]$|q#`$|q$O$|q~P!1WO!Y'ga!]'ga~P#/sO!g7vO~O!]/yO!Y)Pi~P#/sO!]/yO!Y)Pi~O!Y7yO~Oh%VOr8OO!l%eO(r'pO~Oj8QO!g#vO~Or8TO!g#vO(r'pO~O!Q*OO'y*PO(z%POn'ja(y'ja!]'ja#`'ja~Og'ja$O'ja~P&5RO!Q*OO'y*POn'la(y'la(z'la!]'la#`'la~Og'la$O'la~P&5tOg(_q!](_q~P!1WO#`8VOg(_q!](_q~P!1WO!Y8WO~Og%Oq!]%Oq#`%Oq$O%Oq~P!1WOa$oy!]$oy'z$oy'w$oy!Y$oy!k$oyv$oy!_$oy%i$oy!g$oy~P!:tO!g6rO~O!]5[O!_)Qa~O!_'`OP$TaR$Ta[$Taj$Tar$Ta!Q$Ta!S$Ta!]$Ta!l$Ta!p$Ta#R$Ta#n$Ta#o$Ta#p$Ta#q$Ta#r$Ta#s$Ta#t$Ta#u$Ta#v$Ta#x$Ta#z$Ta#{$Ta(a$Ta(r$Ta(y$Ta(z$Ta~O%i7WO~P&8fO%^8[Oa%[i!_%[i'z%[i!]%[i~Oa#cy!]#cy'z#cy'w#cy!Y#cy!k#cyv#cy!_#cy%i#cy!g#cy~P!:tO[8^O~Ob8`O(T+qO(VTO(YUO~O!]1TO!^)Xi~O`8dO~O(e(|O!]'pX!^'pX~O!]5uO!^)Ua~O!^8nO~P%;eO(o!sO~P$&YO#[8oO~O!_1oO~O!_1oO%i8qO~On8tO!_1oO%i8qO~O[8yO!]'sa!^'sa~O!]1zO!^)Vi~O!k8}O~O!k9OO~O!k9RO~O!k9RO~P%[Oa9TO~O!g9UO~O!k9VO~O!](wi!^(wi~P#BwOa%nO#`9_O'z%nO~O!](ty!k(tya(ty'z(ty~P!:tO!](jO!k(sy~O%i9bO~P&8fO!_'`O%i9bO~O#k$|qP$|qR$|q[$|qa$|qj$|qr$|q!S$|q!]$|q!l$|q!p$|q#R$|q#n$|q#o$|q#p$|q#q$|q#r$|q#s$|q#t$|q#u$|q#v$|q#x$|q#z$|q#{$|q'z$|q(a$|q(r$|q!k$|q!Y$|q'w$|q#`$|qv$|q!_$|q%i$|q!g$|q~P#/sO#k'jaP'jaR'ja['jaa'jaj'jar'ja!S'ja!l'ja!p'ja#R'ja#n'ja#o'ja#p'ja#q'ja#r'ja#s'ja#t'ja#u'ja#v'ja#x'ja#z'ja#{'ja'z'ja(a'ja(r'ja!k'ja!Y'ja'w'jav'ja!_'ja%i'ja!g'ja~P&5RO#k'laP'laR'la['laa'laj'lar'la!S'la!l'la!p'la#R'la#n'la#o'la#p'la#q'la#r'la#s'la#t'la#u'la#v'la#x'la#z'la#{'la'z'la(a'la(r'la!k'la!Y'la'w'lav'la!_'la%i'la!g'la~P&5tO#k%OqP%OqR%Oq[%Oqa%Oqj%Oqr%Oq!S%Oq!]%Oq!l%Oq!p%Oq#R%Oq#n%Oq#o%Oq#p%Oq#q%Oq#r%Oq#s%Oq#t%Oq#u%Oq#v%Oq#x%Oq#z%Oq#{%Oq'z%Oq(a%Oq(r%Oq!k%Oq!Y%Oq'w%Oq#`%Oqv%Oq!_%Oq%i%Oq!g%Oq~P#/sO!]'Yi!k'Yi~P!:tO$O#cq!]#cq!^#cq~P#BwO(y$}OP%aaR%aa[%aaj%aar%aa!S%aa!l%aa!p%aa#R%aa#n%aa#o%aa#p%aa#q%aa#r%aa#s%aa#t%aa#u%aa#v%aa#x%aa#z%aa#{%aa$O%aa(a%aa(r%aa!]%aa!^%aa~On%aa!Q%aa'y%aa(z%aa~P&IyO(z%POP%caR%ca[%caj%car%ca!S%ca!l%ca!p%ca#R%ca#n%ca#o%ca#p%ca#q%ca#r%ca#s%ca#t%ca#u%ca#v%ca#x%ca#z%ca#{%ca$O%ca(a%ca(r%ca!]%ca!^%ca~On%ca!Q%ca'y%ca(y%ca~P&LQOn>^O!Q*OO'y*PO(z%PO~P&IyOn>^O!Q*OO'y*PO(y$}O~P&LQOR0kO!Q0kO!S0lO#S$dOP}a[}aj}an}ar}a!l}a!p}a#R}a#n}a#o}a#p}a#q}a#r}a#s}a#t}a#u}a#v}a#x}a#z}a#{}a$O}a'y}a(a}a(r}a(y}a(z}a!]}a!^}a~O!Q*OO'y*POP$saR$sa[$saj$san$sar$sa!S$sa!l$sa!p$sa#R$sa#n$sa#o$sa#p$sa#q$sa#r$sa#s$sa#t$sa#u$sa#v$sa#x$sa#z$sa#{$sa$O$sa(a$sa(r$sa(y$sa(z$sa!]$sa!^$sa~O!Q*OO'y*POP$uaR$ua[$uaj$uan$uar$ua!S$ua!l$ua!p$ua#R$ua#n$ua#o$ua#p$ua#q$ua#r$ua#s$ua#t$ua#u$ua#v$ua#x$ua#z$ua#{$ua$O$ua(a$ua(r$ua(y$ua(z$ua!]$ua!^$ua~On>^O!Q*OO'y*PO(y$}O(z%PO~OP%TaR%Ta[%Taj%Tar%Ta!S%Ta!l%Ta!p%Ta#R%Ta#n%Ta#o%Ta#p%Ta#q%Ta#r%Ta#s%Ta#t%Ta#u%Ta#v%Ta#x%Ta#z%Ta#{%Ta$O%Ta(a%Ta(r%Ta!]%Ta!^%Ta~P''VO$O$mq!]$mq!^$mq~P#BwO$O$oq!]$oq!^$oq~P#BwO!^9oO~O$O9pO~P!1WO!g#vO!]'ei!k'ei~O!g#vO(r'pO!]'ei!k'ei~O!]/pO!k)Oq~O!Y'gi!]'gi~P#/sO!]/yO!Y)Pq~Or9wO!g#vO(r'pO~O[9yO!Y9xO~P#/sO!Y9xO~Oj:PO!g#vO~Og(_y!](_y~P!1WO!]'na!_'na~P#/sOa%[q!_%[q'z%[q!]%[q~P#/sO[:UO~O!]1TO!^)Xq~O`:YO~O#`:ZO!]'pa!^'pa~O!]5uO!^)Ui~P#BwO!S:]O~O!_1oO%i:`O~O(VTO(YUO(e:eO~O!]1zO!^)Vq~O!k:hO~O!k:iO~O!k:jO~O!k:jO~P%[O#`:mO!]#hy!^#hy~O!]#hy!^#hy~P#BwO%i:rO~P&8fO!_'`O%i:rO~O$O#|y!]#|y!^#|y~P#BwOP$|iR$|i[$|ij$|ir$|i!S$|i!l$|i!p$|i#R$|i#n$|i#o$|i#p$|i#q$|i#r$|i#s$|i#t$|i#u$|i#v$|i#x$|i#z$|i#{$|i$O$|i(a$|i(r$|i!]$|i!^$|i~P''VO!Q*OO'y*PO(z%POP'iaR'ia['iaj'ian'iar'ia!S'ia!l'ia!p'ia#R'ia#n'ia#o'ia#p'ia#q'ia#r'ia#s'ia#t'ia#u'ia#v'ia#x'ia#z'ia#{'ia$O'ia(a'ia(r'ia(y'ia!]'ia!^'ia~O!Q*OO'y*POP'kaR'ka['kaj'kan'kar'ka!S'ka!l'ka!p'ka#R'ka#n'ka#o'ka#p'ka#q'ka#r'ka#s'ka#t'ka#u'ka#v'ka#x'ka#z'ka#{'ka$O'ka(a'ka(r'ka(y'ka(z'ka!]'ka!^'ka~O(y$}OP%aiR%ai[%aij%ain%air%ai!Q%ai!S%ai!l%ai!p%ai#R%ai#n%ai#o%ai#p%ai#q%ai#r%ai#s%ai#t%ai#u%ai#v%ai#x%ai#z%ai#{%ai$O%ai'y%ai(a%ai(r%ai(z%ai!]%ai!^%ai~O(z%POP%ciR%ci[%cij%cin%cir%ci!Q%ci!S%ci!l%ci!p%ci#R%ci#n%ci#o%ci#p%ci#q%ci#r%ci#s%ci#t%ci#u%ci#v%ci#x%ci#z%ci#{%ci$O%ci'y%ci(a%ci(r%ci(y%ci!]%ci!^%ci~O$O$oy!]$oy!^$oy~P#BwO$O#cy!]#cy!^#cy~P#BwO!g#vO!]'eq!k'eq~O!]/pO!k)Oy~O!Y'gq!]'gq~P#/sOr:|O!g#vO(r'pO~O[;QO!Y;PO~P#/sO!Y;PO~Og(_!R!](_!R~P!1WOa%[y!_%[y'z%[y!]%[y~P#/sO!]1TO!^)Xy~O!]5uO!^)Uq~O(T;XO~O!_1oO%i;[O~O!k;_O~O%i;dO~P&8fOP$|qR$|q[$|qj$|qr$|q!S$|q!l$|q!p$|q#R$|q#n$|q#o$|q#p$|q#q$|q#r$|q#s$|q#t$|q#u$|q#v$|q#x$|q#z$|q#{$|q$O$|q(a$|q(r$|q!]$|q!^$|q~P''VO!Q*OO'y*PO(z%POP'jaR'ja['jaj'jan'jar'ja!S'ja!l'ja!p'ja#R'ja#n'ja#o'ja#p'ja#q'ja#r'ja#s'ja#t'ja#u'ja#v'ja#x'ja#z'ja#{'ja$O'ja(a'ja(r'ja(y'ja!]'ja!^'ja~O!Q*OO'y*POP'laR'la['laj'lan'lar'la!S'la!l'la!p'la#R'la#n'la#o'la#p'la#q'la#r'la#s'la#t'la#u'la#v'la#x'la#z'la#{'la$O'la(a'la(r'la(y'la(z'la!]'la!^'la~OP%OqR%Oq[%Oqj%Oqr%Oq!S%Oq!l%Oq!p%Oq#R%Oq#n%Oq#o%Oq#p%Oq#q%Oq#r%Oq#s%Oq#t%Oq#u%Oq#v%Oq#x%Oq#z%Oq#{%Oq$O%Oq(a%Oq(r%Oq!]%Oq!^%Oq~P''VOg%e!Z!]%e!Z#`%e!Z$O%e!Z~P!1WO!Y;hO~P#/sOr;iO!g#vO(r'pO~O[;kO!Y;hO~P#/sO!]'pq!^'pq~P#BwO!]#h!Z!^#h!Z~P#BwO#k%e!ZP%e!ZR%e!Z[%e!Za%e!Zj%e!Zr%e!Z!S%e!Z!]%e!Z!l%e!Z!p%e!Z#R%e!Z#n%e!Z#o%e!Z#p%e!Z#q%e!Z#r%e!Z#s%e!Z#t%e!Z#u%e!Z#v%e!Z#x%e!Z#z%e!Z#{%e!Z'z%e!Z(a%e!Z(r%e!Z!k%e!Z!Y%e!Z'w%e!Z#`%e!Zv%e!Z!_%e!Z%i%e!Z!g%e!Z~P#/sOr;tO!g#vO(r'pO~O!Y;uO~P#/sOr;|O!g#vO(r'pO~O!Y;}O~P#/sOP%e!ZR%e!Z[%e!Zj%e!Zr%e!Z!S%e!Z!l%e!Z!p%e!Z#R%e!Z#n%e!Z#o%e!Z#p%e!Z#q%e!Z#r%e!Z#s%e!Z#t%e!Z#u%e!Z#v%e!Z#x%e!Z#z%e!Z#{%e!Z$O%e!Z(a%e!Z(r%e!Z!]%e!Z!^%e!Z~P''VOr<QO!g#vO(r'pO~Ov(fX~P1qO!Q%rO~P!)[O(U!lO~P!)[O!YfX!]fX#`fX~P%2OOP]XR]X[]Xj]Xr]X!Q]X!S]X!]]X!]fX!l]X!p]X#R]X#S]X#`]X#`fX#kfX#n]X#o]X#p]X#q]X#r]X#s]X#t]X#u]X#v]X#x]X#z]X#{]X$Q]X(a]X(r]X(y]X(z]X~O!gfX!k]X!kfX(rfX~P'LTOP<UOQ<UOSfOd>ROe!iOpkOr<UOskOtkOzkO|<UO!O<UO!SWO!WkO!XkO!_XO!i<XO!lZO!o<UO!p<UO!q<UO!s<YO!u<]O!x!hO$W!kO$n>PO(T)]O(VTO(YUO(aVO(o[O~O!]<iO!^$qa~Oh%VOp%WOr%XOs$tOt$tOz%YO|%ZO!O<tO!S${O!_$|O!i>WO!l$xO#j<zO$W%`O$t<vO$v<xO$y%aO(T(vO(VTO(YUO(a$uO(y$}O(z%PO~Ol)dO~P(!yOr!eX(r!eX~P#!iOr(jX(r(jX~P##[O!^]X!^fX~P'LTO!YfX!Y$zX!]fX!]$zX#`fX~P!0SO#k<^O~O!g#vO#k<^O~O#`<nO~Oj<bO~O#`=OO!](wX!^(wX~O#`<nO!](uX!^(uX~O#k=PO~Og=RO~P!1WO#k=XO~O#k=YO~Og=RO(T&ZO~O!g#vO#k=ZO~O!g#vO#k=PO~O$O=[O~P#BwO#k=]O~O#k=^O~O#k=cO~O#k=dO~O#k=eO~O#k=fO~O$O=gO~P!1WO$O=hO~P!1WOl=sO~P7eOk#S#T#U#W#X#[#i#j#u$n$t$v$y%]%^%h%i%j%q%s%v%w%y%{~(OT#o!X'|(U#ps#n#qr!Q'}$]'}(T$_(e~",
    goto: "$9Y)]PPPPPP)^PP)aP)rP+W/]PPPP6mPP7TPP=QPPP@tPA^PA^PPPA^PCfPA^PA^PA^PCjPCoPD^PIWPPPI[PPPPI[L_PPPLeMVPI[PI[PP! eI[PPPI[PI[P!#lI[P!'S!(X!(bP!)U!)Y!)U!,gPPPPPPP!-W!(XPP!-h!/YP!2iI[I[!2n!5z!:h!:h!>gPPP!>oI[PPPPPPPPP!BOP!C]PPI[!DnPI[PI[I[I[I[I[PI[!FQP!I[P!LbP!Lf!Lp!Lt!LtP!IXP!Lx!LxP#!OP#!SI[PI[#!Y#%_CjA^PA^PA^A^P#&lA^A^#)OA^#+vA^#.SA^A^#.r#1W#1W#1]#1f#1W#1qPP#1WPA^#2ZA^#6YA^A^6mPPP#:_PPP#:x#:xP#:xP#;`#:xPP#;fP#;]P#;]#;y#;]#<e#<k#<n)aP#<q)aP#<z#<z#<zP)aP)aP)aP)aPP)aP#=Q#=TP#=T)aP#=XP#=[P)aP)aP)aP)aP)aP)a)aPP#=b#=h#=s#=y#>P#>V#>]#>k#>q#>{#?R#?]#?c#?s#?y#@k#@}#AT#AZ#Ai#BO#Cs#DR#DY#Et#FS#Gt#HS#HY#H`#Hf#Hp#Hv#H|#IW#Ij#IpPPPPPPPPPPP#IvPPPPPPP#Jk#Mx$ b$ i$ qPPP$']P$'f$*_$0x$0{$1O$1}$2Q$2X$2aP$2g$2jP$3W$3[$4S$5b$5g$5}PP$6S$6Y$6^$6a$6e$6i$7e$7|$8e$8i$8l$8o$8y$8|$9Q$9UR!|RoqOXst!Z#d%m&r&t&u&w,s,x2[2_Y!vQ'`-e1o5{Q%tvQ%|yQ&T|Q&j!VS'W!e-]Q'f!iS'l!r!yU*k$|*Z*oQ+o%}S+|&V&WQ,d&dQ-c'_Q-m'gQ-u'mQ0[*qQ1b,OQ1y,eR<{<Y%SdOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%m%t&R&k&n&r&t&u&w&{'T'b'r(T(V(](d(x(z)O)}*i+X+],p,s,x-i-q.P.V.t.{/n0]0l0r1S1r2S2T2V2X2[2_2a3Q3W3l4z6T6e6f6i6|8t9T9_S#q]<V!r)_$Z$n'X)s-U-X/V2p4T5w6s:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>SU+P%]<s<tQ+t&PQ,f&gQ,m&oQ0x+gQ0}+iQ1Y+uQ2R,kQ3`.gQ5`0|Q5f1TQ6[1zQ7Y3dQ8`5gR9e7['QkOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n%m%t&R&k&n&o&r&t&u&w&{'T'X'b'r(T(V(](d(x(z)O)s)}*i+X+]+g,p,s,x-U-X-i-q.P.V.g.t.{/V/n0]0l0r1S1r2S2T2V2X2[2_2a2p3Q3W3d3l4T4z5w6T6e6f6i6s6|7[8t9T9_:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>S!S!nQ!r!v!y!z$|'W'_'`'l'm'n*k*o*q*r-]-c-e-u0[0_1o5{5}%[$ti#v$b$c$d$x${%O%Q%^%_%c)y*R*T*V*Y*a*g*w*x+f+i,S,V.f/P/d/m/x/y/{0`0b0i0j0o1f1i1q3c4^4_4j4o5Q5[5_6S7W7v8Q8V8[8q9b9p9y:P:`:r;Q;[;d;k<l<m<o<p<q<r<u<v<w<x<y<z=S=T=U=V=X=Y=]=^=_=`=a=b=c=d=g=h>P>X>Y>]>^Q&X|Q'U!eS'[%i-`Q+t&PQ,P&WQ,f&gQ0n+SQ1Y+uQ1_+{Q2Q,jQ2R,kQ5f1TQ5o1aQ6[1zQ6_1|Q6`2PQ8`5gQ8c5lQ8|6bQ:X8dQ:f8yQ;V:YR<}*ZrnOXst!V!Z#d%m&i&r&t&u&w,s,x2[2_R,h&k&z^OPXYstuvwz!Z!`!g!j!o#S#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n%m%t&R&k&n&o&r&t&u&w&{'T'b'r(V(](d(x(z)O)s)}*i+X+]+g,p,s,x-U-X-i-q.P.V.g.t.{/V/n0]0l0r1S1r2S2T2V2X2[2_2a2p3Q3W3d3l4T4z5w6T6e6f6i6s6|7[8t9T9_:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>R>S[#]WZ#W#Z'X(T!b%jm#h#i#l$x%e%h(^(h(i(j*Y*^*b+Z+[+^,o-V.T.Z.[.]._/m/p2d3[3]4a6r7TQ%wxQ%{yW&Q|&V&W,OQ&_!TQ'c!hQ'e!iQ(q#sS+n%|%}Q+r&PQ,_&bQ,c&dS-l'f'gQ.i(rQ1R+oQ1X+uQ1Z+vQ1^+zQ1t,`S1x,d,eQ2|-mQ5e1TQ5i1WQ5n1`Q6Z1yQ8_5gQ8b5kQ8f5pQ:T8^R;T:U!U$zi$d%O%Q%^%_%c*R*T*a*w*x/P/x0`0b0i0j0o4_5Q8V9p>P>X>Y!^%yy!i!u%{%|%}'V'e'f'g'k'u*j+n+o-Y-l-m-t0R0U1R2u2|3T4r4s4v7}9{Q+h%wQ,T&[Q,W&]Q,b&dQ.h(qQ1s,_U1w,c,d,eQ3e.iQ6U1tS6Y1x1yQ8x6Z#f>T#v$b$c$x${)y*V*Y*g+f+i,S,V.f/d/m/y/{1f1i1q3c4^4j4o5[5_6S7W7v8Q8[8q9b9y:P:`:r;Q;[;d;k<o<q<u<w<y=S=U=X=]=_=a=c=g>]>^o>U<l<m<p<r<v<x<z=T=V=Y=^=`=b=d=hW%Ti%V*y>PS&[!Q&iQ&]!RQ&^!SU*}%[%d=sR,R&Y%]%Si#v$b$c$d$x${%O%Q%^%_%c)y*R*T*V*Y*a*g*w*x+f+i,S,V.f/P/d/m/x/y/{0`0b0i0j0o1f1i1q3c4^4_4j4o5Q5[5_6S7W7v8Q8V8[8q9b9p9y:P:`:r;Q;[;d;k<l<m<o<p<q<r<u<v<w<x<y<z=S=T=U=V=X=Y=]=^=_=`=a=b=c=d=g=h>P>X>Y>]>^T)z$u){V+P%]<s<tW'[!e%i*Z-`S(}#y#zQ+c%rQ+y&SS.b(m(nQ1j,XQ5T0kR8i5u'QkOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n%m%t&R&k&n&o&r&t&u&w&{'T'X'b'r(T(V(](d(x(z)O)s)}*i+X+]+g,p,s,x-U-X-i-q.P.V.g.t.{/V/n0]0l0r1S1r2S2T2V2X2[2_2a2p3Q3W3d3l4T4z5w6T6e6f6i6s6|7[8t9T9_:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>S$i$^c#Y#e%q%s%u(S(Y(t(y)R)S)T)U)V)W)X)Y)Z)[)^)`)b)g)q+d+x-Z-x-}.S.U.s.v.z.|.}/O/b0p2k2n3O3V3k3p3q3r3s3t3u3v3w3x3y3z3{3|4P4Q4X5X5c6u6{7Q7a7b7k7l8k9X9]9g9m9n:o;W;`<W=vT#TV#U'RkOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n%m%t&R&k&n&o&r&t&u&w&{'T'X'b'r(T(V(](d(x(z)O)s)}*i+X+]+g,p,s,x-U-X-i-q.P.V.g.t.{/V/n0]0l0r1S1r2S2T2V2X2[2_2a2p3Q3W3d3l4T4z5w6T6e6f6i6s6|7[8t9T9_:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>SQ'Y!eR2q-]!W!nQ!e!r!v!y!z$|'W'_'`'l'm'n*Z*k*o*q*r-]-c-e-u0[0_1o5{5}R1l,ZnqOXst!Z#d%m&r&t&u&w,s,x2[2_Q&y!^Q'v!xS(s#u<^Q+l%zQ,]&_Q,^&aQ-j'dQ-w'oS.r(x=PS0q+X=ZQ1P+mQ1n,[Q2c,zQ2e,{Q2m-WQ2z-kQ2}-oS5Y0r=eQ5a1QS5d1S=fQ6t2oQ6x2{Q6}3SQ8]5bQ9Y6vQ9Z6yQ9^7OR:l9V$d$]c#Y#e%s%u(S(Y(t(y)R)S)T)U)V)W)X)Y)Z)[)^)`)b)g)q+d+x-Z-x-}.S.U.s.v.z.}/O/b0p2k2n3O3V3k3p3q3r3s3t3u3v3w3x3y3z3{3|4P4Q4X5X5c6u6{7Q7a7b7k7l8k9X9]9g9m9n:o;W;`<W=vS(o#p'iQ)P#zS+b%q.|S.c(n(pR3^.d'QkOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n%m%t&R&k&n&o&r&t&u&w&{'T'X'b'r(T(V(](d(x(z)O)s)}*i+X+]+g,p,s,x-U-X-i-q.P.V.g.t.{/V/n0]0l0r1S1r2S2T2V2X2[2_2a2p3Q3W3d3l4T4z5w6T6e6f6i6s6|7[8t9T9_:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>SS#q]<VQ&t!XQ&u!YQ&w![Q&x!]R2Z,vQ'a!hQ+e%wQ-h'cS.e(q+hQ2x-gW3b.h.i0w0yQ6w2yW7U3_3a3e5^U9a7V7X7ZU:q9c9d9fS;b:p:sQ;p;cR;x;qU!wQ'`-eT5y1o5{!Q_OXZ`st!V!Z#d#h%e%m&i&k&r&t&u&w(j,s,x.[2[2_]!pQ!r'`-e1o5{T#q]<V%^{OPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%m%t&R&k&n&o&r&t&u&w&{'T'b'r(T(V(](d(x(z)O)}*i+X+]+g,p,s,x-i-q.P.V.g.t.{/n0]0l0r1S1r2S2T2V2X2[2_2a3Q3W3d3l4z6T6e6f6i6|7[8t9T9_S(}#y#zS.b(m(n!s=l$Z$n'X)s-U-X/V2p4T5w6s:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>SU$fd)_,mS(p#p'iU*v%R(w4OU0m+O.n7gQ5^0xQ7V3`Q9d7YR:s9em!tQ!r!v!y!z'`'l'm'n-e-u1o5{5}Q't!uS(f#g2US-s'k'wQ/s*]Q0R*jQ3U-vQ4f/tQ4r0TQ4s0UQ4x0^Q7r4`S7}4t4vS8R4y4{Q9r7sQ9v7yQ9{8OQ:Q8TS:{9w9xS;g:|;PS;s;h;iS;{;t;uS<P;|;}R<S<QQ#wbQ's!uS(e#g2US(g#m+WQ+Y%fQ+j%xQ+p&OU-r'k't'wQ.W(fU/r*]*`/wQ0S*jQ0V*lQ1O+kQ1u,aS3R-s-vQ3Z.`S4e/s/tQ4n0PS4q0R0^Q4u0WQ6W1vQ7P3US7q4`4bQ7u4fU7|4r4x4{Q8P4wQ8v6XS9q7r7sQ9u7yQ9}8RQ:O8SQ:c8wQ:y9rS:z9v9xQ;S:QQ;^:dS;f:{;PS;r;g;hS;z;s;uS<O;{;}Q<R<PQ<T<SQ=o=jQ={=tR=|=uV!wQ'`-e%^aOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%m%t&R&k&n&o&r&t&u&w&{'T'b'r(T(V(](d(x(z)O)}*i+X+]+g,p,s,x-i-q.P.V.g.t.{/n0]0l0r1S1r2S2T2V2X2[2_2a3Q3W3d3l4z6T6e6f6i6|7[8t9T9_S#wz!j!r=i$Z$n'X)s-U-X/V2p4T5w6s:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>SR=o>R%^bOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%m%t&R&k&n&o&r&t&u&w&{'T'b'r(T(V(](d(x(z)O)}*i+X+]+g,p,s,x-i-q.P.V.g.t.{/n0]0l0r1S1r2S2T2V2X2[2_2a3Q3W3d3l4z6T6e6f6i6|7[8t9T9_Q%fj!^%xy!i!u%{%|%}'V'e'f'g'k'u*j+n+o-Y-l-m-t0R0U1R2u2|3T4r4s4v7}9{S&Oz!jQ+k%yQ,a&dW1v,b,c,d,eU6X1w1x1yS8w6Y6ZQ:d8x!r=j$Z$n'X)s-U-X/V2p4T5w6s:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>SQ=t>QR=u>R%QeOPXYstuvw!Z!`!g!o#S#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%m%t&R&k&n&r&t&u&w&{'T'b'r(V(](d(x(z)O)}*i+X+]+g,p,s,x-i-q.P.V.g.t.{/n0]0l0r1S1r2S2T2V2X2[2_2a3Q3W3d3l4z6T6e6f6i6|7[8t9T9_Y#bWZ#W#Z(T!b%jm#h#i#l$x%e%h(^(h(i(j*Y*^*b+Z+[+^,o-V.T.Z.[.]._/m/p2d3[3]4a6r7TQ,n&o!p=k$Z$n)s-U-X/V2p4T5w6s:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>SR=n'XU']!e%i*ZR2s-`%SdOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%m%t&R&k&n&r&t&u&w&{'T'b'r(T(V(](d(x(z)O)}*i+X+],p,s,x-i-q.P.V.t.{/n0]0l0r1S1r2S2T2V2X2[2_2a3Q3W3l4z6T6e6f6i6|8t9T9_!r)_$Z$n'X)s-U-X/V2p4T5w6s:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>SQ,m&oQ0x+gQ3`.gQ7Y3dR9e7[!b$Tc#Y%q(S(Y(t(y)Z)[)`)g+x-x-}.S.U.s.v/b0p3O3V3k3{5X5c6{7Q7a9]:o<W!P<d)^)q-Z.|2k2n3p3y3z4P4X6u7b7k7l8k9X9g9m9n;W;`=v!f$Vc#Y%q(S(Y(t(y)W)X)Z)[)`)g+x-x-}.S.U.s.v/b0p3O3V3k3{5X5c6{7Q7a9]:o<W!T<f)^)q-Z.|2k2n3p3v3w3y3z4P4X6u7b7k7l8k9X9g9m9n;W;`=v!^$Zc#Y%q(S(Y(t(y)`)g+x-x-}.S.U.s.v/b0p3O3V3k3{5X5c6{7Q7a9]:o<WQ4_/kz>S)^)q-Z.|2k2n3p4P4X6u7b7k7l8k9X9g9m9n;W;`=vQ>X>ZR>Y>['QkOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n%m%t&R&k&n&o&r&t&u&w&{'T'X'b'r(T(V(](d(x(z)O)s)}*i+X+]+g,p,s,x-U-X-i-q.P.V.g.t.{/V/n0]0l0r1S1r2S2T2V2X2[2_2a2p3Q3W3d3l4T4z5w6T6e6f6i6s6|7[8t9T9_:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>SS$oh$pR4U/U'XgOPWXYZhstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n$p%m%t&R&k&n&o&r&t&u&w&{'T'X'b'r(T(V(](d(x(z)O)s)}*i+X+]+g,p,s,x-U-X-i-q.P.V.g.t.{/U/V/n0]0l0r1S1r2S2T2V2X2[2_2a2p3Q3W3d3l4T4z5w6T6e6f6i6s6|7[8t9T9_:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>ST$kf$qQ$ifS)j$l)nR)v$qT$jf$qT)l$l)n'XhOPWXYZhstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$Z$_$a$e$n$p%m%t&R&k&n&o&r&t&u&w&{'T'X'b'r(T(V(](d(x(z)O)s)}*i+X+]+g,p,s,x-U-X-i-q.P.V.g.t.{/U/V/n0]0l0r1S1r2S2T2V2X2[2_2a2p3Q3W3d3l4T4z5w6T6e6f6i6s6|7[8t9T9_:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>ST$oh$pQ$rhR)u$p%^jOPWXYZstuvw!Z!`!g!o#S#W#Z#d#o#u#x#{$O$P$Q$R$S$T$U$V$W$X$_$a$e%m%t&R&k&n&o&r&t&u&w&{'T'b'r(T(V(](d(x(z)O)}*i+X+]+g,p,s,x-i-q.P.V.g.t.{/n0]0l0r1S1r2S2T2V2X2[2_2a3Q3W3d3l4z6T6e6f6i6|7[8t9T9_!s>Q$Z$n'X)s-U-X/V2p4T5w6s:Z:m<U<X<Y<]<^<_<`<a<b<c<d<e<f<g<h<i<k<n<{=O=P=R=Z=[=e=f>S#glOPXZst!Z!`!o#S#d#o#{$n%m&k&n&o&r&t&u&w&{'T'b)O)s*i+]+g,p,s,x-i.g/V/n0]0l1r2S2T2V2X2[2_2a3d4T4z6T6e6f6i7[8t9T!U%Ri$d%O%Q%^%_%c*R*T*a*w*x/P/x0`0b0i0j0o4_5Q8V9p>P>X>Y#f(w#v$b$c$x${)y*V*Y*g+f+i,S,V.f/d/m/y/{1f1i1q3c4^4j4o5[5_6S7W7v8Q8[8q9b9y:P:`:r;Q;[;d;k<o<q<u<w<y=S=U=X=]=_=a=c=g>]>^Q+T%aQ/c*Oo4O<l<m<p<r<v<x<z=T=V=Y=^=`=b=d=h!U$yi$d%O%Q%^%_%c*R*T*a*w*x/P/x0`0b0i0j0o4_5Q8V9p>P>X>YQ*c$zU*l$|*Z*oQ+U%bQ0W*m#f=q#v$b$c$x${)y*V*Y*g+f+i,S,V.f/d/m/y/{1f1i1q3c4^4j4o5[5_6S7W7v8Q8[8q9b9y:P:`:r;Q;[;d;k<o<q<u<w<y=S=U=X=]=_=a=c=g>]>^n=r<l<m<p<r<v<x<z=T=V=Y=^=`=b=d=hQ=w>TQ=x>UQ=y>VR=z>W!U%Ri$d%O%Q%^%_%c*R*T*a*w*x/P/x0`0b0i0j0o4_5Q8V9p>P>X>Y#f(w#v$b$c$x${)y*V*Y*g+f+i,S,V.f/d/m/y/{1f1i1q3c4^4j4o5[5_6S7W7v8Q8[8q9b9y:P:`:r;Q;[;d;k<o<q<u<w<y=S=U=X=]=_=a=c=g>]>^o4O<l<m<p<r<v<x<z=T=V=Y=^=`=b=d=hnoOXst!Z#d%m&r&t&u&w,s,x2[2_S*f${*YQ-R'OQ-S'QR4i/y%[%Si#v$b$c$d$x${%O%Q%^%_%c)y*R*T*V*Y*a*g*w*x+f+i,S,V.f/P/d/m/x/y/{0`0b0i0j0o1f1i1q3c4^4_4j4o5Q5[5_6S7W7v8Q8V8[8q9b9p9y:P:`:r;Q;[;d;k<l<m<o<p<q<r<u<v<w<x<y<z=S=T=U=V=X=Y=]=^=_=`=a=b=c=d=g=h>P>X>Y>]>^Q,U&]Q1h,WQ5s1gR8h5tV*n$|*Z*oU*n$|*Z*oT5z1o5{S0P*i/nQ4w0]T8S4z:]Q+j%xQ0V*lQ1O+kQ1u,aQ6W1vQ8v6XQ:c8wR;^:d!U%Oi$d%O%Q%^%_%c*R*T*a*w*x/P/x0`0b0i0j0o4_5Q8V9p>P>X>Yx*R$v)e*S*u+V/v0d0e4R4g5R5S5W7p8U:R:x=p=}>OS0`*t0a#f<o#v$b$c$x${)y*V*Y*g+f+i,S,V.f/d/m/y/{1f1i1q3c4^4j4o5[5_6S7W7v8Q8[8q9b9y:P:`:r;Q;[;d;k<o<q<u<w<y=S=U=X=]=_=a=c=g>]>^n<p<l<m<p<r<v<x<z=T=V=Y=^=`=b=d=h!d=S(u)c*[*e.j.m.q/_/k/|0v1e3h4[4h4l5r7]7`7w7z8X8Z9t9|:S:};R;e;j;v>Z>[`=T3}7c7f7j9h:t:w;yS=_.l3iT=`7e9k!U%Qi$d%O%Q%^%_%c*R*T*a*w*x/P/x0`0b0i0j0o4_5Q8V9p>P>X>Y|*T$v)e*U*t+V/g/v0d0e4R4g4|5R5S5W7p8U:R:x=p=}>OS0b*u0c#f<q#v$b$c$x${)y*V*Y*g+f+i,S,V.f/d/m/y/{1f1i1q3c4^4j4o5[5_6S7W7v8Q8[8q9b9y:P:`:r;Q;[;d;k<o<q<u<w<y=S=U=X=]=_=a=c=g>]>^n<r<l<m<p<r<v<x<z=T=V=Y=^=`=b=d=h!h=U(u)c*[*e.k.l.q/_/k/|0v1e3f3h4[4h4l5r7]7^7`7w7z8X8Z9t9|:S:};R;e;j;v>Z>[d=V3}7d7e7j9h9i:t:u:w;yS=a.m3jT=b7f9lrnOXst!V!Z#d%m&i&r&t&u&w,s,x2[2_Q&f!UR,p&ornOXst!V!Z#d%m&i&r&t&u&w,s,x2[2_R&f!UQ,Y&^R1d,RsnOXst!V!Z#d%m&i&r&t&u&w,s,x2[2_Q1p,_S6R1s1tU8p6P6Q6US:_8r8sS;Y:^:aQ;m;ZR;w;nQ&m!VR,i&iR6_1|R:f8yW&Q|&V&W,OR1Z+vQ&r!WR,s&sR,y&xT2],x2_R,}&yQ,|&yR2f,}Q'y!{R-y'ySsOtQ#dXT%ps#dQ#OTR'{#OQ#RUR'}#RQ){$uR/`){Q#UVR(Q#UQ#XWU(W#X(X.QQ(X#YR.Q(YQ-^'YR2r-^Q.u(yS3m.u3nR3n.vQ-e'`R2v-eY!rQ'`-e1o5{R'j!rQ/Q)eR4S/QU#_W%h*YU(_#_(`.RQ(`#`R.R(ZQ-a']R2t-at`OXst!V!Z#d%m&i&k&r&t&u&w,s,x2[2_S#hZ%eU#r`#h.[R.[(jQ(k#jQ.X(gW.a(k.X3X7RQ3X.YR7R3YQ)n$lR/W)nQ$phR)t$pQ$`cU)a$`-|<jQ-|<WR<j)qQ/q*]W4c/q4d7t9sU4d/r/s/tS7t4e4fR9s7u$e*Q$v(u)c)e*[*e*t*u+Q+R+V.l.m.o.p.q/_/g/i/k/v/|0d0e0v1e3f3g3h3}4R4[4g4h4l4|5O5R5S5W5r7]7^7_7`7e7f7h7i7j7p7w7z8U8X8Z9h9i9j9t9|:R:S:t:u:v:w:x:};R;e;j;v;y=p=}>O>Z>[Q/z*eU4k/z4m7xQ4m/|R7x4lS*o$|*ZR0Y*ox*S$v)e*t*u+V/v0d0e4R4g5R5S5W7p8U:R:x=p=}>O!d.j(u)c*[*e.l.m.q/_/k/|0v1e3h4[4h4l5r7]7`7w7z8X8Z9t9|:S:};R;e;j;v>Z>[U/h*S.j7ca7c3}7e7f7j9h:t:w;yQ0a*tQ3i.lU4}0a3i9kR9k7e|*U$v)e*t*u+V/g/v0d0e4R4g4|5R5S5W7p8U:R:x=p=}>O!h.k(u)c*[*e.l.m.q/_/k/|0v1e3f3h4[4h4l5r7]7^7`7w7z8X8Z9t9|:S:};R;e;j;v>Z>[U/j*U.k7de7d3}7e7f7j9h9i:t:u:w;yQ0c*uQ3j.mU5P0c3j9lR9l7fQ*z%UR0g*zQ5]0vR8Y5]Q+_%kR0u+_Q5v1jS8j5v:[R:[8kQ,[&_R1m,[Q5{1oR8m5{Q1{,fS6]1{8zR8z6_Q1U+rW5h1U5j8a:VQ5j1XQ8a5iR:V8bQ+w&QR1[+wQ2_,xR6m2_YrOXst#dQ&v!ZQ+a%mQ,r&rQ,t&tQ,u&uQ,w&wQ2Y,sS2],x2_R6l2[Q%opQ&z!_Q&}!aQ'P!bQ'R!cQ'q!uQ+`%lQ+l%zQ,Q&XQ,h&mQ-P&|W-p'k's't'wQ-w'oQ0X*nQ1P+mQ1c,PS2O,i,lQ2g-OQ2h-RQ2i-SQ2}-oW3P-r-s-v-xQ5a1QQ5m1_Q5q1eQ6V1uQ6a2QQ6k2ZU6z3O3R3UQ6}3SQ8]5bQ8e5oQ8g5rQ8l5zQ8u6WQ8{6`S9[6{7PQ9^7OQ:W8cQ:b8vQ:g8|Q:n9]Q;U:XQ;]:cQ;a:oQ;l;VR;o;^Q%zyQ'd!iQ'o!uU+m%{%|%}Q-W'VU-k'e'f'gS-o'k'uQ0Q*jS1Q+n+oQ2o-YS2{-l-mQ3S-tS4p0R0UQ5b1RQ6v2uQ6y2|Q7O3TU7{4r4s4vQ9z7}R;O9{S$wi>PR*{%VU%Ui%V>PR0f*yQ$viS(u#v+iS)c$b$cQ)e$dQ*[$xS*e${*YQ*t%OQ*u%QQ+Q%^Q+R%_Q+V%cQ.l<oQ.m<qQ.o<uQ.p<wQ.q<yQ/_)yQ/g*RQ/i*TQ/k*VQ/v*aS/|*g/mQ0d*wQ0e*xl0v+f,V.f1i1q3c6S7W8q9b:`:r;[;dQ1e,SQ3f=SQ3g=UQ3h=XS3}<l<mQ4R/PS4[/d4^Q4g/xQ4h/yQ4l/{Q4|0`Q5O0bQ5R0iQ5S0jQ5W0oQ5r1fQ7]=]Q7^=_Q7_=aQ7`=cQ7e<pQ7f<rQ7h<vQ7i<xQ7j<zQ7p4_Q7w4jQ7z4oQ8U5QQ8X5[Q8Z5_Q9h=YQ9i=TQ9j=VQ9t7vQ9|8QQ:R8VQ:S8[Q:t=^Q:u=`Q:v=bQ:w=dQ:x9pQ:}9yQ;R:PQ;e=gQ;j;QQ;v;kQ;y=hQ=p>PQ=}>XQ>O>YQ>Z>]R>[>^Q+O%]Q.n<sR7g<tnpOXst!Z#d%m&r&t&u&w,s,x2[2_Q!fPS#fZ#oQ&|!`W'h!o*i0]4zQ(P#SQ)Q#{Q)r$nS,l&k&nQ,q&oQ-O&{S-T'T/nQ-g'bQ.x)OQ/[)sQ0s+]Q0y+gQ2W,pQ2y-iQ3a.gQ4W/VQ5U0lQ6Q1rQ6c2SQ6d2TQ6h2VQ6j2XQ6o2aQ7Z3dQ7m4TQ8s6TQ9P6eQ9Q6fQ9S6iQ9f7[Q:a8tR:k9T#[cOPXZst!Z!`!o#d#o#{%m&k&n&o&r&t&u&w&{'T'b)O*i+]+g,p,s,x-i.g/n0]0l1r2S2T2V2X2[2_2a3d4z6T6e6f6i7[8t9TQ#YWQ#eYQ%quQ%svS%uw!gS(S#W(VQ(Y#ZQ(t#uQ(y#xQ)R$OQ)S$PQ)T$QQ)U$RQ)V$SQ)W$TQ)X$UQ)Y$VQ)Z$WQ)[$XQ)^$ZQ)`$_Q)b$aQ)g$eW)q$n)s/V4TQ+d%tQ+x&RS-Z'X2pQ-x'rS-}(T.PQ.S(]Q.U(dQ.s(xQ.v(zQ.z<UQ.|<XQ.}<YQ/O<]Q/b)}Q0p+XQ2k-UQ2n-XQ3O-qQ3V.VQ3k.tQ3p<^Q3q<_Q3r<`Q3s<aQ3t<bQ3u<cQ3v<dQ3w<eQ3x<fQ3y<gQ3z<hQ3{.{Q3|<kQ4P<nQ4Q<{Q4X<iQ5X0rQ5c1SQ6u=OQ6{3QQ7Q3WQ7a3lQ7b=PQ7k=RQ7l=ZQ8k5wQ9X6sQ9]6|Q9g=[Q9m=eQ9n=fQ:o9_Q;W:ZQ;`:mQ<W#SR=v>SR#[WR'Z!el!tQ!r!v!y!z'`'l'm'n-e-u1o5{5}S'V!e-]U*j$|*Z*oS-Y'W'_S0U*k*qQ0^*rQ2u-cQ4v0[R4{0_R({#xQ!fQT-d'`-e]!qQ!r'`-e1o5{Q#p]R'i<VR)f$dY!uQ'`-e1o5{Q'k!rS'u!v!yS'w!z5}S-t'l'mQ-v'nR3T-uT#kZ%eS#jZ%eS%km,oU(g#h#i#lS.Y(h(iQ.^(jQ0t+^Q3Y.ZU3Z.[.]._S7S3[3]R9`7Td#^W#W#Z%h(T(^*Y+Z.T/mr#gZm#h#i#l%e(h(i(j+^.Z.[.]._3[3]7TS*]$x*bQ/t*^Q2U,oQ2l-VQ4`/pQ6q2dQ7s4aQ9W6rT=m'X+[V#aW%h*YU#`W%h*YS(U#W(^U(Z#Z+Z/mS-['X+[T.O(T.TV'^!e%i*ZQ$lfR)x$qT)m$l)nR4V/UT*_$x*bT*h${*YQ0w+fQ1g,VQ3_.fQ5t1iQ6P1qQ7X3cQ8r6SQ9c7WQ:^8qQ:p9bQ;Z:`Q;c:rQ;n;[R;q;dnqOXst!Z#d%m&r&t&u&w,s,x2[2_Q&l!VR,h&itmOXst!U!V!Z#d%m&i&r&t&u&w,s,x2[2_R,o&oT%lm,oR1k,XR,g&gQ&U|S+}&V&WR1^,OR+s&PT&p!W&sT&q!W&sT2^,x2_",
    nodeNames: "\u26A0 ArithOp ArithOp ?. JSXStartTag LineComment BlockComment Script Hashbang ExportDeclaration export Star as VariableName String Escape from ; default FunctionDeclaration async function VariableDefinition > < TypeParamList in out const TypeDefinition extends ThisType this LiteralType ArithOp Number BooleanLiteral TemplateType InterpolationEnd Interpolation InterpolationStart NullType null VoidType void TypeofType typeof MemberExpression . PropertyName [ TemplateString Escape Interpolation super RegExp ] ArrayExpression Spread , } { ObjectExpression Property async get set PropertyDefinition Block : NewTarget new NewExpression ) ( ArgList UnaryExpression delete LogicOp BitOp YieldExpression yield AwaitExpression await ParenthesizedExpression ClassExpression class ClassBody MethodDeclaration Decorator @ MemberExpression PrivatePropertyName CallExpression TypeArgList CompareOp < declare Privacy static abstract override PrivatePropertyDefinition PropertyDeclaration readonly accessor Optional TypeAnnotation Equals StaticBlock FunctionExpression ArrowFunction ParamList ParamList ArrayPattern ObjectPattern PatternProperty Privacy readonly Arrow MemberExpression BinaryExpression ArithOp ArithOp ArithOp ArithOp BitOp CompareOp instanceof satisfies CompareOp BitOp BitOp BitOp LogicOp LogicOp ConditionalExpression LogicOp LogicOp AssignmentExpression UpdateOp PostfixExpression CallExpression InstantiationExpression TaggedTemplateExpression DynamicImport import ImportMeta JSXElement JSXSelfCloseEndTag JSXSelfClosingTag JSXIdentifier JSXBuiltin JSXIdentifier JSXNamespacedName JSXMemberExpression JSXSpreadAttribute JSXAttribute JSXAttributeValue JSXEscape JSXEndTag JSXOpenTag JSXFragmentTag JSXText JSXEscape JSXStartCloseTag JSXCloseTag PrefixCast < ArrowFunction TypeParamList SequenceExpression InstantiationExpression KeyofType keyof UniqueType unique ImportType InferredType infer TypeName ParenthesizedType FunctionSignature ParamList NewSignature IndexedType TupleType Label ArrayType ReadonlyType ObjectType MethodType PropertyType IndexSignature PropertyDefinition CallSignature TypePredicate asserts is NewSignature new UnionType LogicOp IntersectionType LogicOp ConditionalType ParameterizedType ClassDeclaration abstract implements type VariableDeclaration let var using TypeAliasDeclaration InterfaceDeclaration interface EnumDeclaration enum EnumBody NamespaceDeclaration namespace module AmbientDeclaration declare GlobalDeclaration global ClassDeclaration ClassBody AmbientFunctionDeclaration ExportGroup VariableName VariableName ImportDeclaration defer ImportGroup ForStatement for ForSpec ForInSpec ForOfSpec of WhileStatement while WithStatement with DoStatement do IfStatement if else SwitchStatement switch SwitchBody CaseLabel case DefaultLabel TryStatement try CatchClause catch FinallyClause finally ReturnStatement return ThrowStatement throw BreakStatement break ContinueStatement continue DebuggerStatement debugger LabeledStatement ExpressionStatement SingleExpression SingleClassItem",
    maxTerm: 380,
    context: trackNewline,
    nodeProps: [
      ["isolate", -8, 5, 6, 14, 37, 39, 51, 53, 55, ""],
      ["group", -26, 9, 17, 19, 68, 207, 211, 215, 216, 218, 221, 224, 234, 237, 243, 245, 247, 249, 252, 258, 264, 266, 268, 270, 272, 274, 275, "Statement", -34, 13, 14, 32, 35, 36, 42, 51, 54, 55, 57, 62, 70, 72, 76, 80, 82, 84, 85, 110, 111, 120, 121, 136, 139, 141, 142, 143, 144, 145, 147, 148, 167, 169, 171, "Expression", -23, 31, 33, 37, 41, 43, 45, 173, 175, 177, 178, 180, 181, 182, 184, 185, 186, 188, 189, 190, 201, 203, 205, 206, "Type", -3, 88, 103, 109, "ClassItem"],
      ["openedBy", 23, "<", 38, "InterpolationStart", 56, "[", 60, "{", 73, "(", 160, "JSXStartCloseTag"],
      ["closedBy", -2, 24, 168, ">", 40, "InterpolationEnd", 50, "]", 61, "}", 74, ")", 165, "JSXEndTag"]
    ],
    propSources: [jsHighlight],
    skippedNodes: [0, 5, 6, 278],
    repeatNodeCount: 37,
    tokenData: "$Fq07[R!bOX%ZXY+gYZ-yZ[+g[]%Z]^.c^p%Zpq+gqr/mrs3cst:_tuEruvJSvwLkwx! Yxy!'iyz!(sz{!)}{|!,q|}!.O}!O!,q!O!P!/Y!P!Q!9j!Q!R#:O!R![#<_![!]#I_!]!^#Jk!^!_#Ku!_!`$![!`!a$$v!a!b$*T!b!c$,r!c!}Er!}#O$-|#O#P$/W#P#Q$4o#Q#R$5y#R#SEr#S#T$7W#T#o$8b#o#p$<r#p#q$=h#q#r$>x#r#s$@U#s$f%Z$f$g+g$g#BYEr#BY#BZ$A`#BZ$ISEr$IS$I_$A`$I_$I|Er$I|$I}$Dk$I}$JO$Dk$JO$JTEr$JT$JU$A`$JU$KVEr$KV$KW$A`$KW&FUEr&FU&FV$A`&FV;'SEr;'S;=`I|<%l?HTEr?HT?HU$A`?HUOEr(n%d_$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z&j&hT$i&jO!^&c!_#o&c#p;'S&c;'S;=`&w<%lO&c&j&zP;=`<%l&c'|'U]$i&j(Z!bOY&}YZ&cZw&}wx&cx!^&}!^!_'}!_#O&}#O#P&c#P#o&}#o#p'}#p;'S&};'S;=`(l<%lO&}!b(SU(Z!bOY'}Zw'}x#O'}#P;'S'};'S;=`(f<%lO'}!b(iP;=`<%l'}'|(oP;=`<%l&}'[(y]$i&j(WpOY(rYZ&cZr(rrs&cs!^(r!^!_)r!_#O(r#O#P&c#P#o(r#o#p)r#p;'S(r;'S;=`*a<%lO(rp)wU(WpOY)rZr)rs#O)r#P;'S)r;'S;=`*Z<%lO)rp*^P;=`<%l)r'[*dP;=`<%l(r#S*nX(Wp(Z!bOY*gZr*grs'}sw*gwx)rx#O*g#P;'S*g;'S;=`+Z<%lO*g#S+^P;=`<%l*g(n+dP;=`<%l%Z07[+rq$i&j(Wp(Z!b'|0/lOX%ZXY+gYZ&cZ[+g[p%Zpq+gqr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p$f%Z$f$g+g$g#BY%Z#BY#BZ+g#BZ$IS%Z$IS$I_+g$I_$JT%Z$JT$JU+g$JU$KV%Z$KV$KW+g$KW&FU%Z&FU&FV+g&FV;'S%Z;'S;=`+a<%l?HT%Z?HT?HU+g?HUO%Z07[.ST(X#S$i&j'}0/lO!^&c!_#o&c#p;'S&c;'S;=`&w<%lO&c07[.n_$i&j(Wp(Z!b'}0/lOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z)3p/x`$i&j!p),Q(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`0z!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW1V`#v(Ch$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`2X!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW2d_#v(Ch$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'At3l_(V':f$i&j(Z!bOY4kYZ5qZr4krs7nsw4kwx5qx!^4k!^!_8p!_#O4k#O#P5q#P#o4k#o#p8p#p;'S4k;'S;=`:X<%lO4k(^4r_$i&j(Z!bOY4kYZ5qZr4krs7nsw4kwx5qx!^4k!^!_8p!_#O4k#O#P5q#P#o4k#o#p8p#p;'S4k;'S;=`:X<%lO4k&z5vX$i&jOr5qrs6cs!^5q!^!_6y!_#o5q#o#p6y#p;'S5q;'S;=`7h<%lO5q&z6jT$d`$i&jO!^&c!_#o&c#p;'S&c;'S;=`&w<%lO&c`6|TOr6yrs7]s;'S6y;'S;=`7b<%lO6y`7bO$d``7eP;=`<%l6y&z7kP;=`<%l5q(^7w]$d`$i&j(Z!bOY&}YZ&cZw&}wx&cx!^&}!^!_'}!_#O&}#O#P&c#P#o&}#o#p'}#p;'S&};'S;=`(l<%lO&}!r8uZ(Z!bOY8pYZ6yZr8prs9hsw8pwx6yx#O8p#O#P6y#P;'S8p;'S;=`:R<%lO8p!r9oU$d`(Z!bOY'}Zw'}x#O'}#P;'S'};'S;=`(f<%lO'}!r:UP;=`<%l8p(^:[P;=`<%l4k%9[:hh$i&j(Wp(Z!bOY%ZYZ&cZq%Zqr<Srs&}st%ZtuCruw%Zwx(rx!^%Z!^!_*g!_!c%Z!c!}Cr!}#O%Z#O#P&c#P#R%Z#R#SCr#S#T%Z#T#oCr#o#p*g#p$g%Z$g;'SCr;'S;=`El<%lOCr(r<__WS$i&j(Wp(Z!bOY<SYZ&cZr<Srs=^sw<Swx@nx!^<S!^!_Bm!_#O<S#O#P>`#P#o<S#o#pBm#p;'S<S;'S;=`Cl<%lO<S(Q=g]WS$i&j(Z!bOY=^YZ&cZw=^wx>`x!^=^!^!_?q!_#O=^#O#P>`#P#o=^#o#p?q#p;'S=^;'S;=`@h<%lO=^&n>gXWS$i&jOY>`YZ&cZ!^>`!^!_?S!_#o>`#o#p?S#p;'S>`;'S;=`?k<%lO>`S?XSWSOY?SZ;'S?S;'S;=`?e<%lO?SS?hP;=`<%l?S&n?nP;=`<%l>`!f?xWWS(Z!bOY?qZw?qwx?Sx#O?q#O#P?S#P;'S?q;'S;=`@b<%lO?q!f@eP;=`<%l?q(Q@kP;=`<%l=^'`@w]WS$i&j(WpOY@nYZ&cZr@nrs>`s!^@n!^!_Ap!_#O@n#O#P>`#P#o@n#o#pAp#p;'S@n;'S;=`Bg<%lO@ntAwWWS(WpOYApZrAprs?Ss#OAp#O#P?S#P;'SAp;'S;=`Ba<%lOAptBdP;=`<%lAp'`BjP;=`<%l@n#WBvYWS(Wp(Z!bOYBmZrBmrs?qswBmwxApx#OBm#O#P?S#P;'SBm;'S;=`Cf<%lOBm#WCiP;=`<%lBm(rCoP;=`<%l<S%9[C}i$i&j(o%1l(Wp(Z!bOY%ZYZ&cZr%Zrs&}st%ZtuCruw%Zwx(rx!Q%Z!Q![Cr![!^%Z!^!_*g!_!c%Z!c!}Cr!}#O%Z#O#P&c#P#R%Z#R#SCr#S#T%Z#T#oCr#o#p*g#p$g%Z$g;'SCr;'S;=`El<%lOCr%9[EoP;=`<%lCr07[FRk$i&j(Wp(Z!b$]#t(T,2j(e$I[OY%ZYZ&cZr%Zrs&}st%ZtuEruw%Zwx(rx}%Z}!OGv!O!Q%Z!Q![Er![!^%Z!^!_*g!_!c%Z!c!}Er!}#O%Z#O#P&c#P#R%Z#R#SEr#S#T%Z#T#oEr#o#p*g#p$g%Z$g;'SEr;'S;=`I|<%lOEr+dHRk$i&j(Wp(Z!b$]#tOY%ZYZ&cZr%Zrs&}st%ZtuGvuw%Zwx(rx}%Z}!OGv!O!Q%Z!Q![Gv![!^%Z!^!_*g!_!c%Z!c!}Gv!}#O%Z#O#P&c#P#R%Z#R#SGv#S#T%Z#T#oGv#o#p*g#p$g%Z$g;'SGv;'S;=`Iv<%lOGv+dIyP;=`<%lGv07[JPP;=`<%lEr(KWJ_`$i&j(Wp(Z!b#p(ChOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KWKl_$i&j$Q(Ch(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z,#xLva(z+JY$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sv%ZvwM{wx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KWNW`$i&j#z(Ch(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'At! c_(Y';W$i&j(WpOY!!bYZ!#hZr!!brs!#hsw!!bwx!$xx!^!!b!^!_!%z!_#O!!b#O#P!#h#P#o!!b#o#p!%z#p;'S!!b;'S;=`!'c<%lO!!b'l!!i_$i&j(WpOY!!bYZ!#hZr!!brs!#hsw!!bwx!$xx!^!!b!^!_!%z!_#O!!b#O#P!#h#P#o!!b#o#p!%z#p;'S!!b;'S;=`!'c<%lO!!b&z!#mX$i&jOw!#hwx6cx!^!#h!^!_!$Y!_#o!#h#o#p!$Y#p;'S!#h;'S;=`!$r<%lO!#h`!$]TOw!$Ywx7]x;'S!$Y;'S;=`!$l<%lO!$Y`!$oP;=`<%l!$Y&z!$uP;=`<%l!#h'l!%R]$d`$i&j(WpOY(rYZ&cZr(rrs&cs!^(r!^!_)r!_#O(r#O#P&c#P#o(r#o#p)r#p;'S(r;'S;=`*a<%lO(r!Q!&PZ(WpOY!%zYZ!$YZr!%zrs!$Ysw!%zwx!&rx#O!%z#O#P!$Y#P;'S!%z;'S;=`!']<%lO!%z!Q!&yU$d`(WpOY)rZr)rs#O)r#P;'S)r;'S;=`*Z<%lO)r!Q!'`P;=`<%l!%z'l!'fP;=`<%l!!b/5|!'t_!l/.^$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z#&U!)O_!k!Lf$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z-!n!*[b$i&j(Wp(Z!b(U%&f#q(ChOY%ZYZ&cZr%Zrs&}sw%Zwx(rxz%Zz{!+d{!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW!+o`$i&j(Wp(Z!b#n(ChOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z+;x!,|`$i&j(Wp(Z!br+4YOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z,$U!.Z_!]+Jf$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z07[!/ec$i&j(Wp(Z!b!Q.2^OY%ZYZ&cZr%Zrs&}sw%Zwx(rx!O%Z!O!P!0p!P!Q%Z!Q![!3Y![!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z#%|!0ya$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!O%Z!O!P!2O!P!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z#%|!2Z_![!L^$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad!3eg$i&j(Wp(Z!bs'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q![!3Y![!^%Z!^!_*g!_!g%Z!g!h!4|!h#O%Z#O#P&c#P#R%Z#R#S!3Y#S#X%Z#X#Y!4|#Y#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad!5Vg$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx{%Z{|!6n|}%Z}!O!6n!O!Q%Z!Q![!8S![!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S!8S#S#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad!6wc$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q![!8S![!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S!8S#S#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad!8_c$i&j(Wp(Z!bs'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q![!8S![!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S!8S#S#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z07[!9uf$i&j(Wp(Z!b#o(ChOY!;ZYZ&cZr!;Zrs!<nsw!;Zwx!Lcxz!;Zz{#-}{!P!;Z!P!Q#/d!Q!^!;Z!^!_#(i!_!`#7S!`!a#8i!a!}!;Z!}#O#,f#O#P!Dy#P#o!;Z#o#p#(i#p;'S!;Z;'S;=`#-w<%lO!;Z?O!;fb$i&j(Wp(Z!b!X7`OY!;ZYZ&cZr!;Zrs!<nsw!;Zwx!Lcx!P!;Z!P!Q#&`!Q!^!;Z!^!_#(i!_!}!;Z!}#O#,f#O#P!Dy#P#o!;Z#o#p#(i#p;'S!;Z;'S;=`#-w<%lO!;Z>^!<w`$i&j(Z!b!X7`OY!<nYZ&cZw!<nwx!=yx!P!<n!P!Q!Eq!Q!^!<n!^!_!Gr!_!}!<n!}#O!KS#O#P!Dy#P#o!<n#o#p!Gr#p;'S!<n;'S;=`!L]<%lO!<n<z!>Q^$i&j!X7`OY!=yYZ&cZ!P!=y!P!Q!>|!Q!^!=y!^!_!@c!_!}!=y!}#O!CW#O#P!Dy#P#o!=y#o#p!@c#p;'S!=y;'S;=`!Ek<%lO!=y<z!?Td$i&j!X7`O!^&c!_#W&c#W#X!>|#X#Z&c#Z#[!>|#[#]&c#]#^!>|#^#a&c#a#b!>|#b#g&c#g#h!>|#h#i&c#i#j!>|#j#k!>|#k#m&c#m#n!>|#n#o&c#p;'S&c;'S;=`&w<%lO&c7`!@hX!X7`OY!@cZ!P!@c!P!Q!AT!Q!}!@c!}#O!Ar#O#P!Bq#P;'S!@c;'S;=`!CQ<%lO!@c7`!AYW!X7`#W#X!AT#Z#[!AT#]#^!AT#a#b!AT#g#h!AT#i#j!AT#j#k!AT#m#n!AT7`!AuVOY!ArZ#O!Ar#O#P!B[#P#Q!@c#Q;'S!Ar;'S;=`!Bk<%lO!Ar7`!B_SOY!ArZ;'S!Ar;'S;=`!Bk<%lO!Ar7`!BnP;=`<%l!Ar7`!BtSOY!@cZ;'S!@c;'S;=`!CQ<%lO!@c7`!CTP;=`<%l!@c<z!C][$i&jOY!CWYZ&cZ!^!CW!^!_!Ar!_#O!CW#O#P!DR#P#Q!=y#Q#o!CW#o#p!Ar#p;'S!CW;'S;=`!Ds<%lO!CW<z!DWX$i&jOY!CWYZ&cZ!^!CW!^!_!Ar!_#o!CW#o#p!Ar#p;'S!CW;'S;=`!Ds<%lO!CW<z!DvP;=`<%l!CW<z!EOX$i&jOY!=yYZ&cZ!^!=y!^!_!@c!_#o!=y#o#p!@c#p;'S!=y;'S;=`!Ek<%lO!=y<z!EnP;=`<%l!=y>^!Ezl$i&j(Z!b!X7`OY&}YZ&cZw&}wx&cx!^&}!^!_'}!_#O&}#O#P&c#P#W&}#W#X!Eq#X#Z&}#Z#[!Eq#[#]&}#]#^!Eq#^#a&}#a#b!Eq#b#g&}#g#h!Eq#h#i&}#i#j!Eq#j#k!Eq#k#m&}#m#n!Eq#n#o&}#o#p'}#p;'S&};'S;=`(l<%lO&}8r!GyZ(Z!b!X7`OY!GrZw!Grwx!@cx!P!Gr!P!Q!Hl!Q!}!Gr!}#O!JU#O#P!Bq#P;'S!Gr;'S;=`!J|<%lO!Gr8r!Hse(Z!b!X7`OY'}Zw'}x#O'}#P#W'}#W#X!Hl#X#Z'}#Z#[!Hl#[#]'}#]#^!Hl#^#a'}#a#b!Hl#b#g'}#g#h!Hl#h#i'}#i#j!Hl#j#k!Hl#k#m'}#m#n!Hl#n;'S'};'S;=`(f<%lO'}8r!JZX(Z!bOY!JUZw!JUwx!Arx#O!JU#O#P!B[#P#Q!Gr#Q;'S!JU;'S;=`!Jv<%lO!JU8r!JyP;=`<%l!JU8r!KPP;=`<%l!Gr>^!KZ^$i&j(Z!bOY!KSYZ&cZw!KSwx!CWx!^!KS!^!_!JU!_#O!KS#O#P!DR#P#Q!<n#Q#o!KS#o#p!JU#p;'S!KS;'S;=`!LV<%lO!KS>^!LYP;=`<%l!KS>^!L`P;=`<%l!<n=l!Ll`$i&j(Wp!X7`OY!LcYZ&cZr!Lcrs!=ys!P!Lc!P!Q!Mn!Q!^!Lc!^!_# o!_!}!Lc!}#O#%P#O#P!Dy#P#o!Lc#o#p# o#p;'S!Lc;'S;=`#&Y<%lO!Lc=l!Mwl$i&j(Wp!X7`OY(rYZ&cZr(rrs&cs!^(r!^!_)r!_#O(r#O#P&c#P#W(r#W#X!Mn#X#Z(r#Z#[!Mn#[#](r#]#^!Mn#^#a(r#a#b!Mn#b#g(r#g#h!Mn#h#i(r#i#j!Mn#j#k!Mn#k#m(r#m#n!Mn#n#o(r#o#p)r#p;'S(r;'S;=`*a<%lO(r8Q# vZ(Wp!X7`OY# oZr# ors!@cs!P# o!P!Q#!i!Q!}# o!}#O#$R#O#P!Bq#P;'S# o;'S;=`#$y<%lO# o8Q#!pe(Wp!X7`OY)rZr)rs#O)r#P#W)r#W#X#!i#X#Z)r#Z#[#!i#[#])r#]#^#!i#^#a)r#a#b#!i#b#g)r#g#h#!i#h#i)r#i#j#!i#j#k#!i#k#m)r#m#n#!i#n;'S)r;'S;=`*Z<%lO)r8Q#$WX(WpOY#$RZr#$Rrs!Ars#O#$R#O#P!B[#P#Q# o#Q;'S#$R;'S;=`#$s<%lO#$R8Q#$vP;=`<%l#$R8Q#$|P;=`<%l# o=l#%W^$i&j(WpOY#%PYZ&cZr#%Prs!CWs!^#%P!^!_#$R!_#O#%P#O#P!DR#P#Q!Lc#Q#o#%P#o#p#$R#p;'S#%P;'S;=`#&S<%lO#%P=l#&VP;=`<%l#%P=l#&]P;=`<%l!Lc?O#&kn$i&j(Wp(Z!b!X7`OY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#W%Z#W#X#&`#X#Z%Z#Z#[#&`#[#]%Z#]#^#&`#^#a%Z#a#b#&`#b#g%Z#g#h#&`#h#i%Z#i#j#&`#j#k#&`#k#m%Z#m#n#&`#n#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z9d#(r](Wp(Z!b!X7`OY#(iZr#(irs!Grsw#(iwx# ox!P#(i!P!Q#)k!Q!}#(i!}#O#+`#O#P!Bq#P;'S#(i;'S;=`#,`<%lO#(i9d#)th(Wp(Z!b!X7`OY*gZr*grs'}sw*gwx)rx#O*g#P#W*g#W#X#)k#X#Z*g#Z#[#)k#[#]*g#]#^#)k#^#a*g#a#b#)k#b#g*g#g#h#)k#h#i*g#i#j#)k#j#k#)k#k#m*g#m#n#)k#n;'S*g;'S;=`+Z<%lO*g9d#+gZ(Wp(Z!bOY#+`Zr#+`rs!JUsw#+`wx#$Rx#O#+`#O#P!B[#P#Q#(i#Q;'S#+`;'S;=`#,Y<%lO#+`9d#,]P;=`<%l#+`9d#,cP;=`<%l#(i?O#,o`$i&j(Wp(Z!bOY#,fYZ&cZr#,frs!KSsw#,fwx#%Px!^#,f!^!_#+`!_#O#,f#O#P!DR#P#Q!;Z#Q#o#,f#o#p#+`#p;'S#,f;'S;=`#-q<%lO#,f?O#-tP;=`<%l#,f?O#-zP;=`<%l!;Z07[#.[b$i&j(Wp(Z!b(O0/l!X7`OY!;ZYZ&cZr!;Zrs!<nsw!;Zwx!Lcx!P!;Z!P!Q#&`!Q!^!;Z!^!_#(i!_!}!;Z!}#O#,f#O#P!Dy#P#o!;Z#o#p#(i#p;'S!;Z;'S;=`#-w<%lO!;Z07[#/o_$i&j(Wp(Z!bT0/lOY#/dYZ&cZr#/drs#0nsw#/dwx#4Ox!^#/d!^!_#5}!_#O#/d#O#P#1p#P#o#/d#o#p#5}#p;'S#/d;'S;=`#6|<%lO#/d06j#0w]$i&j(Z!bT0/lOY#0nYZ&cZw#0nwx#1px!^#0n!^!_#3R!_#O#0n#O#P#1p#P#o#0n#o#p#3R#p;'S#0n;'S;=`#3x<%lO#0n05W#1wX$i&jT0/lOY#1pYZ&cZ!^#1p!^!_#2d!_#o#1p#o#p#2d#p;'S#1p;'S;=`#2{<%lO#1p0/l#2iST0/lOY#2dZ;'S#2d;'S;=`#2u<%lO#2d0/l#2xP;=`<%l#2d05W#3OP;=`<%l#1p01O#3YW(Z!bT0/lOY#3RZw#3Rwx#2dx#O#3R#O#P#2d#P;'S#3R;'S;=`#3r<%lO#3R01O#3uP;=`<%l#3R06j#3{P;=`<%l#0n05x#4X]$i&j(WpT0/lOY#4OYZ&cZr#4Ors#1ps!^#4O!^!_#5Q!_#O#4O#O#P#1p#P#o#4O#o#p#5Q#p;'S#4O;'S;=`#5w<%lO#4O00^#5XW(WpT0/lOY#5QZr#5Qrs#2ds#O#5Q#O#P#2d#P;'S#5Q;'S;=`#5q<%lO#5Q00^#5tP;=`<%l#5Q05x#5zP;=`<%l#4O01p#6WY(Wp(Z!bT0/lOY#5}Zr#5}rs#3Rsw#5}wx#5Qx#O#5}#O#P#2d#P;'S#5};'S;=`#6v<%lO#5}01p#6yP;=`<%l#5}07[#7PP;=`<%l#/d)3h#7ab$i&j$Q(Ch(Wp(Z!b!X7`OY!;ZYZ&cZr!;Zrs!<nsw!;Zwx!Lcx!P!;Z!P!Q#&`!Q!^!;Z!^!_#(i!_!}!;Z!}#O#,f#O#P!Dy#P#o!;Z#o#p#(i#p;'S!;Z;'S;=`#-w<%lO!;ZAt#8vb$Z#t$i&j(Wp(Z!b!X7`OY!;ZYZ&cZr!;Zrs!<nsw!;Zwx!Lcx!P!;Z!P!Q#&`!Q!^!;Z!^!_#(i!_!}!;Z!}#O#,f#O#P!Dy#P#o!;Z#o#p#(i#p;'S!;Z;'S;=`#-w<%lO!;Z'Ad#:Zp$i&j(Wp(Z!bs'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!O%Z!O!P!3Y!P!Q%Z!Q![#<_![!^%Z!^!_*g!_!g%Z!g!h!4|!h#O%Z#O#P&c#P#R%Z#R#S#<_#S#U%Z#U#V#?i#V#X%Z#X#Y!4|#Y#b%Z#b#c#>_#c#d#Bq#d#l%Z#l#m#Es#m#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#<jk$i&j(Wp(Z!bs'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!O%Z!O!P!3Y!P!Q%Z!Q![#<_![!^%Z!^!_*g!_!g%Z!g!h!4|!h#O%Z#O#P&c#P#R%Z#R#S#<_#S#X%Z#X#Y!4|#Y#b%Z#b#c#>_#c#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#>j_$i&j(Wp(Z!bs'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#?rd$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q!R#AQ!R!S#AQ!S!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S#AQ#S#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#A]f$i&j(Wp(Z!bs'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q!R#AQ!R!S#AQ!S!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S#AQ#S#b%Z#b#c#>_#c#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#Bzc$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q!Y#DV!Y!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S#DV#S#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#Dbe$i&j(Wp(Z!bs'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q!Y#DV!Y!^%Z!^!_*g!_#O%Z#O#P&c#P#R%Z#R#S#DV#S#b%Z#b#c#>_#c#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#E|g$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q![#Ge![!^%Z!^!_*g!_!c%Z!c!i#Ge!i#O%Z#O#P&c#P#R%Z#R#S#Ge#S#T%Z#T#Z#Ge#Z#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z'Ad#Gpi$i&j(Wp(Z!bs'9tOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!Q%Z!Q![#Ge![!^%Z!^!_*g!_!c%Z!c!i#Ge!i#O%Z#O#P&c#P#R%Z#R#S#Ge#S#T%Z#T#Z#Ge#Z#b%Z#b#c#>_#c#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z*)x#Il_!g$b$i&j$O)Lv(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z)[#Jv_al$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z04f#LS^h#)`#R-<U(Wp(Z!b$n7`OY*gZr*grs'}sw*gwx)rx!P*g!P!Q#MO!Q!^*g!^!_#Mt!_!`$ f!`#O*g#P;'S*g;'S;=`+Z<%lO*g(n#MXX$k&j(Wp(Z!bOY*gZr*grs'}sw*gwx)rx#O*g#P;'S*g;'S;=`+Z<%lO*g(El#M}Z#r(Ch(Wp(Z!bOY*gZr*grs'}sw*gwx)rx!_*g!_!`#Np!`#O*g#P;'S*g;'S;=`+Z<%lO*g(El#NyX$Q(Ch(Wp(Z!bOY*gZr*grs'}sw*gwx)rx#O*g#P;'S*g;'S;=`+Z<%lO*g(El$ oX#s(Ch(Wp(Z!bOY*gZr*grs'}sw*gwx)rx#O*g#P;'S*g;'S;=`+Z<%lO*g*)x$!ga#`*!Y$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`0z!`!a$#l!a#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(K[$#w_#k(Cl$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z*)x$%Vag!*r#s(Ch$f#|$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`$&[!`!a$'f!a#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW$&g_#s(Ch$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW$'qa#r(Ch$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`!a$(v!a#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW$)R`#r(Ch$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(Kd$*`a(r(Ct$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!a%Z!a!b$+e!b#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW$+p`$i&j#{(Ch(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z%#`$,}_!|$Ip$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z04f$.X_!S0,v$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(n$/]Z$i&jO!^$0O!^!_$0f!_#i$0O#i#j$0k#j#l$0O#l#m$2^#m#o$0O#o#p$0f#p;'S$0O;'S;=`$4i<%lO$0O(n$0VT_#S$i&jO!^&c!_#o&c#p;'S&c;'S;=`&w<%lO&c#S$0kO_#S(n$0p[$i&jO!Q&c!Q![$1f![!^&c!_!c&c!c!i$1f!i#T&c#T#Z$1f#Z#o&c#o#p$3|#p;'S&c;'S;=`&w<%lO&c(n$1kZ$i&jO!Q&c!Q![$2^![!^&c!_!c&c!c!i$2^!i#T&c#T#Z$2^#Z#o&c#p;'S&c;'S;=`&w<%lO&c(n$2cZ$i&jO!Q&c!Q![$3U![!^&c!_!c&c!c!i$3U!i#T&c#T#Z$3U#Z#o&c#p;'S&c;'S;=`&w<%lO&c(n$3ZZ$i&jO!Q&c!Q![$0O![!^&c!_!c&c!c!i$0O!i#T&c#T#Z$0O#Z#o&c#p;'S&c;'S;=`&w<%lO&c#S$4PR!Q![$4Y!c!i$4Y#T#Z$4Y#S$4]S!Q![$4Y!c!i$4Y#T#Z$4Y#q#r$0f(n$4lP;=`<%l$0O#1[$4z_!Y#)l$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z(KW$6U`#x(Ch$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z+;p$7c_$i&j(Wp(Z!b(a+4QOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z07[$8qk$i&j(Wp(Z!b(T,2j$_#t(e$I[OY%ZYZ&cZr%Zrs&}st%Ztu$8buw%Zwx(rx}%Z}!O$:f!O!Q%Z!Q![$8b![!^%Z!^!_*g!_!c%Z!c!}$8b!}#O%Z#O#P&c#P#R%Z#R#S$8b#S#T%Z#T#o$8b#o#p*g#p$g%Z$g;'S$8b;'S;=`$<l<%lO$8b+d$:qk$i&j(Wp(Z!b$_#tOY%ZYZ&cZr%Zrs&}st%Ztu$:fuw%Zwx(rx}%Z}!O$:f!O!Q%Z!Q![$:f![!^%Z!^!_*g!_!c%Z!c!}$:f!}#O%Z#O#P&c#P#R%Z#R#S$:f#S#T%Z#T#o$:f#o#p*g#p$g%Z$g;'S$:f;'S;=`$<f<%lO$:f+d$<iP;=`<%l$:f07[$<oP;=`<%l$8b#Jf$<{X!_#Hb(Wp(Z!bOY*gZr*grs'}sw*gwx)rx#O*g#P;'S*g;'S;=`+Z<%lO*g,#x$=sa(y+JY$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_!`Ka!`#O%Z#O#P&c#P#o%Z#o#p*g#p#q$+e#q;'S%Z;'S;=`+a<%lO%Z)>v$?V_!^(CdvBr$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z?O$@a_!q7`$i&j(Wp(Z!bOY%ZYZ&cZr%Zrs&}sw%Zwx(rx!^%Z!^!_*g!_#O%Z#O#P&c#P#o%Z#o#p*g#p;'S%Z;'S;=`+a<%lO%Z07[$Aq|$i&j(Wp(Z!b'|0/l$]#t(T,2j(e$I[OX%ZXY+gYZ&cZ[+g[p%Zpq+gqr%Zrs&}st%ZtuEruw%Zwx(rx}%Z}!OGv!O!Q%Z!Q![Er![!^%Z!^!_*g!_!c%Z!c!}Er!}#O%Z#O#P&c#P#R%Z#R#SEr#S#T%Z#T#oEr#o#p*g#p$f%Z$f$g+g$g#BYEr#BY#BZ$A`#BZ$ISEr$IS$I_$A`$I_$JTEr$JT$JU$A`$JU$KVEr$KV$KW$A`$KW&FUEr&FU&FV$A`&FV;'SEr;'S;=`I|<%l?HTEr?HT?HU$A`?HUOEr07[$D|k$i&j(Wp(Z!b'}0/l$]#t(T,2j(e$I[OY%ZYZ&cZr%Zrs&}st%ZtuEruw%Zwx(rx}%Z}!OGv!O!Q%Z!Q![Er![!^%Z!^!_*g!_!c%Z!c!}Er!}#O%Z#O#P&c#P#R%Z#R#SEr#S#T%Z#T#oEr#o#p*g#p$g%Z$g;'SEr;'S;=`I|<%lOEr",
    tokenizers: [noSemicolon, noSemicolonType, operatorToken, jsx, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, insertSemicolon, new LocalTokenGroup("$S~RRtu[#O#Pg#S#T#|~_P#o#pb~gOx~~jVO#i!P#i#j!U#j#l!P#l#m!q#m;'S!P;'S;=`#v<%lO!P~!UO!U~~!XS!Q![!e!c!i!e#T#Z!e#o#p#Z~!hR!Q![!q!c!i!q#T#Z!q~!tR!Q![!}!c!i!}#T#Z!}~#QR!Q![!P!c!i!P#T#Z!P~#^R!Q![#g!c!i#g#T#Z#g~#jS!Q![#g!c!i#g#T#Z#g#q#r!P~#yP;=`<%l!P~$RO(c~~", 141, 340), new LocalTokenGroup("j~RQYZXz{^~^O(Q~~aP!P!Qd~iO(R~~", 25, 323)],
    topRules: { "Script": [0, 7], "SingleExpression": [1, 276], "SingleClassItem": [2, 277] },
    dialects: { jsx: 0, ts: 15175 },
    dynamicPrecedences: { "80": 1, "82": 1, "94": 1, "169": 1, "199": 1 },
    specialized: [{ term: 327, get: (value) => spec_identifier[value] || -1 }, { term: 343, get: (value) => spec_word[value] || -1 }, { term: 95, get: (value) => spec_LessThan[value] || -1 }],
    tokenPrec: 15201
  });

  // node_modules/@lezer/css/dist/index.js
  var descendantOp = 148;
  var Unit = 1;
  var identifier = 149;
  var callee = 150;
  var VariableName = 2;
  var queryIdentifier = 151;
  var queryVariableName = 3;
  var QueryCallee = 4;
  var space2 = [
    9,
    10,
    11,
    12,
    13,
    32,
    133,
    160,
    5760,
    8192,
    8193,
    8194,
    8195,
    8196,
    8197,
    8198,
    8199,
    8200,
    8201,
    8202,
    8232,
    8233,
    8239,
    8287,
    12288
  ];
  var colon = 58;
  var parenL = 40;
  var underscore = 95;
  var bracketL2 = 91;
  var dash2 = 45;
  var period = 46;
  var hash = 35;
  var percent = 37;
  var ampersand = 38;
  var backslash = 92;
  var newline2 = 10;
  var asterisk = 42;
  function isAlpha(ch) {
    return ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122 || ch >= 161;
  }
  function isDigit(ch) {
    return ch >= 48 && ch <= 57;
  }
  function isHex(ch) {
    return isDigit(ch) || ch >= 97 && ch <= 102 || ch >= 65 && ch <= 70;
  }
  var identifierTokens = (id2, varName, callee2) => (input, stack) => {
    for (let inside = false, dashes = 0, i = 0; ; i++) {
      let { next } = input;
      if (isAlpha(next) || next == dash2 || next == underscore || inside && isDigit(next)) {
        if (!inside && (next != dash2 || i > 0)) inside = true;
        if (dashes === i && next == dash2) dashes++;
        input.advance();
      } else if (next == backslash && input.peek(1) != newline2) {
        input.advance();
        if (isHex(input.next)) {
          do {
            input.advance();
          } while (isHex(input.next));
          if (input.next == 32) input.advance();
        } else if (input.next > -1) {
          input.advance();
        }
        inside = true;
      } else {
        if (inside) input.acceptToken(
          dashes == 2 && stack.canShift(VariableName) ? varName : next == parenL ? callee2 : id2
        );
        break;
      }
    }
  };
  var identifiers = new ExternalTokenizer(
    identifierTokens(identifier, VariableName, callee),
    { contextual: true }
  );
  var queryIdentifiers = new ExternalTokenizer(
    identifierTokens(queryIdentifier, queryVariableName, QueryCallee),
    { contextual: true }
  );
  var descendant = new ExternalTokenizer((input) => {
    if (space2.includes(input.peek(-1))) {
      let { next } = input;
      if (isAlpha(next) || next == underscore || next == hash || next == period || next == asterisk || next == bracketL2 || next == colon && isAlpha(input.peek(1)) || next == dash2 || next == ampersand)
        input.acceptToken(descendantOp);
    }
  });
  var unitToken = new ExternalTokenizer((input) => {
    if (!space2.includes(input.peek(-1))) {
      let { next } = input;
      if (next == percent) {
        input.advance();
        input.acceptToken(Unit);
      }
      if (isAlpha(next)) {
        do {
          input.advance();
        } while (isAlpha(input.next) || isDigit(input.next));
        input.acceptToken(Unit);
      }
    }
  });
  var cssHighlighting = styleTags({
    "AtKeyword import charset namespace keyframes media supports font-feature-values": tags.definitionKeyword,
    "from to selector scope MatchFlag": tags.keyword,
    NamespaceName: tags.namespace,
    KeyframeName: tags.labelName,
    KeyframeRangeName: tags.operatorKeyword,
    TagName: tags.tagName,
    ClassName: tags.className,
    PseudoClassName: tags.constant(tags.className),
    IdName: tags.labelName,
    "FeatureName PropertyName": tags.propertyName,
    AttributeName: tags.attributeName,
    NumberLiteral: tags.number,
    KeywordQuery: tags.keyword,
    UnaryQueryOp: tags.operatorKeyword,
    "CallTag ValueName FontName": tags.atom,
    VariableName: tags.variableName,
    Callee: tags.operatorKeyword,
    Unit: tags.unit,
    "UniversalSelector NestingSelector": tags.definitionOperator,
    "MatchOp CompareOp": tags.compareOperator,
    "ChildOp SiblingOp, LogicOp": tags.logicOperator,
    BinOp: tags.arithmeticOperator,
    Important: tags.modifier,
    Comment: tags.blockComment,
    ColorLiteral: tags.color,
    "ParenthesizedContent StringLiteral": tags.string,
    ":": tags.punctuation,
    "PseudoOp #": tags.derefOperator,
    "; , |": tags.separator,
    "( )": tags.paren,
    "[ ]": tags.squareBracket,
    "{ }": tags.brace
  });
  var spec_callee = { __proto__: null, lang: 44, "nth-child": 44, "nth-last-child": 44, "nth-of-type": 44, "nth-last-of-type": 44, dir: 44, "host-context": 44, if: 90, url: 158, "url-prefix": 158, domain: 158, regexp: 158 };
  var spec_queryIdentifier = { __proto__: null, or: 104, and: 104, not: 112, only: 112, layer: 212 };
  var spec_QueryCallee = { __proto__: null, selector: 118, style: 124, layer: 208 };
  var spec_AtKeyword = { __proto__: null, "@import": 204, "@media": 216, "@charset": 220, "@namespace": 224, "@keyframes": 230, "@supports": 242, "@scope": 246, "@font-feature-values": 252 };
  var spec_identifier2 = { __proto__: null, to: 249 };
  var parser3 = LRParser.deserialize({
    version: 14,
    states: "MrQYQdOOO#}QdOOP$UO`OOO%OQaO'#CfOOQP'#Ce'#CeO%VQdO'#CgO%[Q`O'#CgO%aQaO'#FqO&XQdO'#CkO&xQaO'#CcO'SQdO'#CnO'_QdO'#ERO'dQdO'#ETO'oQdO'#E[O'oQdO'#E_OOQP'#Fq'#FqO)RQhO'#FQOOQS'#Fp'#FpOOQS'#FT'#FTQYQdOOO)YQdO'#EeO*iQhO'#EkO)YQdO'#EmO*pQdO'#EoO*{QdO'#ErO)}QhO'#ExO+TQdO'#EzO+`QdO'#E}O+eQaO'#CfO+lQ`O'#EbO+qQ`O'#F}O+|QdO'#F}QOQ`OOP,WO&jO'#CaPOOO)CA`)CA`OOQP'#Ci'#CiOOQP,59R,59RO%VQdO,59ROOQP'#Cm'#CmOOQP,59V,59VO&XQdO,59VO,cQdO,59YO'_QdO,5:mO'dQdO,5:oO'oQdO,5:vO'oQdO,5:xO'oQdO,5:yO'oQdO'#F[O,nQ`O,58}O,vQdO'#EaOOQS,58},58}OOQP'#Cq'#CqOOQO'#EP'#EPOOQP,59Y,59YO,}Q`O,59YO-SQ`O,59YOOQP'#ES'#ESOOQP,5:m,5:mO-XQpO'#EUO-dQdO'#EVO-iQ`O'#EVO-nQpO,5:oO.XQaO,5:vO.oQaO,5:yOOQW'#D^'#D^O/nQhO'#DgO0RQhO,5;lO)}QhO'#DeO0`Q`O'#DnO0eQhO'#D{OOQW'#Fw'#FwOOQS,5;l,5;lO0jQ`O'#DhO0oQ`O'#DkOOQS-E9R-E9ROOQ['#Cv'#CvO0tQdO'#CwO1[QdO'#C}O1rQdO'#DQO2YQ!pO'#DSO4fQ!jO,5;POOQO'#DX'#DXO-SQ`O'#DWO4vQ!nO'#FtO6|Q`O'#DYO7RQ`O'#D|OOQ['#Ft'#FtO7WQhO'#GQO7fQ`O,5;VO7kQ!bO,5;XOOQS'#Eq'#EqO7sQ`O,5;ZO7xQdO,5;ZOOQO'#Et'#EtO8QQ`O,5;^O8VQhO,5;dO'oQdO'#DjOOQS,5;f,5;fO0jQ`O,5;fO8_QdO,5;fOOQS'#Fc'#FcO8gQdO'#FPO7fQ`O,5;iO8oQdO,5:|O9PQdO'#F^O9^Q`O,5<iO9^Q`O,5<iPOOO'#FS'#FSP9iO&jO,58{POOO,58{,58{OOQP1G.m1G.mOOQP1G.q1G.qOOQP1G.t1G.tO,}Q`O1G.tO-SQ`O1G.tOOQP1G0X1G0XO9tQpO1G0ZO9|QaO1G0bO:dQaO1G0dO:zQaO1G0eO;bQaO,5;vOOQO-E9Y-E9YOOQS1G.i1G.iO;lQ`O,5:{O;qQdO'#EQO;xQdO'#CuOOQO'#EX'#EXOOQO,5:q,5:qO-dQdO,5:qOOQP1G0Z1G0ZO)YQdO1G0ZO<PQ!jO'#D^O<_Q!bO,59yO<gQhO,5:ROOQO'#Fx'#FxO<bQ!bO,59}O<oQhO'#FdO)}QhO,59{O)}QhO'#FdO=gQhO1G1WOOQS1G1W1G1WO=qQhO,5:PO>lQhO'#DoOOQW,5:Y,5:YOOQW,5:g,5:gOOQW,5:S,5:SO>vQhO,5:VO?bQ!fO'#FuOOQS'#Fu'#FuOOQS'#FV'#FVO@rQdO,59cOOQ[,59c,59cOAYQdO,59iOOQ[,59i,59iOApQdO,59lOOQ[,59l,59lOOQ[,59n,59nO)YQdO,59pOBWQhO'#EgOOQW'#Eg'#EgOBuQ`O1G0kO4oQhO1G0kOOQ[,59r,59rO)}QhO'#D[OOQ[,59t,59tOBzQ#tO,5:hOCVQhO'#F`OCdQ`O,5<lOOQS1G0q1G0qOOQS1G0s1G0sOOQS1G0u1G0uOCoQ`O1G0uOCtQdO'#EuOOQS1G0x1G0xOOQS1G1O1G1OODPQaO,5:UO7fQ`O1G1QOOQS1G1Q1G1QO0jQ`O1G1QOOQS-E9a-E9aOOQS1G1T1G1TODWQ!fO1G0hODnQ`O'#EdOOQO1G0h1G0hOOQO,5;x,5;xODsQdO,5;xOOQO-E9[-E9[OEQQ`O1G2TPOOO-E9Q-E9QPOOO1G.g1G.gOOQP7+$`7+$`OOQP7+%u7+%uO)YQdO7+%uOOQS1G0g1G0gOE]QaO'#F|OEgQ`O,5:lOElQ!fO'#FUOFjQdO'#FsOFtQ`O,59aOOQO1G0]1G0]OFyQ!bO7+%uO)YQdO1G/eOGUQhO1G/iOOQW1G/m1G/mOOQW1G/g1G/gOGgQhO,5<OOOQW-E9b-E9bOOQS7+&r7+&rOH_QhO'#D^OHmQhO'#F{OHxQ`O'#F{OH}Q`O,5:ZOISQ!bO'#D`O>vQhO'#DmOI_QhO'#DsOIgQhO'#DuOIlQ!jO'#FzOOQO'#Fz'#FzOIwQ`O'#DxOJPQ!bO'#DzOOQO'#Fy'#FyOJUQ`O1G/qOOQS-E9T-E9TOOQ[1G.}1G.}OOQ[1G/T1G/TOOQ[1G/W1G/WOOQ[1G/[1G/[OJZQdO,5;ROOQS7+&V7+&VOJ`Q`O7+&VOJeQhO'#D]OJmQ`O,59vO)}QhO,59vOOQ[1G0S1G0SOJuQ`O1G0SOJzQhO,5;zOOQO-E9^-E9^OOQS7+&a7+&aOKYQbO'#DSOOQO'#Ew'#EwOKhQ`O'#EvOOQO'#Ev'#EvOKsQ`O'#FaOK{QdO,5;aOOQS,5;a,5;aOOQ[1G/p1G/pOOQS7+&l7+&lO7fQ`O7+&lOLWQ!fO'#F]O)YQdO'#F]OM_QdO7+&SOOQO7+&S7+&SOOQO,5;O,5;OOOQO1G1d1G1dOMrQ!bO<<IaOM}QdO'#FZONXQ`O,5<hOOQP1G0W1G0WOOQS-E9S-E9SONaQdO'#FYONkQ`O,5<_OOQ]1G.{1G.{OOQP<<Ia<<IaONsQ`O<<IaONxQdO7+%POOQO'#D`'#D`O! PQ!bO7+%TO! XQhO'#FXO! fQ`O,5<gO)YQdO,5<gOOQW1G/u1G/uO! nQ`O,5:XO>vQhO'#DtOOQO,5:_,5:_O! sQhO,5:aO! {QhO,5:fO)YQdO,5:dOOQW7+%]7+%]OOQO'#Ei'#EiO!!SQ`O1G0mOOQS<<Iq<<IqO)YQdO,59wO!!vQhO1G/bOOQ[1G/b1G/bO!!}Q`O1G/bOOQW-E9U-E9UOOQ[7+%n7+%nOOQO,5;b,5;bOCwQdO'#FbOKsQ`O,5;{OOQS,5;{,5;{OOQS-E9_-E9_OOQS1G0{1G0{OOQS<<JW<<JWO!#VQ!fO,5;wOOQS-E9Z-E9ZOOQO<<In<<InOOQPAN>{AN>{O!$^Q`OAN>{O!$cQaO,5;uOOQO-E9X-E9XO!$mQdO,5;tOOQO-E9W-E9WOOQW<<Hk<<HkOOQW<<Ho<<HoO!$wQhO<<HoO!%YQhO'#D^O!%hQhO,5;sO!%sQ`O,5;sOOQO-E9V-E9VO!%xQdO1G2RO!&SQhO1G/sO!&[Q`O,5:`O>vQhO'#DwOOQO1G/{1G/{O!&aQ!bO1G0QO!&iQdO1G0OOJZQdO'#F_O!&pQ`O7+&XOOQW7+&X7+&XO!&xQ!bO1G/cOOQ[7+$|7+$|O!'TQhO7+$|P!'[Q`O'#FWOOQO,5;|,5;|OOQO-E9`-E9`OOQS1G1g1G1gOOQPG24gG24gO!'aQ`OAN>ZO)YQdO1G1_O!'fQ`O7+'mOOQO1G/z1G/zO!'nQ`O,5:cO!'sQhO7+%lOOQO,5;y,5;yOOQO-E9]-E9]OOQW<<Is<<IsOOQ[<<Hh<<HhPOQW,5;r,5;rOOQWG23uG23uO!'zQdO7+&yOOQO1G/}1G/}OOQO<<IW<<IW",
    stateData: "!(_~O$_OS$`QQ~OWVO^_O`WOcYOdYOl`OmZOp[O#P]O#S^O#YdO#`eO#bfO#dgO#ghO#miO#ojO#rkO$ZRO$fTO~OQmOWVO^_O`WOcYOdYOl`OmZOp[O#P]O#S^O#YdO#`eO#bfO#dgO#ghO#miO#ojO#rkO$ZlO$fTO~O$X$qP~P!jO$`qO~O`YXcYXdYXmYXpYXsYX!eYX#PYX#SYX$YYX$f[X~OgYX~P$ZO$ZsO~O$fuO~O$fuO`$eXc$eXd$eXm$eXp$eXs$eX!e$eX#P$eX#S$eX$Y$eXg$eX~O$ZvO~O`xOcyOdyOmzOp{O#P|O#S!OO$Y}O~Os!RO!e!PO~P&^Of!XO$Z!TO$[!UO~O$Z!YO~OW!^O$Z![O$f!]O~OWVO^_O`WOcYOdYOmZOp[O#P]O#S^O$ZRO$fTO~OS!fOc!gOd!gOh!cOs!RO!Y!eO!]!jO!`!kO$]!bO~On!iO~P(dOQ!uOh!nOp!oOs!pOu!xOw!xO}!vO!q!wO$Z!mO$[!sO$j!qO~OS!fOc!gOd!gOh!cO!Y!eO!]!jO!`!kO$]!bO~Os$tP~P)}Ow!}O!q!wO$Z!|O~Ow#PO$Z#PO~Oh#SOs!RO#p#UO~O$Z#WO~Oc#VX~P$ZOc#ZO~On#[O$X$qXr$qX~O$X$qXr$qX~P!jO$a#_O$b#_O$c#aO~Of#fO$Z!TO$[!UO~Os!RO!e!PO~Or$qP~P!jOh#pO~Oh#qO~Oo!xX!|!xX$f!zX~O$Z#rO~O$f#tO~Oo#uO!|#vO~O`xOcyOdyOmzOp{O~Os#Oa!e#Oa#P#Oa#S#Oa$Y#Oag#Oa~P-vOs#Ra!e#Ra#P#Ra#S#Ra$Y#Rag#Ra~P-vOS!fOc!gOd!gOh!cO!Y!eO!]!jO!`!kO~OR#zOu#zOw#zO$]#wO$j!qO~P/VOn$QO!U#}O!e$OO~P(dOh$SO~O$]$UO~Oh#SO~Oh$WO~O`$YOc$YOg$]Ol$YOm$YOn$YO~P)YO`$YOc$YOl$YOm$YOn$YOo$_O~P)YO`$YOc$YOl$YOm$YOn$YOr$aO~P)YOP$bOSvXcvXdvXhvXnvXyvX!YvX!]vX!`vX#[vX#^vX$]vX!WvXQvX`vXgvXlvXmvXpvXsvXuvXwvX}vX!qvX$ZvX$[vX$jvXovXrvX!evX$XvX$svX!}vX~Oy$cO#[$dO#^$eOn$tP~P)}Oh#qOS$hXc$hXd$hXn$hXy$hX!Y$hX!]$hX!`$hX#[$hX#^$hX$]$hXQ$hX`$hXg$hXl$hXm$hXp$hXs$hXu$hXw$hX}$hX!q$hX$Z$hX$[$hX$j$hXo$hXr$hX!e$hX$X$hX$s$hX!}$hX~Oh$iO~Oh$kO~O!U#}O!e$lOs$tXn$tX~Os!RO~On$oOy$cO~On$pO~Ow$qO!q!wO~Os$rO~Os!RO!U#}O~Os!RO#p$xO~O$Z#WOs#sX~O$s$|On#Ua$X#Uar#Ua~P)YOn$QX$X$QXr$QX~P!jOn#[O$X$qar$qa~O$a#_O$b#_O$c%TO~Oo%VO!|%WO~Os#Oi!e#Oi#P#Oi#S#Oi$Y#Oig#Oi~P-vOs#Qi!e#Qi#P#Qi#S#Qi$Y#Qig#Qi~P-vOs#Ri!e#Ri#P#Ri#S#Ri$Y#Rig#Ri~P-vOs$Oa!e$Oa~P&^Or%XO~Og$pP~P'oOg$gP~P)YOc!SXg!QX!U!QX!W!SX~Oc%aO!W%bO~Og%cO!U#}O~O!U#}OS$WXc$WXd$WXh$WXn$WXs$WX!Y$WX!]$WX!`$WX!e$WX$]$WX~On%gO!e$OO~P(dO!U#}OS!Xac!Xad!Xah!Xan!Xas!Xa!Y!Xa!]!Xa!`!Xa!e!Xa$]!Xag!Xa~O$]%hOg$oP~P/VOR#zOS!fOh%mOu#zOw#zO!Y%nO$]%lO$j!qO~Oy$cOQ$iX`$iXc$iXg$iXh$iXl$iXm$iXn$iXp$iXs$iXu$iXw$iX}$iX!q$iX$Z$iX$[$iX$j$iXo$iXr$iX~O`$YOc$YOg%wOl$YOm$YOn$YO~P)YO`$YOc$YOl$YOm$YOn$YOo%xO~P)YO`$YOc$YOl$YOm$YOn$YOr%yO~P)YOh%{OS#ZXc#ZXd#ZXn#ZX!Y#ZX!]#ZX!`#ZX$]#ZX~On%|O~Og&ROw&SO!r&SO~Os$SX!e$SXn$SX~P)}O!e$lOs$tan$ta~On&VO~Or&^O$Z&XO$j&WO~Og&_O~P&^Oy$cO!e&cO$s$|On#Ui$X#Uir#Ui~P)YO$r&fO~On$Qa$X$Qar$Qa~P!jOn#[O$X$qir$qi~O!e&iOg$pX~P&^Og&kO~Oy$cOQ#xXg#xXh#xXp#xXs#xXu#xXw#xX}#xX!e#xX!q#xX$Z#xX$[#xX$j#xX~O!e&mOg$gX~P)YOg&oO~Oo&pOy$cO!}&qO~OR#zOu#zOw#zO$]&sO$j!qO~O!U#}OS$Wac$Wad$Wah$Wan$Was$Wa!Y$Wa!]$Wa!`$Wa!e$Wa$]$Wa~Oc!dXg!QX!U!QX!e!QX~O!U#}O!e&uOg$oX~Oc&wO~Og&xO~Oc!mXg!mX!W!SX~OS!fOh&zO~O!U&|O~O!U&|O!W&}Og$nX~Oc'OOg!lX~O!W&}O~Og'PO~O$Z'QO~On'SO~Oc'TO!U#}O~Og'VOn'UO~Og'YO~O!U#}Os$Sa!e$San$Sa~OP$bOsvX!evXgvX~O$j&WOs#jX!e#jX~Os!RO!e'[O~Or'`O$Z&XO$j&WO~Oy$cOQ$PXh$PXn$PXp$PXs$PXu$PXw$PX}$PX!e$PX!q$PX$X$PX$Z$PX$[$PX$j$PX$s$PXr$PX~O!e&cO$s$|On#Uq$X#Uqr#Uq~P)YOo'eOy$cO!}'fO~Og#}X!e#}X~P'oO!e&iOg$pa~Og#|X!e#|X~P)YO!e&mOg$ga~Oo'eO~Og'kO~P)YOg'lO!W'mO~O$]'nOg#{X!e#{X~P/VO!e&uOg$oa~Og'sO~OS!fOh'uO~OS!fO~PGUO`'yOg'{O~OS#zac#zad#zah#za!Y#za!]#za!`#za$]#za~Og'}O~P!![Og'}On(OO~Oy$cOQ$Pah$Pan$Pap$Pas$Pau$Paw$Pa}$Pa!e$Pa!q$Pa$X$Pa$Z$Pa$[$Pa$j$Pa$s$Par$Pa~Oo(TO~Og#}a!e#}a~P&^Og#|a!e#|a~P)YOR#zOu#zOw#zO$]&sO$j&WO~Oc!fXg!QX!U!QX!e!QX~O!U#}Og#{a!e#{a~Oc(VO~O!e&uOg$oi~P)YOg!ai!U!ji~Og(XO~O!W(ZOg!ni~Og!li~P)YO`'yOg(^O~Oy$cOg!Pin!Pi~Og(_O~P!![On(`O~Og(aO~O!e&uOg$oq~Og(cO~OS!fO~P!$wOg#{q!e#{q~P)YO$_!r$`$j`$jy#S~",
    goto: "7g$uPPPPP$vP$yP%S%f%S%x&[P%SP&b%SPP&hPPP&n&x&xPPPPP&xPP&xP'hP&xP&x(k&xP)Z)^)d)d)v)dP)dP)dP)d)dP*])dP*i*o+e+hP+k*i+n*i+q+w+z,Q+z)d,WPP,|-S%S-Y%S-`-`-f-jPP%SP%S%SP-p.l.y/Q$yP/ZP/^P$yP$yP$yP/d$yP/g/j/m/t$yP$yPP$yP/y$yP/|0S0c0}1]1c1m1s1y2P2V2a2g2m2s2y3PPPPPPPPPPPP3V3`P4U4X5]P5e6_6t+z7Q7T7WPP7^RrQ_aOPco!R#[%Pq_OP]^co|}!O!P!R#S#[#p%P&iqSOP]^co|}!O!P!R#S#[#p%P&iqUOP]^co|}!O!P!R#S#[#p%P&iQtTR#buQwWR#cxQ!VYR#dyQ#d!XS$h!t!uR%U#f!Z!xdf!n!o!p#Z#q#v$[$^$`$c${%W%]%a&c&d&m&r&w'O'T'i'r'x(V(b!Y!xdf!n!o!p#Z#q#v$[$^$`$c${%W%]%a&c&d&m&r&w'O'T'i'r'x(V(bb#z!c$W%b%m&z&}'m'u(ZU&Z$r&]'[R'Z&Y!Z!tdf!n!o!p#Z#q#v$[$^$`$c${%W%]%a&c&d&m&r&w'O'T'i'r'x(V(bR$j!vQ&P$iR'W&Qq!h`ei!c!d!e!r#}$O$P$S$g$i$l&Q&uQ#x!cW%s$W%m&z'uQ&t%bQ'w&}Q(U'mR(d(ZQ#VjQ$V!jQ$v#UR&a$xX%q$W%m&z'up!h`ei!c!d!e!r#}$O$P$S$g$i$l&Q&uW%p$W%m&z'uQ&{%nQ'v&|Q'w&}R(d(ZR$T!fR%j$SR'p&uR&{%nX%o$W%m&z'uR'v&|X%t$W%m&z'uX%r$W%m&z'u!Y!xdf!n!o!p#Z#q#v$[$^$`$c${%W%]%a&c&d&m&r&w'O'T'i'r'x(V(bQ!}gR$q#OQ!WYR#eyQ#d!WR%U#eQ!ZZR#gzQ!_[R#h{T!^[{Q#s!]R%_#tQ!SXQ!i`Q#TjQ#n!QQ$Q!dQ$n!zQ$t#RQ$w#VQ$z#YQ%g$PQ&`$vQ'^&[Q'a&aR(S']SnP!RQ#^oQ%O#[R&g%PZmPo!R#[%PQ$}#ZQ&e${R'd&dR$g!rQ'R%{R(['yR#OgR#QhR$s#QS&[$r&]R(Q'[V&Y$r&]'[R#YkQ#`qR%S#`QcOSoP!RU!lco%PR%P#[Q%]#q[&l%]&r'i'r'x(bQ&r%aQ'i&mQ'r&wQ'x'OR(b(VQ$[!nQ$^!oQ$`!pV%v$[$^$`Q&Q$iR'X&QQ&v%iS'q&v(WR(W'rQ&n%]R'j&nQ&j%YR'h&jQ!QXR#m!QQ&d${R'c&dQ#]nS%Q#]%RR%R#^Q'z'RR(]'zQ$m!yR&U$mQ&]$rR'_&]Q']&[R(R']Q#XkR$y#XQ$P!dR%f$P_bOPco!R#[%P^XOPco!R#[%PQ!`]Q!a^Q#i|Q#j}Q#k!OQ#l!PQ$u#SQ%Y#pR'g&iR%^#qQ!rdQ!{f[$X!n!o!p$[$^$`Q${#Zh%[#q%]%a&m&r&w'O'i'r'x(V(bQ%`#vQ%z$cS&b${&dQ&h%WQ'b&cR'|'T]$Z!n!o!p$[$^$`Q!d`U!ye!r$gQ#RiQ#y!cS#|!d$PQ$R!eQ%d#}Q%e$OQ%i$SS&O$i&QQ&T$lR'o&uQ#{!cW%s$W%m&z'uQ&t%bQ'w&}Q(U'mR(d(ZQ%u$WQ&y%mQ't&zR(Y'uR%k$SR%Z#pQpPR#o!RQ!zeQ$f!rR%}$g",
    nodeNames: "\u26A0 Unit VariableName VariableName QueryCallee Comment StyleSheet RuleSet UniversalSelector TagSelector TagName NamespacedTagSelector NamespaceName TagName NestingSelector ClassSelector . ClassName PseudoClassSelector : :: PseudoClassName PseudoClassName ) ( ArgList ValueName ParenthesizedValue AtKeyword # ; ] [ BracketedValue } { BracedValue ColorLiteral NumberLiteral StringLiteral BinaryExpression BinOp CallExpression Callee IfExpression if ArgList IfBranch KeywordQuery FeatureQuery FeatureName BinaryQuery LogicOp ComparisonQuery CompareOp UnaryQuery UnaryQueryOp ParenthesizedQuery SelectorQuery selector ParenthesizedSelector StyleQuery style ParenthesedQuery CallQuery ArgList PropertyName , PropertyName UnaryQuery ParenthesedQuery BinaryQuery ParenthesedQuery ParenthesedQuery StyleFeature PropertyName StyleRange PseudoQuery CallLiteral CallTag ParenthesizedContent PseudoClassName ArgList IdSelector IdName AttributeSelector AttributeName NamespacedAttribute NamespaceName AttributeName MatchOp MatchFlag ChildSelector ChildOp DescendantSelector SiblingSelector SiblingOp Block Declaration PropertyName Important ImportStatement import Layer layer LayerName layer MediaStatement media CharsetStatement charset NamespaceStatement namespace NamespaceName KeyframesStatement keyframes KeyframeName KeyframeList KeyframeSelector KeyframeRangeName SupportsStatement supports ScopeStatement scope to FontFeatureStatement font-feature-values FontName AtRule Styles",
    maxTerm: 174,
    nodeProps: [
      ["isolate", -2, 5, 39, ""],
      ["openedBy", 23, "(", 31, "[", 34, "{"],
      ["closedBy", 24, ")", 32, "]", 35, "}"]
    ],
    propSources: [cssHighlighting],
    skippedNodes: [0, 5, 130],
    repeatNodeCount: 17,
    tokenData: "K`~R!bOX%ZX^&R^p%Zpq&Rqr)ers)vst+jtu2Xuv%Zvw3Rwx3dxy5Ryz5dz{5i{|6S|}:u}!O;W!O!P;u!P!Q<^!Q![=V![!]>Q!]!^>|!^!_?_!_!`@Z!`!a@n!a!b%Z!b!cAo!c!k%Z!k!lC|!l!u%Z!u!vC|!v!}%Z!}#OD_#O#P%Z#P#QDp#Q#R2X#R#]%Z#]#^ER#^#g%Z#g#hC|#h#o%Z#o#pIf#p#qIw#q#rJ`#r#sJq#s#y%Z#y#z&R#z$f%Z$f$g&R$g#BY%Z#BY#BZ&R#BZ$IS%Z$IS$I_&R$I_$I|%Z$I|$JO&R$JO$JT%Z$JT$JU&R$JU$KV%Z$KV$KW&R$KW&FU%Z&FU&FV&R&FV;'S%Z;'S;=`KY<%lO%Z`%^SOy%jz;'S%j;'S;=`%{<%lO%j`%oS!r`Oy%jz;'S%j;'S;=`%{<%lO%j`&OP;=`<%l%j~&Wh$_~OX%jX^'r^p%jpq'rqy%jz#y%j#y#z'r#z$f%j$f$g'r$g#BY%j#BY#BZ'r#BZ$IS%j$IS$I_'r$I_$I|%j$I|$JO'r$JO$JT%j$JT$JU'r$JU$KV%j$KV$KW'r$KW&FU%j&FU&FV'r&FV;'S%j;'S;=`%{<%lO%j~'yh$_~!r`OX%jX^'r^p%jpq'rqy%jz#y%j#y#z'r#z$f%j$f$g'r$g#BY%j#BY#BZ'r#BZ$IS%j$IS$I_'r$I_$I|%j$I|$JO'r$JO$JT%j$JT$JU'r$JU$KV%j$KV$KW'r$KW&FU%j&FU&FV'r&FV;'S%j;'S;=`%{<%lO%jj)jS$sYOy%jz;'S%j;'S;=`%{<%lO%j~)yWOY)vZr)vrs*cs#O)v#O#P*h#P;'S)v;'S;=`+d<%lO)v~*hOw~~*kRO;'S)v;'S;=`*t;=`O)v~*wXOY)vZr)vrs*cs#O)v#O#P*h#P;'S)v;'S;=`+d;=`<%l)v<%lO)v~+gP;=`<%l)vj+oYmYOy%jz!Q%j!Q![,_![!c%j!c!i,_!i#T%j#T#Z,_#Z;'S%j;'S;=`%{<%lO%jj,dY!r`Oy%jz!Q%j!Q![-S![!c%j!c!i-S!i#T%j#T#Z-S#Z;'S%j;'S;=`%{<%lO%jj-XY!r`Oy%jz!Q%j!Q![-w![!c%j!c!i-w!i#T%j#T#Z-w#Z;'S%j;'S;=`%{<%lO%jj.OYuY!r`Oy%jz!Q%j!Q![.n![!c%j!c!i.n!i#T%j#T#Z.n#Z;'S%j;'S;=`%{<%lO%jj.uYuY!r`Oy%jz!Q%j!Q![/e![!c%j!c!i/e!i#T%j#T#Z/e#Z;'S%j;'S;=`%{<%lO%jj/jY!r`Oy%jz!Q%j!Q![0Y![!c%j!c!i0Y!i#T%j#T#Z0Y#Z;'S%j;'S;=`%{<%lO%jj0aYuY!r`Oy%jz!Q%j!Q![1P![!c%j!c!i1P!i#T%j#T#Z1P#Z;'S%j;'S;=`%{<%lO%jj1UY!r`Oy%jz!Q%j!Q![1t![!c%j!c!i1t!i#T%j#T#Z1t#Z;'S%j;'S;=`%{<%lO%jj1{SuY!r`Oy%jz;'S%j;'S;=`%{<%lO%jd2[UOy%jz!_%j!_!`2n!`;'S%j;'S;=`%{<%lO%jd2uS!|S!r`Oy%jz;'S%j;'S;=`%{<%lO%jb3WS^QOy%jz;'S%j;'S;=`%{<%lO%j~3gWOY3dZw3dwx*cx#O3d#O#P4P#P;'S3d;'S;=`4{<%lO3d~4SRO;'S3d;'S;=`4];=`O3d~4`XOY3dZw3dwx*cx#O3d#O#P4P#P;'S3d;'S;=`4{;=`<%l3d<%lO3d~5OP;=`<%l3dj5WShYOy%jz;'S%j;'S;=`%{<%lO%j~5iOg~n5pUWQyWOy%jz!_%j!_!`2n!`;'S%j;'S;=`%{<%lO%jj6ZWyW#SQOy%jz!O%j!O!P6s!P!Q%j!Q![9x![;'S%j;'S;=`%{<%lO%jj6xU!r`Oy%jz!Q%j!Q![7[![;'S%j;'S;=`%{<%lO%jj7cY!r`$jYOy%jz!Q%j!Q![7[![!g%j!g!h8R!h#X%j#X#Y8R#Y;'S%j;'S;=`%{<%lO%jj8WY!r`Oy%jz{%j{|8v|}%j}!O8v!O!Q%j!Q![9_![;'S%j;'S;=`%{<%lO%jj8{U!r`Oy%jz!Q%j!Q![9_![;'S%j;'S;=`%{<%lO%jj9fU!r`$jYOy%jz!Q%j!Q![9_![;'S%j;'S;=`%{<%lO%jj:P[!r`$jYOy%jz!O%j!O!P7[!P!Q%j!Q![9x![!g%j!g!h8R!h#X%j#X#Y8R#Y;'S%j;'S;=`%{<%lO%jj:zS!eYOy%jz;'S%j;'S;=`%{<%lO%jj;]WyWOy%jz!O%j!O!P6s!P!Q%j!Q![9x![;'S%j;'S;=`%{<%lO%jj;zU`YOy%jz!Q%j!Q![7[![;'S%j;'S;=`%{<%lO%j~<cTyWOy%jz{<r{;'S%j;'S;=`%{<%lO%j~<yS!r`$`~Oy%jz;'S%j;'S;=`%{<%lO%jj=[[$jYOy%jz!O%j!O!P7[!P!Q%j!Q![9x![!g%j!g!h8R!h#X%j#X#Y8R#Y;'S%j;'S;=`%{<%lO%jj>VUcYOy%jz![%j![!]>i!];'S%j;'S;=`%{<%lO%jj>pSdY!r`Oy%jz;'S%j;'S;=`%{<%lO%jj?RSnYOy%jz;'S%j;'S;=`%{<%lO%jh?dU!WWOy%jz!_%j!_!`?v!`;'S%j;'S;=`%{<%lO%jh?}S!WW!r`Oy%jz;'S%j;'S;=`%{<%lO%jl@bS!WW!|SOy%jz;'S%j;'S;=`%{<%lO%jj@uV#PQ!WWOy%jz!_%j!_!`?v!`!aA[!a;'S%j;'S;=`%{<%lO%jbAcS#PQ!r`Oy%jz;'S%j;'S;=`%{<%lO%jjArYOy%jz}%j}!OBb!O!c%j!c!}CP!}#T%j#T#oCP#o;'S%j;'S;=`%{<%lO%jjBgW!r`Oy%jz!c%j!c!}CP!}#T%j#T#oCP#o;'S%j;'S;=`%{<%lO%jjCW[lY!r`Oy%jz}%j}!OCP!O!Q%j!Q![CP![!c%j!c!}CP!}#T%j#T#oCP#o;'S%j;'S;=`%{<%lO%jhDRS!}WOy%jz;'S%j;'S;=`%{<%lO%jjDdSpYOy%jz;'S%j;'S;=`%{<%lO%jnDuSo^Oy%jz;'S%j;'S;=`%{<%lO%jjEWU!}WOy%jz#a%j#a#bEj#b;'S%j;'S;=`%{<%lO%jbEoU!r`Oy%jz#d%j#d#eFR#e;'S%j;'S;=`%{<%lO%jbFWU!r`Oy%jz#c%j#c#dFj#d;'S%j;'S;=`%{<%lO%jbFoU!r`Oy%jz#f%j#f#gGR#g;'S%j;'S;=`%{<%lO%jbGWU!r`Oy%jz#h%j#h#iGj#i;'S%j;'S;=`%{<%lO%jbGoU!r`Oy%jz#T%j#T#UHR#U;'S%j;'S;=`%{<%lO%jbHWU!r`Oy%jz#b%j#b#cHj#c;'S%j;'S;=`%{<%lO%jbHoU!r`Oy%jz#h%j#h#iIR#i;'S%j;'S;=`%{<%lO%jbIYS$rQ!r`Oy%jz;'S%j;'S;=`%{<%lO%jjIkSsYOy%jz;'S%j;'S;=`%{<%lO%jfI|U$fUOy%jz!_%j!_!`2n!`;'S%j;'S;=`%{<%lO%jjJeSrYOy%jz;'S%j;'S;=`%{<%lO%jfJvU#SQOy%jz!_%j!_!`2n!`;'S%j;'S;=`%{<%lO%j`K]P;=`<%l%Z",
    tokenizers: [descendant, unitToken, identifiers, queryIdentifiers, 1, 2, 3, 4, new LocalTokenGroup("m~RRYZ[z{a~~g~aO$b~~dP!P!Qg~lO$c~~", 28, 155)],
    topRules: { "StyleSheet": [0, 6], "Styles": [1, 129] },
    dynamicPrecedences: { "97": 1 },
    specialized: [{ term: 150, get: (value) => spec_callee[value] || -1 }, { term: 151, get: (value) => spec_queryIdentifier[value] || -1 }, { term: 4, get: (value) => spec_QueryCallee[value] || -1 }, { term: 28, get: (value) => spec_AtKeyword[value] || -1 }, { term: 149, get: (value) => spec_identifier2[value] || -1 }],
    tokenPrec: 2444
  });

  // node_modules/@lezer/cpp/dist/index.js
  var RawString = 1;
  var templateArgsEndFallback = 2;
  var MacroName = 3;
  var R = 82;
  var L = 76;
  var u = 117;
  var U = 85;
  var a = 97;
  var z = 122;
  var A = 65;
  var Z = 90;
  var Underscore = 95;
  var Zero = 48;
  var Quote = 34;
  var ParenL = 40;
  var ParenR = 41;
  var Space = 32;
  var GreaterThan = 62;
  var rawString = new ExternalTokenizer((input) => {
    if (input.next == L || input.next == U) {
      input.advance();
    } else if (input.next == u) {
      input.advance();
      if (input.next == Zero + 8) input.advance();
    }
    if (input.next != R) return;
    input.advance();
    if (input.next != Quote) return;
    input.advance();
    let marker = "";
    while (input.next != ParenL) {
      if (input.next == Space || input.next <= 13 || input.next == ParenR) return;
      marker += String.fromCharCode(input.next);
      input.advance();
    }
    input.advance();
    for (; ; ) {
      if (input.next < 0)
        return input.acceptToken(RawString);
      if (input.next == ParenR) {
        let match = true;
        for (let i = 0; match && i < marker.length; i++)
          if (input.peek(i + 1) != marker.charCodeAt(i)) match = false;
        if (match && input.peek(marker.length + 1) == Quote)
          return input.acceptToken(RawString, 2 + marker.length);
      }
      input.advance();
    }
  });
  var fallback = new ExternalTokenizer((input) => {
    if (input.next == GreaterThan) {
      if (input.peek(1) == GreaterThan)
        input.acceptToken(templateArgsEndFallback, 1);
    } else {
      let sawLetter = false, i = 0;
      for (; ; i++) {
        if (input.next >= A && input.next <= Z) sawLetter = true;
        else if (input.next >= a && input.next <= z) return;
        else if (input.next != Underscore && !(input.next >= Zero && input.next <= Zero + 9)) break;
        input.advance();
      }
      if (sawLetter && i > 1) input.acceptToken(MacroName);
    }
  }, { extend: true });
  var cppHighlighting = styleTags({
    "typedef struct union enum class typename decltype auto template operator friend noexcept namespace using requires concept import export module __attribute__ __declspec __based": tags.definitionKeyword,
    "extern MsCallModifier MsPointerModifier extern static register thread_local inline const volatile restrict _Atomic mutable constexpr constinit consteval virtual explicit VirtualSpecifier Access": tags.modifier,
    "if else switch for while do case default return break continue goto throw try catch": tags.controlKeyword,
    "co_return co_yield co_await": tags.controlKeyword,
    "new sizeof delete static_assert": tags.operatorKeyword,
    "NULL nullptr": tags.null,
    this: tags.self,
    "True False": tags.bool,
    "TypeSize PrimitiveType": tags.standard(tags.typeName),
    TypeIdentifier: tags.typeName,
    FieldIdentifier: tags.propertyName,
    "CallExpression/FieldExpression/FieldIdentifier": tags.function(tags.propertyName),
    "ModuleName/Identifier": tags.namespace,
    "PartitionName": tags.labelName,
    StatementIdentifier: tags.labelName,
    "Identifier DestructorName": tags.variableName,
    "CallExpression/Identifier": tags.function(tags.variableName),
    "CallExpression/ScopedIdentifier/Identifier": tags.function(tags.variableName),
    "FunctionDeclarator/Identifier FunctionDeclarator/DestructorName": tags.function(tags.definition(tags.variableName)),
    NamespaceIdentifier: tags.namespace,
    OperatorName: tags.operator,
    ArithOp: tags.arithmeticOperator,
    LogicOp: tags.logicOperator,
    BitOp: tags.bitwiseOperator,
    CompareOp: tags.compareOperator,
    AssignOp: tags.definitionOperator,
    UpdateOp: tags.updateOperator,
    LineComment: tags.lineComment,
    BlockComment: tags.blockComment,
    Number: tags.number,
    String: tags.string,
    "RawString SystemLibString": tags.special(tags.string),
    CharLiteral: tags.character,
    EscapeSequence: tags.escape,
    "UserDefinedLiteral/Identifier": tags.literal,
    PreprocArg: tags.meta,
    "PreprocDirectiveName #include #ifdef #ifndef #if #define #else #endif #elif": tags.processingInstruction,
    MacroName: tags.special(tags.name),
    "( )": tags.paren,
    "[ ]": tags.squareBracket,
    "{ }": tags.brace,
    "< >": tags.angleBracket,
    ". ->": tags.derefOperator,
    ", ;": tags.separator
  });
  var spec_identifier3 = { __proto__: null, bool: 36, char: 36, int: 36, float: 36, double: 36, void: 36, size_t: 36, ssize_t: 36, intptr_t: 36, uintptr_t: 36, charptr_t: 36, int8_t: 36, int16_t: 36, int32_t: 36, int64_t: 36, uint8_t: 36, uint16_t: 36, uint32_t: 36, uint64_t: 36, char8_t: 36, char16_t: 36, char32_t: 36, char64_t: 36, const: 70, volatile: 72, restrict: 74, _Atomic: 76, mutable: 78, constexpr: 80, constinit: 82, consteval: 84, struct: 88, __declspec: 92, final: 148, override: 148, public: 152, private: 152, protected: 152, virtual: 154, extern: 160, static: 162, register: 164, inline: 166, thread_local: 168, __attribute__: 172, __based: 178, __restrict: 180, __uptr: 180, __sptr: 180, _unaligned: 180, __unaligned: 180, noexcept: 194, requires: 198, TRUE: 798, true: 798, FALSE: 800, false: 800, typename: 218, class: 220, template: 234, throw: 248, __cdecl: 256, __clrcall: 256, __stdcall: 256, __fastcall: 256, __thiscall: 256, __vectorcall: 256, try: 260, catch: 264, export: 282, import: 286, case: 296, default: 298, if: 308, else: 314, switch: 318, do: 322, while: 324, for: 330, return: 334, break: 338, continue: 342, goto: 346, co_return: 350, co_yield: 354, using: 362, typedef: 366, namespace: 380, new: 398, delete: 400, co_await: 402, concept: 406, enum: 410, static_assert: 414, friend: 422, union: 424, explicit: 430, operator: 444, module: 456, signed: 518, unsigned: 518, long: 518, short: 518, decltype: 528, auto: 530, sizeof: 566, NULL: 572, nullptr: 586, this: 588 };
  var spec_ = { __proto__: null, "<": 767 };
  var spec_templateArgsEnd = { __proto__: null, ">": 135 };
  var spec_scopedIdentifier = { __proto__: null, operator: 388, new: 576, delete: 582 };
  var parser4 = LRParser.deserialize({
    version: 14,
    states: "$<[Q!QQVOOP'gOUOOO([OWO'#CdO,UQUO'#CgO,`QUO'#FjO-vQbO'#CxO.XQUO'#CxO0WQUO'#KaO0_QUO'#CwO0jOpO'#DvO0rQ!dO'#D]OOQR'#JP'#JPO5[QVO'#GUO5iQUO'#JWOOQQ'#JW'#JWO8}QUO'#KtO<hQUO'#KtO?OQVO'#E^O?`QUO'#E^OOQQ'#Ed'#EdOOQQ'#Ee'#EeO?eQVO'#EfO@[QVO'#EiOBXQUO'#FPOByQUO'#FhOOQR'#Fj'#FjOCOQUO'#FjOOQR'#LX'#LXOOQR'#LW'#LWOEWQVO'#KWOF{QUO'#L_OGYQUO'#KxOGnQUO'#L_OH`QUO'#LaOOQR'#HU'#HUOOQR'#HV'#HVOOQR'#HW'#HWOOQR'#LT'#LTOOQR'#J`'#J`Q!QQVOOOHnQVO'#FOOIZQUO'#EhOIbQUOOOK^QVO'#HgOKnQUO'#HgONYQUO'#KxONdQUO'#KxOOQQ'#Kx'#KxO!!bQUO'#KxOOQQ'#Js'#JsO!!oQUO'#HxOOQQ'#Ka'#KaO!&aQUO'#KaO!&}QUO'#KWO!(}QVO'#I]O!(}QVO'#I`OCTQUO'#KWOOQQ'#Ip'#IpOOQQ'#KW'#KWO!-QQUO'#KaOOQR'#K`'#K`O!-XQUO'#DZO!/pQUO'#KuOOQQ'#Ku'#KuO!/wQUO'#KuO!0OQUO'#ETO!0TQUO'#EWO!0YQUO'#FRO8}QUO'#FPO!QQVO'#F^O!0_Q#vO'#F`O!0jQUO'#FkO!0rQUO'#FpO!0wQVO'#FrO!0rQUO'#FuO!3vQUO'#FvO!3{QVO'#FxO!4VQUO'#FzO!4[QUO'#F|O!4aQUO'#GOO!4fQVO'#GQO!(}QVO'#GSO!4mQUO'#GpO!4{QUO'#GYO!(}QVO'#FeO!6YQUO'#FeO!6_QVO'#G`O!6fQUO'#GaO!6qQUO'#GnO!6vQUO'#GrO!6{QUO'#GzO!7mQ&lO'#HiO!:pQUO'#GuO!;QQUO'#HXO!;]QUO'#HZO!;eQUO'#DXO!;eQUO'#HuO!;eQUO'#HvO!;|QUO'#HwO!<_QUO'#H|O!=SQUO'#H}O!>xQVO'#IbO!(}QVO'#IdO!?SQUO'#IgO!?ZQVO'#IjP!AQO!LQO'#CaP!A]{,UO'#CbP!6q{,UO'#CbP!Ah{7[O'#CbP!6q{,UO'#CbP!Am{,UO'#CbP!AxOSO'#IzPOOO)CEp)CEpOOOO'#I}'#I}O!BSOWO,59OOOQR,59O,59OO!(}QVO,59VOOQQ,59X,59XOOQR'#Do'#DoO!(}QVO,5;ROOQR,5<U,5<UO!B_QUO,59ZO!(}QVO,5>qOOQR'#IX'#IXOOQR'#IY'#IYOOQR'#IZ'#IZOOQR'#I['#I[O!(}QVO,5>rO!(}QVO,5>rO!(}QVO,5>rO!(}QVO,5>rO!(}QVO,5>rO!(}QVO,5>rO!(}QVO,5>rO!(}QVO,5>rO!(}QVO,5>rO!(}QVO,5>rO!D^QVO,5>zOOQQ,5?W,5?WO!FPQVO'#CjO!IxQUO'#CzOOQQ,59d,59dOOQQ,59c,59cOOQQ,5<},5<}O!JVQ&lO,5=mO!?SQUO,5?RO!LyQVO,5?UO!MQQbO,59dO!M]QVO'#FYOOQQ,5?P,5?PO!MmQVO,59WO!MtO`O,5:bO!MyQbO'#D^O!N[QbO'#KeO!NjQbO,59wO!NrQbO'#CxO# TQUO'#CxO# YQUO'#KaO# dQUO'#CwOOQR-E<}-E<}O# oQUO,5AvO# vQVO'#EfO@[QVO'#EiOBXQUO,5;kOOQR,5<p,5<pO#$oQUO'#KWO#$vQUO'#KWO!(}QVO'#IUO8}QUO,5;kO#%ZQ&lO'#HiO#(bQUO'#CtO#+VQbO'#CxO#+[QUO'#CwO#.xQUO'#KaOOQQ-E=U-E=UO#1]QUO,5A`O#1gQUO'#KaO#1qQUO,5A`OOQR,5Av,5AvOOQQ,5>l,5>lO#3uQUO'#CgO#4kQUO,5>pO#6^QUO'#IeOOQR'#JO'#JOO#6fQUO,5:xO#7SQUO,5:xO#7sQUO,5:xO#8hQUO'#CuO!0TQUO'#CmOOQQ'#JX'#JXO#7SQUO,5:xO#8pQUO,5;QO!4{QUO'#DOO#9yQUO,5;QO#:OQUO,5>QO#;[QUO'#DOO#;rQUO,5>{O#;wQUO'#LOO#=QQUO,5;TO#=YQVO,5;TO#=dQUO,5;TOOQQ,5;T,5;TO#?]QUO'#LdO#?dQUO,5>UO#?iQbO'#CxO#?tQUO'#GcO#?yQUO'#E^O#@jQUO,5;kO#ARQUO'#LUO#AZQUO,5;rOKnQUO'#HfOBXQUO'#HgO#A`QUO'#KxO!6qQUO'#HjO#BWQUO'#CuO!0wQVO,5<SOOQQ'#Cg'#CgOOQR'#Jj'#JjO#B]QVO,5=`OOQQ,5?Z,5?ZO#DfQbO'#CxO#DqQUO'#GcOOQQ'#Jk'#JkOOQQ-E=i-E=iOGYQUO,5AyOGnQUO,5AyO#DvQUO,5A{O#ERQUO'#G|OOQR,5Ay,5AyO#DvQUO,5AyO#E^QUO'#HOO#EfQUO,5A{OOQR,5A{,5A{OOQR,5A|,5A|O#EtQVO,5A|OOQR-E=^-E=^O#GnQVO,5;jOOQR,5;j,5;jO#IoQUO'#EjO#JtQUO'#EwO#KkQVO'#ExO#M}QUO'#EvO#NVQUO'#EyO$ UQUO'#EzOOQQ'#LR'#LRO$ {QUO,5;SO$#RQUO'#EvOOQQ,5;S,5;SO$$OQUO,5;SO$%qQUO,5:yO$([QVO,5>PO$(fQUO'#E[O$(sQUO,5>ROOQQ,5>S,5>SO$,aQVO'#C|OOQQ-E=q-E=qOOQQ,5>d,5>dOOQQ,59a,59aO$,kQUO,5>wO$.kQUO,5>zO!6qQUO,59uO$/OQUO,5;qO$/]QUO,5<{O!0TQUO,5:oOOQQ,5:r,5:rO$/hQUO,5;mO$/mQUO'#KtOBXQUO,5;kOOQR,5;x,5;xO$0^QUO'#FbO$0lQUO'#FbO$0qQUO,5;zO$4[QVO'#FmO!0wQVO,5<VO!0rQUO,5<VO!0YQUO,5<[O$4cQVO'#GUO$7_QUO,5<^O!0wQVO,5<aO$:uQVO,5<bO$;SQUO,5<dOOQR,5<d,5<dO$<]QUO,5<dOOQR,5<f,5<fOOQR,5<h,5<hOOQQ'#Fi'#FiO$<bQUO,5<jO$<gQUO,5<lOOQR,5<l,5<lO$=mQUO,5<nO$>sQUO'#L^O$>{QUO,5<rO$?WQUO,5=[O$?]QUO,5=[O!4{QUO,5<tO$?eQUO,5<tO$?yQUO,5<PO$APQVO,5<PO$CbQUO,5<zOOQR,5<z,5<zOOQR,5<{,5<{O$?]QUO,5<{O$DhQUO,5<{O$DsQUO,5=YO!(}QVO,5=^O!(}QVO,5=fO#NsQUO,5=mOOQQ,5>T,5>TO$FxQUO,5>TO$GSQUO,5>TO$GXQUO,5>TO$G^QUO,5>TO!6qQUO,5>TO$I[QUO'#KaO$IcQUO,5=oO$InQUO,5=aOKnQUO,5=oO$JhQUO,5=sOOQR,5=s,5=sO$JpQUO,5=sO$L{QVO'#H[OOQQ,5=u,5=uO!;`QUO,5=uO%#vQUO'#KqO%#}QUO'#KbO%$cQUO'#KqO%$mQUO'#DyO%%OQUO'#D|O%'{QUO'#KbOOQQ'#Kb'#KbO%)nQUO'#KbO%#}QUO'#KbO%)sQUO'#KbOOQQ,59s,59sOOQQ,5>a,5>aOOQQ,5>b,5>bO%){QUO'#HzO%*TQUO,5>cOOQQ,5>c,5>cO%-oQUO,5>cO%-zQUO,5>hO%1fQVO,5>iO%1mQUO,5>|O# vQVO'#EfO%4sQUO,5>|OOQQ,5>|,5>|O%5dQUO,5?OO%7hQUO,5?RO!<_QUO,5?RO%9dQUO,5?UO%=PQVO,5?UPOOO'#I|'#I|P%=WO!LQO,58{POOO,58{,58{P!Am{,UO,58|P%=c{,UO,58|P%=q{7[O,58|PO{O'#Jw'#JwP%>S{,UO'#LkPOOO'#Lk'#LkP%>Y{,UO'#LkPOOO,58|,58|POOO,5?f,5?fP%>_OSO,5?fOOOO-E<{-E<{OOQR1G.j1G.jO%>fQUO1G.qO%?lQUO1G0mOOQQ1G0m1G0mO%@xQUO'#CpO%CXQbO'#CxO%CdQUO'#CsO%CiQUO'#CsO%CnQUO1G.uO#BWQUO'#CrOOQQ1G.u1G.uO%EqQUO1G4]O%FwQUO1G4^O%HjQUO1G4^O%J]QUO1G4^O%LOQUO1G4^O%MqQUO1G4^O& dQUO1G4^O&#VQUO1G4^O&$xQUO1G4^O&&kQUO1G4^O&(^QUO1G4^O&*PQUO1G4^O&+rQUO'#KVO&,{QUO'#KVO&-TQUO,59UOOQQ,5=P,5=PO&/]QUO,5=PO&/gQUO,5=PO&/lQUO,5=PO&/qQUO,5=PO!6qQUO,5=PO#NsQUO1G3XO&/{QUO1G4mO!<_QUO1G4mO&1wQUO1G4pO&3jQVO1G4pOOQQ1G/O1G/OOOQQ1G.}1G.}OOQQ1G2i1G2iO!JVQ&lO1G3XO&3qQUO'#LVO@[QVO'#EiO&4zQUO'#F]OOQQ'#Jb'#JbO&5PQUO'#FZO&5[QUO'#LVO&5dQUO,5;tO&5iQUO1G.rOOQQ1G.r1G.rOOQR1G/|1G/|O&7[Q!dO'#JQO&7aQbO,59xO&9rQ!eO'#D`O&9yQ!dO'#JSO&:OQbO,5APO&:OQbO,5APOOQR1G/c1G/cO&:ZQbO1G/cO&:`Q&lO'#GeO&;^QbO,59dOOQR1G7b1G7bO#@jQUO1G1VO&;iQUO1G1^OBXQUO1G1VO&=zQUO'#CzO#+VQbO,59dO&AmQUO1G6zOOQR-E<|-E<|O&CPQUO1G0dO#6fQUO1G0dOOQQ-E=V-E=VO#7SQUO1G0dOOQQ1G0l1G0lO&CtQUO,59jOOQQ1G3l1G3lO&D[QUO,59jO&DrQUO,59jO!MmQVO1G4gO!(}QVO'#JZO&E^QUO,5AjOOQQ1G0o1G0oO!(}QVO1G0oO!6qQUO'#JpO&EfQUO,5BOOOQQ1G3p1G3pOOQR1G1V1G1VO&IcQVO'#FOO!MmQVO,5;sOOQQ,5;s,5;sOBXQUO'#JdO&K_QUO,5ApO&KgQVO'#E[OOQR1G1^1G1^O&NUQUO'#LdOOQR1G1n1G1nOOQR-E=h-E=hOOQR1G7e1G7eO#DvQUO1G7eOGYQUO1G7eO#DvQUO1G7gOOQR1G7g1G7gO&N^QUO'#G}O&NfQUO'#L`OOQQ,5=h,5=hO&NtQUO,5=jO&NyQUO,5=kOOQR1G7h1G7hO#EtQVO1G7hO' OQUO1G7hO'!UQVO,5=kOOQR1G1U1G1UO$/UQUO'#E]O'!zQUO'#E]OOQQ'#LQ'#LQO'#eQUO'#LPO'#pQUO,5;UO'#xQUO'#ElO'$]QUO'#ElO'$pQUO'#EtOOQQ'#J]'#J]O'$uQUO,5;cO'%lQUO,5;cO'&gQUO,5;dO''mQVO,5;dOOQQ,5;d,5;dO''wQVO,5;dO''mQVO,5;dO'(OQUO,5;bO'({QUO,5;eO')WQUO'#KwO')`QUO,5:vO')eQUO,5;fOOQQ1G0n1G0nOOQQ'#J^'#J^O'(OQUO,5;bO!4{QUO'#E}OOQQ,5;b,5;bO'*`QUO'#E`O',YQUO'#E{OHuQUO1G0nO',_QUO'#EbOOQQ'#JY'#JYO'-wQUO'#KyOOQQ'#Ky'#KyO'.qQUO1G0eO'/iQUO1G3kO'0oQVO1G3kOOQQ1G3k1G3kO'0yQVO1G3kO'1QQUO'#LgO'2^QUO'#K_O'2lQUO'#K^O'2wQUO,59hO'3PQUO1G/aO'3UQUO'#FPOOQR1G1]1G1]OOQR1G2g1G2gO$?]QUO1G2gO'3`QUO1G2gO'3kQUO1G0ZOOQR'#Ja'#JaO'3pQVO1G1XO'9iQUO'#FTO'9nQUO1G1VO!6qQUO'#JeO'9|QUO,5;|O$0lQUO,5;|OOQQ'#Fc'#FcOOQQ,5;|,5;|O':[QUO1G1fOOQR1G1f1G1fO':dQUO,5<XO$/UQUO'#FWOBXQUO'#FWO':kQUO,5<XO!(}QVO,5<XO':sQUO,5<XO':xQVO1G1qO!0wQVO1G1qOOQR1G1v1G1vO'@hQUO1G1xOOQR1G1{1G1{O'@mQUO1G1|OBXQUO1G2]O'AvQVO1G1|O'D[QUO1G1|O'DaQUO'#GWO8}QUO1G2]OOQR1G2O1G2OOOQR1G2U1G2UOOQR1G2W1G2WOOQR1G2Y1G2YO$?]QUO'#JiO'DfQUO,5AxO'DnQUO1G2^O!4{QUO1G2^OOQR1G2v1G2vO'DvQUO1G2vO$?eQUO1G2`OOQQ'#Cv'#CvO'D{QUO'#G[O'EvQUO'#G[O'E{QUO'#LYO'FZQUO'#G_OOQQ'#LZ'#LZO'FiQUO1G2`O'FnQVO1G1kO'IPQVO'#GUOBXQUO'#FWOOQR'#Jf'#JfO'FnQVO1G1kO'IZQUO'#FvOOQR1G2f1G2fO'I`QUO1G2gO'IeQUO'#JhO'3`QUO1G2gO!(}QVO1G2tO'ImQUO1G2xO'JvQUO1G3QO'K|QUO1G3XOOQQ1G3o1G3oO'LbQUO1G3oOOQR1G3Z1G3ZO'LgQUO'#KaO'3UQUO'#L[OGnQUO'#L_OOQR'#Gy'#GyO#DvQUO'#LaOOQR'#HQ'#HQO'LqQUO'#GvO'$pQUO'#GuOOQR1G2{1G2{O'MnQUO1G2{O'NeQUO1G3ZO'NpQUO1G3_O'NuQUO1G3_OOQR1G3_1G3_O'N}QUO'#H]OOQR'#H]'#H]O(!WQUO'#H]O!(}QVO'#H`O!(}QVO'#H_OOQR'#Lc'#LcO(!]QUO'#LcOOQR'#Jm'#JmO(!bQVO,5=vOOQQ,5=v,5=vO(!iQUO'#H^O(!qQUO'#HZOOQQ1G3a1G3aO(!{QUO,5@|OOQQ,5@|,5@|O%)nQUO,5@|O%)sQUO,5@|O%$mQUO,5:eO(&jQUO'#KrO(&xQUO'#KrOOQQ,5:e,5:eOOQQ'#JT'#JTO('TQUO'#D}O('_QUO'#KxOGnQUO'#L_O((ZQUO'#D}OOQQ'#Hp'#HpOOQQ'#Hr'#HrOOQQ'#Hs'#HsOOQQ'#Ks'#KsOOQQ'#JV'#JVO((eQUO,5:hOOQQ,5:h,5:hO()bQUO'#L_O()oQUO'#HtO(*VQUO,5@|O(*^QUO'#H{O(*iQUO'#LfO(*qQUO,5>fO(*vQUO'#LeOOQQ1G3}1G3}O(.mQUO1G3}O(.tQUO1G3}O(.{QUO1G4TO(0RQUO1G4TO(0WQUO,5BUO!6qQUO1G4hO!(}QVO'#IiOOQQ1G4m1G4mO(0]QUO1G4mO(2`QVO1G4pPOOO-E<z-E<zPOOO1G.g1G.gPOOO1G.h1G.hP!Am{,UO1G.hP(4`QUO'#LmP(4k{7[O1G.hPO{O-E=u-E=uPOOO,5BV,5BVP(4y{,UO,5BVPOOO1G5Q1G5QO!(}QVO7+$]O(5OQUO'#CzOOQQ,59_,59_O(5ZQbO,59dO(5fQbO,59_OOQQ,59^,59^OOQQ7+)w7+)wO!MmQVO'#JvO(5qQUO,5@qOOQQ1G.p1G.pOOQQ1G2k1G2kO(5yQUO1G2kO(6OQUO7+(sOOQQ7+*X7+*XO(8dQUO7+*XO(8kQUO7+*XO(2`QVO7+*[O#NsQUO7+(sO(8xQVO'#JcO(9]QUO,5AqO(9eQUO,5;vOOQQ'#Cp'#CpOOQQ,5;w,5;wO!(}QVO'#F[OOQQ-E=`-E=`O!MmQVO,5;uOOQQ1G1`1G1`OOQQ,5?l,5?lOOQQ-E=O-E=OOOQR'#Dg'#DgOOQR'#Di'#DiOOQR'#Dl'#DlO(:nQ!eO'#KfO(:uQMkO'#KfO(:|Q!eO'#KfOOQR'#Kf'#KfOOQR'#JR'#JRO(;TQ!eO,59zOOQQ,59z,59zO(;[QbO,5?nOOQQ-E=Q-E=QO(;jQbO1G6kOOQR7+$}7+$}OOQR7+&q7+&qOOQR7+&x7+&xO'9nQUO7+&qO(;uQUO7+&OO#6fQUO7+&OO(<jQUO1G/UO(=QQUO1G/UO(=lQUO7+*ROOQQ7+*V7+*VO(?_QUO,5?uOOQQ-E=X-E=XO(@hQUO7+&ZOOQQ,5@[,5@[OOQQ-E=n-E=nO(@mQUO'#LVO@[QVO'#EiO(AyQUO1G1_OOQQ1G1_1G1_O(CSQUO,5@OOOQQ,5@O,5@OOOQQ-E=b-E=bO(ChQUO'#KwOOQR7+-P7+-PO#DvQUO7+-POOQR7+-R7+-RO(CuQUO,5=iO#ERQUO'#JlO(DWQUO,5AzOOQR1G3U1G3UOOQR1G3V1G3VO(DfQUO7+-SOOQR7+-S7+-SO(F^QUO,5:wO(G{QUO'#EwO!(}QVO,5;VO(HnQUO,5:wO(HxQUO'#EpO(IZQUO'#EzOOQQ,5;Z,5;ZO#KkQVO'#ExO(IqQUO,5:wO(IxQUO'#EyO#GuQUO'#J[O(KbQUO,5AkOOQQ1G0p1G0pO(KmQUO,5;WO!<_QUO,5;^O(LWQUO,5;_O(LfQUO,5;WO(NxQUO,5;`OOQQ-E=Z-E=ZO) QQUO1G0}OOQQ1G1O1G1OO) {QUO1G1OO)#RQVO1G1OO)#YQVO1G1OO)#dQUO1G0|OOQQ1G0|1G0|OOQQ1G1P1G1PO)$aQUO'#JqO)$kQUO,5AcOOQQ1G0b1G0bOOQQ-E=[-E=[O)$sQUO,5;iO!<_QUO,5;iO)%pQVO,5:zO)%wQUO,5;gO$ {QUO7+&YOOQQ7+&Y7+&YO!(}QVO'#EfO)&OQUO,5:|OOQQ'#Kz'#KzOOQQ-E=W-E=WOOQQ,5Ae,5AeOOQQ'#Jn'#JnO))sQUO7+&PPOQQ7+&P7+&POOQQ7+)V7+)VO)*kQUO7+)VO)+qQVO7+)VOOQQ,5>m,5>mO$)hQVO'#JuO)+xQUO,5@xOOQQ1G/S1G/SOOQQ7+${7+${O),TQUO7+(RO),YQUO7+(ROOQR7+(R7+(RO$?]QUO7+(ROOQQ7+%u7+%uOOQR-E=_-E=_O!0YQUO,5;oOOQQ,5@P,5@POOQQ-E=c-E=cO$0lQUO1G1hOOQQ1G1h1G1hOOQR7+'Q7+'QOOQR1G1s1G1sOBXQUO,5;rO),vQUO,5<YO),}QUO1G1sO).WQUO1G1sO!0wQVO7+']O).]QVO7+']O)3{QUO7+'dO)4QQVO7+'hO)6fQUO7+'wO)6pQUO7+'hO)7vQVO7+'hOKnQUO7+'wO$?OQUO,5<rOOQQ,5@T,5@TOOQQ-E=g-E=gO!4{QUO7+'xO)7}QUO7+'xOOQR7+(b7+(bO)8SQUO7+'zO)8XQUO,5<vO'D{QUO,5<vO)9PQUO,5<vO'D{QUO,5<vOOQQ,5<w,5<wO)9bQVO,5<xO'FZQUO'#JgO)9lQUO,5AtO)9tQUO,5<yOOQR7+'z7+'zO):PQVO7+'VO)6iQUO'#LUOOQR-E=d-E=dO)<bQVO,5<bOOQQ,5@S,5@SO!6qQUO,5@SOOQQ-E=f-E=fO)>yQUO7+(`O)@PQUO7+(dO)@UQVO7+(dOOQQ7+(l7+(lOOQQ7+)Z7+)ZO)@^QUO'#KqO)@hQUO'#KqOOQR,5=b,5=bO)@uQUO,5=bO!;eQUO,5=bO!;eQUO,5=bO!;eQUO,5=bOOQR7+(g7+(gOOQR7+(u7+(uOOQR7+(y7+(yOOQR,5=w,5=wO)@zQUO,5=zO)BQQUO,5=yOOQR,5A},5A}OOQR-E=k-E=kOOQQ1G3b1G3bO)CWQUO,5=xO)C]QVO'#EfOOQQ1G6h1G6hO%)nQUO1G6hO%)sQUO1G6hOOQQ1G0P1G0POOQQ-E=R-E=RO)EtQUO,5A^O(&jQUO'#JUO)FPQUO,5A^O)FPQUO,5A^O)FXQUO,5:iO8}QUO,5:iOOQQ,5>],5>]O)FcQUO,5AyO)FjQUO'#EVO)GtQUO'#EVO)H_QUO,5:iO)HiQUO'#HlO)HiQUO'#HmOOQQ'#Kv'#KvO)IWQUO'#KvO!(}QVO'#HnOOQQ,5:i,5:iO)IxQUO,5:iO!MmQVO,5:iOOQQ-E=T-E=TOOQQ1G0S1G0SOOQQ,5>`,5>`O)I}QUO1G6hO!(}QVO,5>gO)MlQUO'#JtO)MwQUO,5BQOOQQ1G4Q1G4QO)NPQUO,5BPOOQQ,5BP,5BPOOQQ7+)i7+)iO*#nQUO7+)iOOQQ7+)o7+)oO*(mQVO1G7pO**oQUO7+*SO**tQUO,5?TO*+zQUO7+*[POOO7+$S7+$SP*-mQUO'#LnP*-uQUO,5BXP!Am{,UO7+$SPOOO1G7q1G7qO*-zQUO<<GwOOQQ1G.y1G.yOOQQ'#IT'#ITO*/mQUO,5@bOOQQ,5@b,5@bOOQQ-E=t-E=tOOQQ7+(V7+(VOOQQ<<Ms<<MsO*0vQUO<<MsO*2yQUO<<MvO*4lQUO<<L_O*5QQUO,5?}OOQQ,5?},5?}OOQQ-E=a-E=aOOQQ1G1b1G1bO*6ZQUO,5;vO*7aQUO1G1aOOQQ1G1a1G1aOOQR,5AQ,5AQO*8jQ!eO,5AQO*8qQMkO,5AQO*8xQ!eO,5AQOOQR-E=P-E=POOQQ1G/f1G/fO*9PQ!eO'#DwOOQQ1G5Y1G5YOOQR<<J]<<J]O*9WQUO<<IjO*9{QUO7+$pOOQQ<<Iu<<IuO(8xQVO,5;ROOQR<=!k<=!kOOQQ1G3T1G3TOOQQ,5@W,5@WOOQQ-E=j-E=jOOQR<=!n<=!nO*:xQUO1G0cO*;PQUO'#EzO*;aQUO1G0cO*;hQUO'#JOO*=OQUO1G0qO!(}QVO1G0qOOQQ,5;[,5;[OOQQ,5;],5;]OOQQ,5?v,5?vOOQQ-E=Y-E=YO!<_QUO1G0xO*>_QUO1G0xOOQQ1G0y1G0yO*>pQUO'#ElOOQQ1G0z1G0zOOQQ7+&j7+&jO*?UQUO7+&jO*@[QVO7+&jOOQQ7+&h7+&hOOQQ,5@],5@]OOQQ-E=o-E=oO*AWQUO1G1TO*AbQUO1G1TO*A{QUO1G0fOOQQ1G0f1G0fO*CRQUO'#LSO*CZQUO1G1ROOQQ<<It<<ItOOQQ'#Hb'#HbO',_QUO,5={OOQQ'#Hd'#HdO',_QUO,5=}OOQQ-E=l-E=lPOQQ<<Ik<<IkPOQQ-E=m-E=mOOQQ<<Lq<<LqO*C`QUO'#LiO*DlQUO'#LhOOQQ,5@a,5@aOOQQ-E=s-E=sOOQR<<Km<<KmO$?]QUO<<KmO*DzQUO<<KmOOQR1G1Z1G1ZOOQQ7+'S7+'SO!MmQVO1G1tO*EPQUO1G1tOOQR7+'_7+'_OOQR<<Jw<<JwO!0wQVO<<JwOOQR<<KO<<KOO*E[QUO<<KSO*FbQVO<<KSOKnQUO<<KcO!MmQVO<<KcO*FiQUO<<KSO!0wQVO<<KSO*GrQUO<<KSO*GwQUO<<KcO*HSQUO<<KdOOQR<<Kd<<KdOOQR<<Kf<<KfO*HXQUO1G2bO)8XQUO1G2bO'D{QUO1G2bO*HjQUO1G2dO*IpQVO1G2dOOQQ1G2d1G2dO*IzQVO1G2dO*JRQUO,5@ROOQQ-E=e-E=eOOQQ1G2e1G2eO*JaQUO1G1|O*KjQVO1G1|O*KqQUO1G1|OOQQ1G5n1G5nOOQR<<Kz<<KzOOQR<<LO<<LOO*KvQVO<<LOO*LRQUO<<LOOOQR1G2|1G2|O*LWQUO1G2|O*L_QUO1G3eOOQR1G3d1G3dOOQQ7+,S7+,SO%)nQUO7+,SO*LjQUO1G6xO*LjQUO1G6xO(&jQUO,5?pO*LrQUO,5?pOOQQ-E=S-E=SO*L}QUO1G0TOOQQ1G0T1G0TO*MXQUO1G0TO!MmQVO1G0TO*M^QUO1G0TOOQQ1G3w1G3wO*MhQUO,5:qO)FjQUO,5:qO*NUQUO,5:qO)FjQUO,5:qO$$TQUO,5:uO*NsQVO,5>VO)HiQUO'#JrO*N}QUO1G0TO+ `QVO1G0TOOQQ1G3u1G3uO+ gQUO,5>WO+ rQUO,5>XO+!aQUO,5>YO+#gQUO1G0TO%)sQUO7+,SO+$mQUO1G4ROOQQ,5@`,5@`OOQQ-E=r-E=rOOQQ<<MT<<MTOOQQ<<Mn<<MnO+%vQUO1G4oP+'yQUO'#JxP+(RQUO,5BYPO{O1G7s1G7sPOOO<<Gn<<GnOOQQANC_ANC_OOQR1G6l1G6lO+(ZQ!eO,5:cOOQQ,5:c,5:cO+(bQUO1G0mO+)nQUO7+&]O+*}QUO7+&dO++`QUO,5;WOOQQ<<JU<<JUO++nQUO7+&oOOQQ7+&Q7+&QO!4{QUO'#J_O+,iQUO,5AnOOQQ7+&m7+&mOOQQ1G3g1G3gO+,qQUO1G3iOOQQ,5>n,5>nO+0fQUOANAXOOQRANAXANAXO+0kQUO7+'`OOQRAN@cAN@cO+1wQVOAN@nO+2OQUOAN@nO!0wQVOAN@nO+3XQUOAN@nO+3^QUOAN@}O+3iQUOAN@}O+4oQUOAN@}OOQRAN@nAN@nO!MmQVOAN@}OOQRANAOANAOO+4tQUO7+'|O)8XQUO7+'|OOQQ7+(O7+(OO+5VQUO7+(OO+6]QVO7+(OO+6dQVO7+'hO+6kQUOANAjOOQR7+(h7+(hOOQR7+)P7+)PO+6pQUO7+)PO+6uQUO7+)POOQQ<= n<= nO+6}QUO7+,dO+7VQUO1G5[OOQQ1G5[1G5[O+7bQUO7+%oOOQQ7+%o7+%oO+7sQUO7+%oO+ `QVO7+%oOOQQ7+)a7+)aO+7xQUO7+%oO+9OQUO7+%oO!MmQVO7+%oO+9YQUO1G0]O*MhQUO1G0]O)FjQUO1G0]OOQQ1G0a1G0aO+9wQUO1G3qO+:}QVO1G3qOOQQ1G3q1G3qO+;XQVO1G3qO+;`QUO,5@^OOQQ-E=p-E=pOOQQ1G3r1G3rO%)nQUO<= nOOQQ7+*Z7+*ZPOQQ,5@d,5@dPOQQ-E=v-E=vOOQQ1G/}1G/}OOQQ,5?y,5?yOOQQ-E=]-E=]OOQRG26sG26sO+;wQUOG26YO!0wQVOG26YO+=QQUOG26YOOQRG26YG26YO!MmQVOG26iO!0wQVOG26iO+=VQUOG26iO+>]QUOG26iO+>bQUO<<KhOOQQ<<Kj<<KjOOQRG27UG27UOOQR<<Lk<<LkO+>sQUO<<LkOOQQ7+*v7+*vOOQQ<<IZ<<IZO+>xQUO<<IZO!MmQVO<<IZO+>}QUO<<IZO+@TQUO<<IZO+ `QVO<<IZOOQQ<<L{<<L{O+@fQUO7+%wO*MhQUO7+%wOOQQ7+)]7+)]O+ATQUO7+)]O+BZQVO7+)]OOQQANEYANEYO!0wQVOLD+tOOQRLD+tLD+tO+BbQUOLD,TO+ChQUOLD,TOOQRLD,TLD,TO!0wQVOLD,TOOQRANBVANBVOOQQAN>uAN>uO+CmQUOAN>uO+DsQUOAN>uO!MmQVOAN>uO+DxQUO<<IcOOQQ<<Lw<<LwOOQR!$( `!$( `O!0wQVO!$( oOOQR!$( o!$( oOOQQG24aG24aO+EgQUOG24aO+FmQUOG24aOOQR!)9EZ!)9EZOOQQLD){LD){O+FrQUO'#CgO(gQUO'#CgO+JoQUO'#CzO+M`QUO'#CzO!FZQUO'#CzO+NXQUO'#CzO+NlQUO'#CzO,$_QUO'#CzO,$oQUO'#CzO,$}QUO'#CzO,%[QbO,59dO,%gQbO,59dO,%rQbO,59dO,%}QbO'#CxO,&`QbO'#CxO,&qQbO'#CxO,'SQUO'#CgO,)gQUO'#CgO,)tQUO'#CgO,,lQUO'#CgO,/oQUO'#CgO,0PQUO'#CgO,1uQUO'#CgO,4uQUO'#CgO,5SQUO'#CgO,5^QUO,5:xO#?yQUO,5:xO#?yQUO,5:xO#=iQUO'#LdO,5zQbO'#CxO,6VQbO'#CxO,6bQbO'#CxO,6mQbO'#CxO#7SQUO'#E^O,6xQUO'#E^O,8VQUO'#HgO,8wQbO'#CxO,9SQbO'#CxO,9_QUO'#CwO,9dQUO'#CwO,9iQUO'#CpO,9wQbO,59dO,:SQbO,59dO,:_QbO,59dO,:jQbO,59dO,:uQbO,59dO,;QQbO,59dO,;]QbO,59dO,5^QUO1G0dO,;hQUO1G0dO#?yQUO1G0dO,6xQUO1G0dO,=uQUO'#KaO,>VQUO'#CzO,>eQbO,59dO,5^QUO7+&OO,;hQUO7+&OO,>pQUO'#EwO,?cQUO'#EzO,@SQUO'#E^O,@XQUO'#GcO,@^QUO'#CwO,@cQUO'#CxO,@hQUO'#CxO,@mQUO'#GcO,@rQUO'#CwO,@wQUO'#KaO,AeQUO'#KaO,AoQUO'#CwO,AzQUO'#CwO,BVQUO'#CwO,;hQUO,5:xO,6xQUO,5:xO,6xQUO,5:xO,BbQUO'#KaO,BuQbO'#CxO,CQQUO'#CsO,CVQUO'#E^",
    stateData: ",C{~O(pOSSOSRPQVPQ'ePQ'gPQ'hPQ'iPQ'jPQ'kPQ'lPQ'mPQ(qPQ~O*cOS~OPmO]eOb!]Oe!POmTOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O|#RO!O!_O!TxO!VfO!X!XO!Y!WO!i!YO!opO!r!`O!s!aO!t!aO!u!bO!v!aO!x!cO!{!dO#V#QO#a#VO#b#TO#i#OO#p!xO#t!fO#v!eO$R!gO$T!hO$Y!vO$Z!wO$`!iO$e!jO$g!kO$h!lO$k!mO$m!nO$o!oO$q!pO$s!qO$u!rO$w!sO${!tO$}!uO%U!yO%_#ZO%`#[O%a#YO%c!zO%e#UO%g!{O%l#SO%o!|O%v!}O%|#PO&m!RO&r#WO&s!TO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(xRO)WYO)ZaO)]|O)^{O)`iO)a!ZO)cXO)ocO)pdO~OR#cOV#^O'e#_O'g#`O'h#aO'i#aO'j#bO'k#bO'l#`O'm#`O(q#]O~OX#eO(u#gO(w#eO~O]ZX]jXejXmhXqZXqjXsjXtjXujXvjXwjXxjXyjXzjX!OjX!TjX!VZX!VjX!XZX!YZX![ZX!^ZX!_ZX!aZX!bZX!eZX!fZX!gZX!hZX!rjX!sjX!tjX!ujX!vjX!xjX!{jX%vjX&rjX&sjX(xjX({ZX(|$]X(}ZX)OZX)ZZX)ZjX)[ZX)]ZX)]jX)^ZX)^jX)_ZX)`ZX)aZX)qZX~O)`jX!UZX~P(gO]$PO!V#nO!X#}O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h#kO({#hO(}#mO)O#mO)Z#oO)[#qO)]#pO)^#rO)_#jO)`#lO)a$OO~Oe$TO%Y$UO'[$VO'_$WO)P$QO~Om$XO~O!T$YO])TXe)TXs)TXt)TXu)TXv)TXw)TXx)TXy)TXz)TX!O)TX!V)TX!r)TX!s)TX!t)TX!u)TX!v)TX!x)TX!{)TX%v)TX&r)TX&s)TX(x)TX)Z)TX)])TX)^)TX)`)TX~Om$XO~P.^Om$XO!g$[O)q$[O~OX$]O)d$]O~O!R$^O)V)XP)a)XP~OPmO]$gOb!]Os!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O|#RO!O!_O!TxO!V$hO!X!XO!Y!WO!i!YO!r!aO!s!aO!t!aO!u!aO!v!aO!x!cO#V#QO#a#VO#b#TO#v!eO$Y!vO$Z!wO$`!iO$e!jO$g!kO$h!lO$k!mO$m!nO$o!oO$q!pO$s!qO$u!rO$w!sO%_#ZO%`#[O%a#YO%e#UO%l#SO%v$oO&m!RO&r#WO&s!TO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO)WYO)Z$mO)^$mO)`iO)a!ZO)cXO)ocO)pdO~Om$aO#t$nO(xRO~P0}O](_Xb'zXe(_Xm'zXm(_Xs'zXs(_Xt'zXt(_Xu'zXu(_Xv'zXv(_Xw'zXw(_Xx'zXx(_Xy'zXy(_Xz'zXz(_X|'zX!O'zX!V(_X!o(_X!r'zX!r(_X!s'zX!s(_X!t'zX!t(_X!u'zX!u(_X!v'zX!v(_X!x'zX!x(_X!{(_X#a'zX#b'zX%e'zX%l'zX%o(_X%v(_X&m'zX&r'zX&s'zX(x'zX(x(_X)Z(_X)](_X)^(_X~Ob!TOm$qOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O|#RO!O!_O!r!aO!s!aO!t!aO!u!aO!v!aO!x!cO#a#VO#b#TO%e#UO%l#SO&m!RO&r#WO&s!TO(x$pO~Os!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!O!_O!r!aO!s!aO!t!aO!u!aO!v!aO!x!cO&r#WO&s$yO])hXe)hXm)hX!V)hX!{)hX%v)hX(x)hX)Z)hX)])hX)^)hX~O)`$xO~P:qOPmO]eOe!POs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!VfO!X!XO!Y!WO!i!YO!{!dO#V#QO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO)ZaO)]|O)^{O)a!ZO)cXO)ocO)pdO~Ob%SOm;UO!|%TO(x$zO~P<oO)Z%UO~Ob!]Om$aO|#RO#a#VO#b#TO%e#UO%l#SO&m!RO&r#WO&s!TO(x;XO~P<oOPmO]$gOb%SOm;UO!V$hO!W%aO!X!XO!Y!WO!i!YO#V#QO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x$zO)Z$mO)^%_O)a!ZO)cXO)ocO)pdO)q%^O~O]%jOe!POm%dO!V%mO!{!dO%v$oO(x;YO)Z%fO)]%kO)^%kO~O(|%oO~O)`#lO~O(x%pO](zX!V(zX!X(zX!Y(zX![(zX!^(zX!_(zX!a(zX!b(zX!e(zX!f(zX!h(zX({(zX(}(zX)O(zX)Z(zX)[(zX)](zX)^(zX)_(zX)`(zX)a(zX!g(zX)q(zX[(zX!W(zX(|(zX!U(zXQ(zX!d(zX~OP%qO(vQO~PCTO]%jOe!POs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!V%mO!r!aO!s!aO!t!aO!u!aO!v!aO!x!cO!{!dO%o!|O%v!}O)Z;jO)]|O)^|O~Om%tO!o%yO(x$zO~PEbO!TxO#v!eO(|%{O)q&OO])lX!V)lX~O]%jOe!POm%tO!V%mO!{!dO%v!}O(x$zO)Z;jO)]|O)^|O~O!TxO#v!eO)`&RO)q&SO~O!U&VO~P!QO]&[O!TxO!V&YO)Z&XO)]&]O)^&]O~Oq&WO~PHuO]&eO!V&dO~OPmO]eOe!PO!VfO!X!XO!Y!WO!i!YO!{!dO#V#QO%_#ZO%`#[O%a#YO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO)ZaO)]|O)^{O)a!ZO)cXO)ocO)pdO~Ob%SOm;UO%v$oO(x$zO~PIjO]%jOe!POm;fO!V%mO!{!dO%v$oO(x$zO)Z;jO)]|O)^|O~Oq&hO](zX])lX!V(zX!V)lX!X(zX!Y(zX![(zX!^(zX!_(zX!a(zX!b(zX!e(zX!f(zX!h(zX({(zX(}(zX)O(zX)Z(zX)[(zX)](zX)^(zX)_(zX)`(zX)a(zX[(zX[)lX!U(zX~O!g$[O)q$[O~PL`O!g(zX)q(zX~PL`O](zX!V(zX!X(zX!Y(zX![(zX!^(zX!_(zX!a(zX!b(zX!e(zX!f(zX!h(zX({(zX(}(zX)O(zX)Z(zX)[(zX)](zX)^(zX)_(zX)`(zX)a(zX!g(zX)q(zX[(zX!U(zX~O])lX!V)lX[)lX~PNnOb&jO&m!RO]&lXe&lXm&lXs&lXt&lXu&lXv&lXw&lXx&lXy&lXz&lX!O&lX!V&lX!r&lX!s&lX!t&lX!u&lX!v&lX!x&lX!{&lX%v&lX&r&lX&s&lX(x&lX)Z&lX)]&lX)^&lX)`&lX[&lX!T&lX!X&lX!Y&lX![&lX!^&lX!_&lX!a&lX!b&lX!e&lX!f&lX!h&lX({&lX(}&lX)O&lX)[&lX)_&lX)a&lX!g&lX)q&lX!W&lXQ&lX!d&lX(|&lX!U&lX#v&lX~Oq&hOm)TX[)TXQ)TX!d)TX!h)TX)a)TX)q)TX~P.^O!g$[O)q$[O](zX!V(zX!X(zX!Y(zX![(zX!^(zX!_(zX!a(zX!b(zX!e(zX!f(zX!h(zX({(zX(}(zX)O(zX)Z(zX)[(zX)](zX)^(zX)_(zX)`(zX)a(zX[(zX!W(zX(|(zX!U(zXQ(zX!d(zX~OPmO]$gOb%SOm;UO!V$hO!X!XO!Y!WO!i!YO#V#QO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x$zO)Z$mO)^$mO)a!ZO)cXO)ocO)pdO~O])TXe)TXm)TXs)TXt)TXu)TXv)TXw)TXx)TXy)TXz)TX!O)TX!V)TX!r)TX!s)TX!t)TX!u)TX!v)TX!x)TX!{)TX%v)TX&r)TX&s)TX(x)TX)Z)TX)])TX)^)TX)`)TX[)TXQ)TX!d)TX!h)TX)a)TX)q)TX~O]$PO~P!*tO]&nO~O])iXb)iXe)iXm)iXs)iXt)iXu)iXv)iXw)iXx)iXy)iXz)iX|)iX!O)iX!V)iX!o)iX!r)iX!s)iX!t)iX!u)iX!v)iX!x)iX!{)iX#a)iX#b)iX%e)iX%l)iX%o)iX%v)iX&m)iX&r)iX&s)iX(x)iX)Z)iX)])iX)^)iX~O(vQO~P!-^O%U&pO~P!-^O]&qO~O]$PO~O!TxO~O$W&yO(x%pO(|&xO~O]&zOx&|O~O]&zO~OPmO]$gOb%SOm;UO!TxO!V$hO!X!XO!Y!WO!i!YO#V#QO#p!xO#v!eO$Y!vO$Z!wO$`!iO$e!jO$g!kO$h!lO$k!mO$m!nO$o!oO$q!pO$s!qO$u!rO$w!sO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x:wO)WYO)Z$mO)^$mO)`iO)a!ZO)cXO)ocO)pdO~O]'RO~O!T$YO)`'TO~P!(}O)`'VO~O)`'WO~O(x'XO~O)`'[O~P!(}Om;hO%U'aO%e'aO(x;ZO~Ob!TOm$qOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O|#RO#a#VO#b#TO%e#UO%l#SO&m!RO&r#WO&s!TO(x$pO~O(|'eO~O)`'gO~P!(}O!TxO(x%pO)q'iO~O(x%pO~O]'lO~O]'mOe%nXm%nX!V%nX!{%nX%v%nX(x%nX)Z%nX)]%nX)^%nX~O]'qO!V'rO!X'oO!g'oO%Z'oO%['oO%]'oO%^'oO%_'sO%`'sO%a'oO)O'pO)q'oO*P'tO~P8}O]%jOb!TOe!POs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O|#RO!O!_O!V%mO!r!aO!s!aO!t!aO!u!aO!v!aO!x!cO!{!dO#a#VO#b#TO%e#UO%l#SO&m!RO&r#WO&s!TO)Z;jO)]|O)^|O~Om;iOq&WO%v$oO(x;[O~P!8mO(x%pO(|'yO)`'zO~O]&eO!T'|O~Om$qO!O!_O!T(TO!l(YO(x$pO(|(SO)WYO~Om$qO|(aO!T(^O#b(aO(x$pO~Ob!TOm$qO|#RO#a#VO#b#TO%e#UO%l#SO&m!RO&r#WO&s!TO(x$pO~O](cO~OPmOb%SOm;UO!V$hO!X!XO!Y!WO!i!YO#V#QO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x$zO)Z$mO)^$mO)cXO)ocO)pdO~O](eO)a(fO~P!=XO]$PO~P!<_OPmO]$gOb%SOm;UO!V(lO!X!XO!Y!WO!i!YO#V#QO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x$zO)Z$mO)^$mO)a!ZO)cXO)ocO)pdO~O(r(mO(s(mO(t(oO~OY(pO(vQO(x%pO~O'f(pO~OS(vO(q#]O*`(uO~O]$PO(p(yO~Q'nXX#eO(u({O(w#eO~Oe)VOm)QO&r#WO(x)PO~O!Y'Sa!['Sa!^'Sa!_'Sa!a'Sa!b'Sa!e'Sa!f'Sa!h'Sa({'Sa)Z'Sa)['Sa)]'Sa)^'Sa)_'Sa)`'Sa)a'Sa!g'Sa)q'Sa['Sa!W'Sa(|'Sa!U'SaQ'Sa!d'Sa~OPmOb%SOm;UO!i!YO#V#QO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x$zO)cXO)ocO)pdO]'Sa!V'Sa!X'Sa(}'Sa)O'Sa~P!BmO!T$YO[(yP~P!(}O]oX]%WXeoXmnXqoXq%WXsoXtoXuoXvoXwoXxoXyoXzoX!OoX!ToX!VoX!V%WX!X%WX!Y%WX![%WX!^%WX!_%WX!a%WX!b%WX!e%WX!f%WX!gnX!h%WX!roX!soX!toX!uoX!voX!xoX!{oX%voX&roX&soX(xoX({%WX(}%WX)O%WX)ZoX)Z%WX)[%WX)]oX)]%WX)^oX)^%WX)_%WX)`%WX)a%WX)qnX[%WX~O)`oX[oX!U%WX~P!FZO])iO!V)jO!X)gO!g)gO%Z)gO%[)gO%])gO%^)gO%_)kO%`)kO%a)gO)O)hO)q)gO*P)lO~P8}OPmO]$gOb%SOm;UO!X!XO!Y!WO!i!YO#V#QO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x$zO)Z$mO)^$mO)a!ZO)cXO)ocO)pdO~O!V)qO~P!KVOe)tO%Y)uO)P$QO~O!T$YO!V)wO(})xO!U)yP~P!KVO!T$YO~P!(}O)b*PO~Om*QO]!QX!h!QX)V!QX)a!QX~O]*SO!h*TO)V)XX)a)XX~O)V*WO)a*XO~Oe$TO%Y*YO'[$VO'_$WO)P$QO~Om*ZO~Om*ZO[)TX~P.^Om*ZO!g$[O)q$[O~O)`*[O~P:qOPmO]$gOb!]Om$aOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O|#RO!V$hO!X!XO!Y!WO!i!YO#V#QO#a#VO#b#TO%_#ZO%`#[O%a#YO%e#UO%l#SO%v$oO&m!RO&r#WO&s!TO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x;XO)Z$mO)^$mO)a!ZO)cXO)ocO)pdO~Oq&hO~P!&}Oq&hO!W(zX(|(zXQ(zX!d(zX~PNnO]'qO!V'rO!X'oO!g'oO%Z'oO%['oO%]'oO%^'oO%_'sO%`'sO%a'oO)O'pO)q'oO*P'tO~O]jXejXmhXqjXsjXtjXujXvjXwjXxjXyjXzjX!OjX!VjX!rjX!sjX!tjX!ujX!vjX!xjX!{jX%vjX&rjX&sjX(xjX)ZjX)]jX)^jX!TjX!hjX)ajX)qjX[jX~O!ljX(|jX)`jX!XjX!YjX![jX!^jX!_jX!ajX!bjX!ejX!fjX({jX(}jX)OjX)[jX)_jX!gjX!WjXQjX!djX!UjX#vjX#TjX#VjX#pjXbjX|jX!ojX#ajX#bjX#ijX#tjX${jX%cjX%ejX%kjX%ljX%ojX&mjX)WjX~P#&XO)P*`O~Om*aO~O])TXe)TXs)TXt)TXu)TXv)TXw)TXx)TXy)TXz)TX!O)TX!V)TX!r)TX!s)TX!t)TX!u)TX!v)TX!x)TX!{)TX%v)TX&r)TX&s)TX(x)TX)Z)TX)])TX)^)TX)`)TX!T)TX!X)TX!Y)TX![)TX!^)TX!_)TX!a)TX!b)TX!e)TX!f)TX!h)TX({)TX(})TX)O)TX)[)TX)_)TX)a)TX!g)TX)q)TX[)TX!W)TXQ)TX!d)TX(|)TX!U)TX#v)TX~Om*aO~P#+aOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!O!_O!r!aO!s!aO!t!aO!u!aO!v!aO!x!cO])hae)ham)ha!V)ha!{)ha%v)ha(x)ha)Z)ha)])ha)^)haQ)ha!d)ha!h)ha)a)ha)q)ha[)ha!T)ha(|)ha)`)ha~O&r#WO&s$yO~P#/POq&hOm)TX~P#+aO&r)ha~P#/PO]ZXmhXqZXqjX!TjX!VZX!XZX!YZX![ZX!^ZX!_ZX!aZX!bZX!eZX!fZX!gZX!hZX({ZX(}ZX)OZX)ZZX)[ZX)]ZX)^ZX)_ZX)`ZX)aZX)qZX[ZX~O!WZX(|ZX!UZXQZX!dZX~P#1xO]$PO!V#nO!X#}O(}#mO)O#mO~O!Y&xa![&xa!^&xa!_&xa!a&xa!b&xa!e&xa!f&xa!g&xa!h&xa({&xa)Z&xa)[&xa)]&xa)^&xa)_&xa)`&xa)a&xa)q&xa[&xa!W&xa(|&xa!U&xaQ&xa!d&xa~P#4YOm;rO!T$YO~Os!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O~PKnOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!|%TO~PKnO]&eO!V&dO[#Qa!T#Qa!h#Qa#v#Qa)`#Qa)q#QaQ#Qa!d#Qa(|#Qa~Oq&hO!T$YO~O[*hO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h#kO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO[*hO~O[*jO]&eO!V&dO~O]&[Os!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!V&YO&r#WO&s$yO)Z&XO)]&]O)^&]O~O[rXQrX!drX!hrX)arX)`rX~P#:ZO[*mO~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h*nO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!W)rX~P#4YO!W*pO!h*qO~O!W*pO!h*qO~P!(}O!W*pO~Oq&hO!g$[O!h*rO)q$[O](zX!V(zX!W(zX!W*WX!X(zX!Y(zX![(zX!^(zX!_(zX!a(zX!b(zX!e(zX!f(zX({(zX(}(zX)O(zX)Z(zX)[(zX)](zX)^(zX)_(zX)a(zX~O!h(zX~P#=iO!W*tO~Oe$TO%Y*YO)P:|O~Om;uO~Os!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!|%TO~PBXO]*{O!T*vO!V&dO!h*yO#v!eO)q*wO)`)xX~O!h*yO)`)xX~O)`*|O~Oq&hO])lX!T)lX!V)lX!h)lX#v)lX)`)lX)q)lX[)lXQ)lX!d)lX(|)lX~Oq&hO~OP%qO(vQO]%ha!V%ha!X%ha!Y%ha![%ha!^%ha!_%ha!a%ha!b%ha!e%ha!f%ha!h%ha(x%ha({%ha(}%ha)O%ha)Z%ha)[%ha)]%ha)^%ha)_%ha)`%ha)a%ha!g%ha)q%ha[%ha!W%ha(|%ha!U%haQ%ha!d%ha~Oe$TO%Y$UO)P:yO~Om;RO~O!TxO#v!eO)q&OO~Om<fO&r#WO(x;qO~O$Z+YO%`+ZO~O!TxO#v!eO)`+[O)q+]O~OPmO]$gOb%SOm;UO!V$hO!X!XO!Y!WO!i!YO#V#QO$Z+YO%_#ZO%`+_O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x$zO)Z$mO)^$mO)a!ZO)cXO)ocO)pdO~O!U+`O~P!QOb!TOm$qOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O|#RO!O!_O!r!aO!s!aO!t!aO!u!aO!v!aO!x!cO#a+fO#b+gO#i+hO%e#UO%l#SO&m!RO&r#WO&s!TO(x$pO)WYO~OQ)sP!d)sP~P#GuO]&[Os!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!V&YO)Z&XO)]&]O)^&]O~O[#kX!T#kX#v#kX)`#kX)q#kXQ#kX!d#kX!h#kX)a#kX!x#kX(|#kX~P#IyOPmO]$gOb%SOm;UOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!V$hO!W+nO!X!XO!Y!WO!i!YO#V#QO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x$zO)Z+oO)^$mO)a!ZO)cXO)ocO)pdO~O]&eO!V+pO~O]&[O!V&YO)WYO)Z&XO)]&]O)^&]O)a+sO[)kP~P8}O]&[O!V&YO)Z&XO)]&]O)^&]O~O[#nX!T#nX#v#nX)`#nX)q#nXQ#nX!d#nX!h#nX)a#nX!x#nX(|#nX~P#NsO!TxO])uX!V)uX~Os!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O#T+{O#p+|O)O+yO)]+wO)^+wO~O]#jX!T#jX!V#jX[#jX#v#jX)`#jX)q#jXQ#jX!d#jX!h#jX)a#jX!x#jX(|#jX~P$!WO#V,OO~Os!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!l,PO#T+{O#V,OO#p+|O)O+yO)],PO)^,PO])mP!T)mP!V)mP#v)mP(|)mP)q)mP[)mP!h)mP)`)mP~O!x)mPQ)mP!d)mP~P$$TOPmO]$gOb%SOm;UOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!V$hO!X!XO!Y!WO!i!YO#V#QO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x$zO)^$mO)a!ZO)cXO)ocO)pdO~O!W,VO)Z,WO~P$&OO)WYO)a+sO[)kP~P8}O]&eO!V&dO[&Za!T&Za!h&Za#v&Za)`&Za)q&ZaQ&Za!d&Za(|&Za~OPmO]$gOb!]Om;WOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O|#RO!V$hO!X!XO!Y!WO!i!YO#V#QO#a#VO#b#TO%_#ZO%`#[O%a#YO%e#UO%l#SO%v$oO&m!RO&r#WO&s!TO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x;]O)Z$mO)^$mO)a!ZO)cXO)ocO)pdO~OQ)QP!d)QP~P$)hO]$PO!V#nO(}#mO)O#mO!X'Pa!Y'Pa!['Pa!^'Pa!_'Pa!a'Pa!b'Pa!e'Pa!f'Pa!h'Pa({'Pa)Z'Pa)['Pa)]'Pa)^'Pa)_'Pa)`'Pa)a'Pa!g'Pa)q'Pa['Pa!W'Pa(|'Pa!U'PaQ'Pa!d'Pa~O]$PO!V#nO!X#}O(}#mO)O#mO~P!BmO!TxO#t!fO)WYO~P8}O!TxO(x%pO)q,aO~O#x,fO~OQ)hX!d)hX!h)hX)a)hX)q)hX[)hX!T)hX(|)hX)`)hX~P:qO(|,jO(},hO)W$UX)`$UX~O(x,kO~O)WYO)`,nO~OPmO]$gOb!]Om;VOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O|#RO!O!_O!V$hO!X!XO!Y!WO!i!YO!r!aO!s!aO!t!aO!u!aO!v!aO!x!cO#V#QO#a#VO#b#TO%_#ZO%`#[O%a#YO%e#UO%l#SO%v$oO&m!RO&r#WO&s!TO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO)WYO)Z$mO)^$mO)`iO)a!ZO)cXO)ocO)pdO~O(x;^O~P$0yOPmO]$gOb%SOm;UO!TxO!V$hO!X!XO!Y!WO!i!YO#V#QO#v!eO$Y!vO$Z!wO$`!iO$e!jO$g!kO$h!lO$k!mO$m!nO$o!oO$q!pO$s!qO$u!rO$w!sO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x:wO)WYO)Z$mO)^$mO)`iO)a!ZO)cXO)ocO)pdO~O$h,xO~OPmO]$gOb!]Om;VOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O|#RO!O!_O!V$hO!X!XO!Y!WO!i!YO!r!aO!s!aO!t!aO!u!aO!v!aO!x!cO#V#QO#a#VO#b#TO$}!uO%_#ZO%`#[O%a#YO%e#UO%l#SO%v$oO&m!RO&r#WO&s!TO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO)WYO)Z$mO)^$mO)a!ZO)cXO)ocO)pdO~O${-OO(x;XO)`,|O~P$7dO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h#kO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`-QO)a$OO~P#4YO)`-QO~O)`-RO~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`-SO)a$OO~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`-TO)a$OO~P#4YO!h-UO)`*QX~Oq&hO)WYO)q-XO~O)`-YO~Om;hO(x;ZO~O]-aO!{!dO&r#WO&s$yO(x-]O)Z-^O~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO(|-dO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!TxO$`!iO$e!jO$g!kO$h!lO$k-iO$m!nO$o!oO$q!pO$s!qO$u!rO$w!sO$}!uO(x:xOe$Xa!o$Xa!{$Xa#i$Xa#p$Xa#t$Xa#v$Xa$R$Xa$T$Xa$Y$Xa$Z$Xa${$Xa%U$Xa%c$Xa%g$Xa%o$Xa%|$Xa(m$Xa)]$Xa!U$Xa$c$Xa~P$0yO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`-jO)a$OO~P#4YOm-lO!TxO)q,aO~O)q-nO~O]&]a!X&]a!Y&]a![&]a!^&]a!_&]a!a&]a!b&]a!e&]a!f&]a!h&]a({&]a(}&]a)O&]a)[&]a)]&]a)^&]a)_&]a)`&]a)a&]a!g&]a)q&]a[&]a!W&]a!T&]a#v&]a(|&]a!U&]aQ&]a!d&]a~O)Z-rO!V&]a~P$DxO[-rO~O!W-rO~O!V-sO)Z&]a~P$DxO])TXe)TXs)TXt)TXu)TXv)TXw)TXx)TXy)TXz)TX!O)TX!V)TX!r)TX!s)TX!t)TX!u)TX!v)TX!x)TX!{)TX%v)TX&r)TX&s)TX(x)TX)Z)TX)])TX)^)TX~Om;xO~P$GhO]&eO!V&dO)`-tO~Om;mO!o-wO#V,OO#i-|O#t!fO${-OO%c!zO%k-{O%o!|O%v!}O(x;aO)WYO~P!8mO!n.QO(x,kO~O)WYO)`.SO~OPmO]$gOb%SOm;UO!T.XO!V$hO!X!XO!Y!WO!i!YO#V.`O#a._O%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x$zO)O.WO)Z$mO)^$mO)`.UO)a!ZO)cXO)ocO)pdO~O!U.^O~P$JxO])eXe)eXs)eXt)eXu)eXv)eXw)eXx)eXy)eXz)eX!O)eX!T)eX!V)eX!l)eX!r)eX!s)eX!t)eX!u)eX!v)eX!x)eX!{)eX%v)eX&r)eX&s)eX(x)eX(|)eX)Z)eX)])eX)^)eX)`)eX[)eX!h)eX)a)eX!X)eX!Y)eX![)eX!^)eX!_)eX!a)eX!b)eX!e)eX!f)eX({)eX(})eX)O)eX)[)eX)_)eX!g)eX)q)eX!W)eXQ)eX!d)eX#T)eX#V)eX#p)eX#v)eXb)eX|)eX!o)eX#a)eX#b)eX#i)eX#t)eX${)eX%c)eX%e)eX%k)eX%l)eX%o)eX&m)eX)W)eX!U)eX~Om*aO~P$MSOm$qO!T(TO!l.eO(x$pO(|(SO)WYO~Oq&hOm)eX~P$MSOm$qO!n.jO!o.jO(x$pO)WYO~Om;nO!U.uO!n.wO!o.vO#i-|O${!tO$}!uO%g!{O%k-{O%o!|O%v!}O(x;`O)WYO~P!8mO!T(TO!l.eO(|(SO])UXe)UXm)UXs)UXt)UXu)UXv)UXw)UXx)UXy)UXz)UX!O)UX!V)UX!r)UX!s)UX!t)UX!u)UX!v)UX!x)UX!{)UX%v)UX&r)UX&s)UX(x)UX)Z)UX)])UX)^)UX~O)`)UX[)UX!X)UX!Y)UX![)UX!^)UX!_)UX!a)UX!b)UX!e)UX!f)UX!h)UX({)UX(})UX)O)UX)[)UX)_)UX)a)UX!g)UX)q)UX!W)UXQ)UX!d)UX!U)UX#v)UX~P%%{O!T(TO~O!T(TO(|(SO~O(x%pO!U*YP~O!T(^O(|.|O]&kae&kam&kas&kat&kau&kav&kaw&kax&kay&kaz&ka!O&ka!V&ka!r&ka!s&ka!t&ka!u&ka!v&ka!x&ka!{&ka%v&ka&r&ka&s&ka(x&ka)Z&ka)]&ka)^&ka)`&ka[&ka!X&ka!Y&ka![&ka!^&ka!_&ka!a&ka!b&ka!e&ka!f&ka!h&ka({&ka(}&ka)O&ka)[&ka)_&ka)a&ka!g&ka)q&ka!W&kaQ&ka!d&ka!U&ka#v&ka~Om$qO!T(^O(x$pO~O&r#WO&s$yO]&pae&pam&pas&pat&pau&pav&paw&pax&pay&paz&pa!O&pa!V&pa!r&pa!s&pa!t&pa!u&pa!v&pa!x&pa!{&pa%v&pa(x&pa)Z&pa)]&pa)^&pa)`&pa[&pa!T&pa!X&pa!Y&pa![&pa!^&pa!_&pa!a&pa!b&pa!e&pa!f&pa!h&pa({&pa(}&pa)O&pa)[&pa)_&pa)a&pa!g&pa)q&pa!W&paQ&pa!d&pa(|&pa!U&pa#v&pa~O&s/RO~P!(}O!Y#sO![#tO!f#|O)Z#oO!^'Ua!_'Ua!a'Ua!b'Ua!e'Ua!h'Ua({'Ua)['Ua)]'Ua)^'Ua)_'Ua)`'Ua)a'Ua!g'Ua)q'Ua['Ua!W'Ua(|'Ua!U'UaQ'Ua!d'Ua~P#4YO!V'dX!X'dX!Y'dX!['dX!^'dX!_'dX!a'dX!b'dX!e'dX!f'dX!h'dX({'dX(}'dX)O'dX)Z'dX)['dX)]'dX)^'dX)_'dX)a'dX['dX~O]/TO)`'dX!g'dX)q'dX!W'dX(|'dX!U'dXQ'dX!d'dX~P%3`O!Y#sO![#tO!f#|O)Z#oO!^'Wa!_'Wa!a'Wa!b'Wa!e'Wa!h'Wa({'Wa)['Wa)]'Wa)^'Wa)_'Wa)`'Wa)a'Wa!g'Wa)q'Wa['Wa!W'Wa(|'Wa!U'WaQ'Wa!d'Wa~P#4YO]$PO!T$YO!V/UO&r#WO&s$yO~O!X'Za!Y'Za!['Za!^'Za!_'Za!a'Za!b'Za!e'Za!f'Za!h'Za({'Za(}'Za)O'Za)Z'Za)['Za)]'Za)^'Za)_'Za)`'Za)a'Za!g'Za)q'Za['Za!W'Za(|'Za!U'ZaQ'Za!d'Za~P%7VO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!h'^a)`'^a!g'^a)q'^a['^a!W'^a(|'^a!U'^aQ'^a!d'^a~P#4YOPmO]$gOb%SOm;UO!V$hO!X!XO!Y!WO!i!YO#V#QO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x$zO)Z$mO)^%_O)a!ZO)cXO)ocO)pdO)q%^O~O!W/XO~P%;VO(r(mO(s(mO(t/ZO~OS(vO]$PO(q#]O*`(uO~OS(vO]/^O'f/]O(q#]O*`(uO~OS/bO(q#]O*`/aO~O]$PO~Q'na!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO(|/dO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h#kO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO)`#Zi[#Zi~P#4YO]dXmhXqdXqjX!VdX!XdX!YdX![dX!^dX!_dX!adX!bdX!edX!fdX!gdX!hdX({dX(}dX)OdX)ZdX)[dX)]dX)^dX)_dX)`dX)adX)qdX[dX!WdX(|dX!TdX#vdX!UdXQdX!ddX~Oe/fO%Y*YO)P/eO~Om/gO~Om/hO~Oq&hO]ci!Vci!Xci!Yci![ci!^ci!_ci!aci!bci!eci!fci!gci!hci({ci(}ci)Oci)Zci)[ci)]ci)^ci)_ci)`ci)aci)qci[ci!Wci(|ci!UciQci!dci~O!W/jO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO![#tO)Z#oO!Y&zi!^&zi!_&zi!a&zi!b&zi!e&zi!f&zi!h&zi({&zi)[&zi)]&zi)^&zi)_&zi)`&zi)a&zi!g&zi)q&zi[&zi!W&zi(|&zi!U&ziQ&zi!d&zi~P#4YO!Y&zi![&zi!^&zi!_&zi!a&zi!b&zi!e&zi!f&zi!h&zi({&zi)Z&zi)[&zi)]&zi)^&zi)_&zi)`&zi)a&zi!g&zi)q&zi[&zi!W&zi(|&zi!U&ziQ&zi!d&zi~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O)Z#oO)^#rO)_#jO!h&zi({&zi)[&zi)]&zi)`&zi)a&zi!g&zi)q&zi[&zi!W&zi(|&zi!U&ziQ&zi!d&zi~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O)Z#oO)]#pO)^#rO)_#jO!h&zi({&zi)[&zi)`&zi)a&zi!g&zi)q&zi[&zi!W&zi(|&zi!U&ziQ&zi!d&zi~P#4YO!Y#sO![#tO!_#xO!a#zO!b#{O!e#{O!f#|O)Z#oO)^#rO)_#jO!^&zi!h&zi({&zi)[&zi)]&zi)`&zi)a&zi!g&zi)q&zi[&zi!W&zi(|&zi!U&ziQ&zi!d&zi~P#4YO!Y#sO![#tO!a#zO!b#{O!e#{O!f#|O)Z#oO)^#rO)_#jO!^&zi!_&zi!h&zi({&zi)[&zi)]&zi)`&zi)a&zi!g&zi)q&zi[&zi!W&zi(|&zi!U&ziQ&zi!d&zi~P#4YO!Y#sO![#tO!a#zO!b#{O!e#{O!f#|O)Z#oO)_#jO!^&zi!_&zi!h&zi({&zi)[&zi)]&zi)^&zi)`&zi)a&zi!g&zi)q&zi[&zi!W&zi(|&zi!U&ziQ&zi!d&zi~P#4YO!Y#sO![#tO!b#{O!e#{O!f#|O)Z#oO)_#jO!^&zi!_&zi!a&zi!h&zi({&zi)[&zi)]&zi)^&zi)`&zi)a&zi!g&zi)q&zi[&zi!W&zi(|&zi!U&ziQ&zi!d&zi~P#4YO!Y#sO![#tO!f#|O)Z#oO!^&zi!_&zi!a&zi!b&zi!e&zi!h&zi({&zi)[&zi)]&zi)^&zi)_&zi)`&zi)a&zi!g&zi)q&zi[&zi!W&zi(|&zi!U&ziQ&zi!d&zi~P#4YO!Y#sO![#tO)Z#oO!^&zi!_&zi!a&zi!b&zi!e&zi!f&zi!h&zi({&zi)[&zi)]&zi)^&zi)_&zi)`&zi)a&zi!g&zi)q&zi[&zi!W&zi(|&zi!U&ziQ&zi!d&zi~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O)Z#oO)[#qO)]#pO)^#rO)_#jO!h&zi({&zi)`&zi)a&zi!g&zi)q&zi[&zi!W&zi(|&zi!U&ziQ&zi!d&zi~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h/kO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO[(yX~P#4YO!h/kO[(yX~O[/mO~O]%Xaq%Xa!X%Xa!Y%Xa![%Xa!^%Xa!_%Xa!a%Xa!b%Xa!e%Xa!f%Xa!h%Xa({%Xa(}%Xa)O%Xa)[%Xa)]%Xa)^%Xa)_%Xa)`%Xa)a%Xa!g%Xa)q%Xa[%Xa!W%Xa!T%Xa#v%Xa(|%Xa!U%XaQ%Xa!d%Xa~O)Z/nO!V%Xa~P&-YO[/nO~O!W/nO~O!V/oO)Z%Xa~P&-YO!X'Zi!Y'Zi!['Zi!^'Zi!_'Zi!a'Zi!b'Zi!e'Zi!f'Zi!h'Zi({'Zi(}'Zi)O'Zi)Z'Zi)['Zi)]'Zi)^'Zi)_'Zi)`'Zi)a'Zi!g'Zi)q'Zi['Zi!W'Zi(|'Zi!U'ZiQ'Zi!d'Zi~P%7VO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!h'^i)`'^i!g'^i)q'^i['^i!W'^i(|'^i!U'^iQ'^i!d'^i~P#4YO!W/tO~P%;VO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h/vO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!U)yX~P#4YO(x/yO~O!V/{O(})xO)q/}O~O!h/vO!U)yX~O!U0OO~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!h`i({`i)``i!g`i)q`i[`i!W`i(|`i!U`iQ`i!d`i~P#4YO!R0PO~Om*QO]!Qa!h!Qa)V!Qa)a!Qa~OP0XO]0WOm0XO!R0XO!T0UO!V0VO!X0XO!Y0XO![0XO!^0XO!_0XO!a0XO!b0XO!e0XO!f0XO!g0XO!h0XO!i0XO(vQO(|0XO(}0XO)O0XO)Z0RO)[0SO)]0SO)^0TO)_#jO)`0XO)a0XO)cXO~O[0[O~P&7rO!R$^O~O!h*TO)V)Xa)a)Xa~O)V0`O~O])iO!V)jO!X)gO!g)gO%Z)gO%[)gO%])gO%^)gO%_)kO%`)kO%a)gO)O)hO)q)gO*P)lO~Oe)tO%Y*YO)P$QO~O)`0bO~O]oXeoXmnXqoXsoXtoXuoXvoXwoXxoXyoXzoX!OoX!VoX!roX!soX!toX!uoX!voX!xoX!{oX%voX&roX&soX(xoX)ZoX)]oX)^oX!ToX!hoX)aoX[oXQoX!doX~O!loX(|oX)`oX!XoX!YoX![oX!^oX!_oX!aoX!boX!eoX!foX({oX(}oX)OoX)[oX)_oX!goX)qoX!WoX!UoX#voX#ToX#VoX#poXboX|oX!ooX#aoX#boX#ioX#toX${oX%coX%eoX%koX%loX%ooX&moX)WoX~P&;nOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!O!_O!r!aO!s!aO!t!aO!u!aO!v!aO!x!cO~O])hie)him)hi!V)hi!{)hi%v)hi(x)hi)Z)hi)])hi)^)hiQ)hi!d)hi!h)hi)a)hi)q)hi[)hi!T)hi&r)hi(|)hi)`)hi~P&@lO]&eO!V&dO[#Qi!T#Qi!h#Qi#v#Qi)`#Qi)q#QiQ#Qi!d#Qi(|#Qi~O[raQra!dra!hra)ara)`ra~P#:ZO[raQra!dra!hra)ara)`ra~P#IyO]&eO!V+pO[raQra!dra!hra)ara)`ra~O!h*nO!W)ra~O!h*rO!W*Wa~OPmOb!]Os!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O|#RO!O!_O!X!XO!Y!WO!i!YO!s!aO!t!aO!v!aO!x!cO#V#QO#a#VO#b#TO#v!eO$Y!vO$Z!wO$`!iO$e!jO$g!kO$h!lO$k!mO$m!nO$o!oO$q!pO$s!qO$u!rO$w!sO%_#ZO%`#[O%a#YO%e#UO%l#SO&m!RO&r#WO&s!TO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO)WYO)`iO)a!ZO)cXO)ocO)pdO~O]eOe!POmTO!T*vO!U&VO!V0pO!opO!r!`O!u!bO!{!dO#i#OO#p!xO#t!fO$R!gO$T!hO${!tO$}!uO%U!yO%c!zO%g!{O%o!|O%v!}O%|#PO(xRO(})xO)ZaO)]|O)^{O~P&EnO!h*yO)`)xa~OPmO]$gOb!]Om;WO|#RO!T$YO!V$hO!X!XO!Y!WO!i!YO#V#QO#a#VO#b#TO%_#ZO%`#[O%a#YO%e#UO%l#SO%v$oO&m!RO&r#WO&s!TO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x;_O)WYO)Z$mO)^$mO)a0vO)cXO)ocO)pdO[(yP[)kP~P&@lO!h*rO!W*WX~O]$PO!T$YO~O!h0{O!T*SX#v*SX)q*SX~O)`0}O~O)`1OO~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`1QO)a$OO~P#4YO)`1OO~P!?ZO]1[Oe!POm%dO!V1YO!{!dO%v$oO(x$zO)Z1SO)a1VO~O)]1WO)^1WO)q1TOQ#PX!d#PX!h#PX[#PX~P'!]O!h1]OQ)sX!d)sX~OQ1_O!d1_O~O)a1bO)q1aOQ#`X!d#`X!h#`X~P!<_O)a1bO)q1aOQ#`X!d#`X!h#`X~P!;eOq&WO~O[#ka!T#ka#v#ka)`#ka)q#kaQ#ka!d#ka!h#ka)a#ka!x#ka(|#ka~P#IyO]&eO!V+pO[#ka!T#ka#v#ka)`#ka)q#kaQ#ka!d#ka!h#ka)a#ka!x#ka(|#ka~O!W1gO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!W1gO)Z1iO~P$&OO!W1gO~P!(}O]#ja!T#ja!V#ja[#ja#v#ja)`#ja)q#jaQ#ja!d#ja!h#ja)a#ja!x#ja(|#ja~P$!WO[1mO]&eO!V+pO~O!h1nO[)kX~O[1pO~O]&eO!V+pO[#na!T#na#v#na)`#na)q#naQ#na!d#na!h#na)a#na!x#na(|#na~O]1tOs#SXt#SXu#SXv#SXw#SXx#SXy#SXz#SX!T#SX!V#SX#T#SX#p#SX)O#SX)]#SX)^#SX!l#SX!x#SX#V#SX#v#SX(|#SX)q#SX[#SX!h#SX)`#SXQ#SX!d#SX)a#SX~O]1uO~O]1xOm$qO!V$hO#V#QO(x$pO)ocO)pdO~Os!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!l,PO#T+{O#V,OO#p+|O)O+yO)],PO)^,PO~O])mX!T)mX!V)mX!x)mX#v)mX(|)mX)q)mX[)mX!h)mX)`)mXQ)mX!d)mX~P',vO!x!cO]#Ri!T#Ri!V#Ri#v#Ri(|#Ri)q#Ri[#Ri!h#Ri)`#RiQ#Ri!d#Ri~O!W2QO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!W2QO)Z2SO~P$&OO!W2QO~P!(}O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OOQ*ZX!d*ZX!h*ZX~P#4YO)a2TOQ)RX!d)RX!h)RX~O!h2UOQ)QX!d)QX~OQ2WO!d2WO~O[2XO~O#t$nO)WYO~P8}Om-lO!TxO)q2]O~O[2^O~O#x,fOP#ui]#uib#uie#uim#uis#uit#uiu#uiv#uiw#uix#uiy#uiz#ui|#ui!O#ui!T#ui!V#ui!X#ui!Y#ui!i#ui!o#ui!r#ui!s#ui!t#ui!u#ui!v#ui!x#ui!{#ui#V#ui#a#ui#b#ui#i#ui#p#ui#t#ui#v#ui$R#ui$T#ui$Y#ui$Z#ui$`#ui$e#ui$g#ui$h#ui$k#ui$m#ui$o#ui$q#ui$s#ui$u#ui$w#ui${#ui$}#ui%U#ui%_#ui%`#ui%a#ui%c#ui%e#ui%g#ui%l#ui%o#ui%v#ui%|#ui&m#ui&r#ui&s#ui'Q#ui'R#ui'V#ui'Y#ui'a#ui'b#ui(m#ui(v#ui(x#ui)W#ui)Z#ui)]#ui)^#ui)`#ui)a#ui)c#ui)o#ui)p#ui!U#ui$c#ui!n#ui%k#ui~O]&eO~O]&eO!TxO!V&dO#v!eO~O(|2cO(},hO)W$Ua)`$Ua~O)WYO)`2eO~O[2fO~P,`O[2fO)`#lO~O[2fO~O$c2kOP$_i]$_ib$_ie$_im$_is$_it$_iu$_iv$_iw$_ix$_iy$_iz$_i|$_i!O$_i!T$_i!V$_i!X$_i!Y$_i!i$_i!o$_i!r$_i!s$_i!t$_i!u$_i!v$_i!x$_i!{$_i#V$_i#a$_i#b$_i#i$_i#p$_i#t$_i#v$_i$R$_i$T$_i$Y$_i$Z$_i$`$_i$e$_i$g$_i$h$_i$k$_i$m$_i$o$_i$q$_i$s$_i$u$_i$w$_i${$_i$}$_i%U$_i%_$_i%`$_i%a$_i%c$_i%e$_i%g$_i%l$_i%o$_i%v$_i%|$_i&m$_i&r$_i&s$_i'Q$_i'R$_i'V$_i'Y$_i'a$_i'b$_i(m$_i(v$_i(x$_i)W$_i)Z$_i)]$_i)^$_i)`$_i)a$_i)c$_i)o$_i)p$_i!U$_i~O]1xO~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h#kO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`2nO)a$OO~P#4YOPmO]$gOb!]Om;VO|#RO!V$hO!X!XO!Y!WO!i!YO#V#QO#a#VO#b#TO%_#ZO%`#[O%a#YO%e#UO%l#SO%v$oO&m!RO&r#WO&s!TO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x;XO)Z$mO)^$mO)`2qO)a!ZO)cXO)ocO)pdO~P&@lO)`2nO~O(x-]O~O!h-UO)`*Qa~O)WYO)q2vO~O)`2xO~O]-aOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!{!dO!|%TO(x-]O)Z-^O~O)Z2}O~O]&eO!V3PO!h3QO)`)|X~O]-aO!{!dO(x-]O)Z-^O~O)`3TO~O!TxO$`!iO$e!jO$g!kO$h!lO$k-iO$m!nO$o!oO$q!pO$s!qO$u!rO$w!sO$}!uO(x:xOe$Xi!o$Xi!{$Xi#i$Xi#p$Xi#t$Xi#v$Xi$R$Xi$T$Xi$Y$Xi$Z$Xi${$Xi%U$Xi%c$Xi%g$Xi%o$Xi%|$Xi(m$Xi)]$Xi!U$Xi$c$Xi~P$0yOm;VO(x:xO~P0}O]3XO~O)`2[O~O!u3ZO(x%pO~O[3^O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h3_O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO[3`O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO]&eO!V+pO!T%ui#v%ui)`%ui)q%ui~O!W3aO~Om;TO)`)TX~P$GhOb!TOm$qO|3gO#a#VO#b3fO#t!fO%e#UO%l3hO&m!RO&r#WO&s!TO(x$pO)WYO~P&@lOm;mO!o-wO#i-|O#t!fO${-OO%c!zO%k-{O%o!|O%v!}O(x;aO)WYO~P!8mO]&eO!V&dO)`3jO~O)`3kO~O)WYO)`3kO~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h#kO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`3lO)a$OO~P#4YO)`3lO~O)`3oO~O!U3qO~P$JxOm$qO(x$pO~O]3sO!T'|O~P',bO!T(TO!l3vO(|(SO])Uae)Uam)Uas)Uat)Uau)Uav)Uaw)Uax)Uay)Uaz)Ua!O)Ua!V)Ua!r)Ua!s)Ua!t)Ua!u)Ua!v)Ua!x)Ua!{)Ua%v)Ua&r)Ua&s)Ua(x)Ua)Z)Ua)])Ua)^)Ua)`)Ua[)Ua!X)Ua!Y)Ua![)Ua!^)Ua!_)Ua!a)Ua!b)Ua!e)Ua!f)Ua!h)Ua({)Ua(})Ua)O)Ua)[)Ua)_)Ua)a)Ua!g)Ua)q)Ua!W)UaQ)Ua!d)Ua!U)Ua#v)Ua~Om$qO!n.jO!o.jO(x$pO~O!h3zO)a3|O!T)fX~O!o4OO)WYO~P8}O)`4PO~PGYO]4UOm)QO!T$YO!{!dO%v$oO&r#WO(x)PO(|4YO)Z4RO)]4VO)^4VO~O)`4ZO)q4]O~P('fOm;nO!U4_O!n.wO!o.vO#i-|O${!tO$}!uO%g!{O%k-{O%o!|O%v!}O(x;`O)WYO~P!8mOm;nO%v!}O(x;`O~P!8mO(|4`O~Om$qO!T(TO(x$pO(|(SO)WYO~O!l3vO~P()tO)q4bO!U&oX!h&oX~O!h4cO!U*YX~O!U4eO~Ob4gOm$qO&m!RO(x$pO~O!T(^O]&kie&kim&kis&kit&kiu&kiv&kiw&kix&kiy&kiz&ki!O&ki!V&ki!r&ki!s&ki!t&ki!u&ki!v&ki!x&ki!{&ki%v&ki&r&ki&s&ki(x&ki)Z&ki)]&ki)^&ki)`&ki[&ki!X&ki!Y&ki![&ki!^&ki!_&ki!a&ki!b&ki!e&ki!f&ki!h&ki({&ki(}&ki)O&ki)[&ki)_&ki)a&ki!g&ki)q&ki!W&kiQ&ki!d&ki!U&ki#v&ki~O(|&ki~P(+UO(|.|O~P(+UO[4jO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO[4jO~O[4kO~O]$PO!T$YO!V'Zi!X'Zi!Y'Zi!['Zi!^'Zi!_'Zi!a'Zi!b'Zi!e'Zi!f'Zi!h'Zi({'Zi(}'Zi)O'Zi)Z'Zi)['Zi)]'Zi)^'Zi)_'Zi)`'Zi)a'Zi!g'Zi)q'Zi['Zi!W'Zi(|'Zi!U'ZiQ'Zi!d'Zi~OPmOb%SOm;UO!X!XO!Y!WO!i!YO#V#QO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x$zO)a!ZO)cXO)ocO)pdO]#]aq#]a!T#]a!V#]a)Z#]a)]#]a)^#]a~O(x%pO)a4pO[*bP~OS(vO'f4rO(q#]O*`(uO~O*`4sO~OmnXqoXq&wX~Oe4uO%Y*YO)P/eO~Oe4uO%Y*YO)P4vO~O!h/kO[(ya~O!W4zO~O]&eO!V+pO!T%uq#v%uq)`%uq)q%uq~O]$PO!T$YO!X'Zq!Y'Zq!['Zq!^'Zq!_'Zq!a'Zq!b'Zq!e'Zq!f'Zq!h'Zq({'Zq(}'Zq)O'Zq)Z'Zq)['Zq)]'Zq)^'Zq)_'Zq)`'Zq)a'Zq!g'Zq)q'Zq['Zq!W'Zq(|'Zq!U'ZqQ'Zq!d'Zq~O!V'Zq~P(6dO!V/UO&r#WO&s$yO~P(6dO!T$YO!V)wO(})xO!U(VX!h(VX~P!KVO!h/vO!U)ya~O!W5SO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h*nO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!U5WO~P&7rO!W5WO~P&7rO[5WO~P&7rO[5]O~P&7rO]5^O!h'va)V'va)a'va~O!h*TO)V)Xi)a)Xi~O]&eO!V&dO[#Qq!T#Qq!h#Qq#v#Qq)`#Qq)q#QqQ#Qq!d#Qq(|#Qq~O[riQri!dri!hri)ari)`ri~P#IyO]&eO!V+pO[riQri!dri!hri)ari)`ri~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!h'Tq)`'Tq!g'Tq)q'Tq['Tq!W'Tq(|'Tq!U'TqQ'Tq!d'Tq~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!W'}a!h'}a~P#4YO!W5cO~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h5dO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`#lO)a$OO!U)yX~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!h#{i)`#{i~P#4YO]*{O!T$YO!V&dO)q*wO!h(Wa)`(Wa~O!h1nO[)kX]'dX~P%3`O)a5fO!T%qa!h%qa#v%qa)q%qa~O!h0{O!T*Sa#v*Sa)q*Sa~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`5iO)a$OO~P#4YO]1[Oe!POm;fO!V1YO!{!dO%v$oO(x$zO)Z<SO)]5kO)^5kO~OQ#Pa!d#Pa!h#Pa[#Pa~P(ElO]1[Oe!POs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!V1YO!{!dO!|%TO%v$oO(x$zOQ#kX!d#kX!h#kX[#kX~Om%dO)Z1SO)]<TO)^<TO~P(FnO]&eOQ#Pa!d#Pa!h#Pa[#Pa~O!V&dO)q5oO~P(H]O(x%pOQ#dX!d#dX!h#dX[#dX~O)]<TO)^<TOQ#nX!d#nX!h#nX[#nX~P'!]O!V+pO~P(H]O]1[Ob!TOe!POm;gO|#RO!V1YO!{!dO#a#VO#b#TO%e#UO%l#SO%v$oO&m!RO&r#WO&s!TO(x;[O)WYO)Z<SO)]5kO)^5kO)a+sO[)kP~P&@lO!h1]OQ)sa!d)sa~Oq&hO)q5tOQ#`am)TX!d#`a!h#`a)a)TX~P$GhO(x-]OQ#ga!d#ga!h#ga~Oq&hO)q5tOQ#`a])eXe)eXm)eXs)eXt)eXu)eXv)eXw)eXx)eXy)eXz)eX!O)eX!T)eX!V)eX!d#`a!h#`a!l)eX!r)eX!s)eX!t)eX!u)eX!v)eX!x)eX!{)eX%v)eX&r)eX&s)eX(x)eX(|)eX)Z)eX)])eX)^)eX)a)eX~O#a5wO#b5wO~O]&eO!V+pO[#ki!T#ki#v#ki)`#ki)q#kiQ#ki!d#ki!h#ki)a#ki!x#ki(|#ki~O!W5yO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!W5yO~P!(}O!W5yO)Z5{O~P$&OO]#ji!T#ji!V#ji[#ji#v#ji)`#ji)q#jiQ#ji!d#ji!h#ji)a#ji!x#ji(|#ji~P$!WO)WYO)a5}O~P8}O!h1nO[)ka~O&r#WO&s$yO!T#qa!x#qa#v#qa(|#qa)q#qa[#qa!h#qa)`#qaQ#qa!d#qa)a#qa~P#NsO[6SO~P!(}O[)vP~P!4{O)[6YO)]6WO]#Ua!T#Ua!V#Ua)Z#Ua)^#Uas#Uat#Uau#Uav#Uaw#Uax#Uay#Uaz#Ua!l#Ua!x#Ua#T#Ua#V#Ua#p#Ua#v#Ua(|#Ua)O#Ua)q#Uab#Uae#Uam#Ua|#Ua!O#Ua!o#Ua!r#Ua!s#Ua!t#Ua!u#Ua!v#Ua!{#Ua#a#Ua#b#Ua#i#Ua#t#Ua${#Ua%c#Ua%e#Ua%k#Ua%l#Ua%o#Ua%v#Ua&m#Ua&r#Ua&s#Ua(x#Ua)W#Ua)`#Ua[#Ua!h#UaQ#Ua!d#Ua~O!x!cO]#Rq!T#Rq!V#Rq#v#Rq(|#Rq)q#Rq[#Rq!h#Rq)`#RqQ#Rq!d#Rq~O!W6_O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!W6_O~P!(}O!h2UOQ)Qa!d)Qa~O)`6dO~Om-lO!TxO)q6eO~O]*{O!T$YO!V&dO!h*yO)`)xX~O)q6iO~P),eO[6kO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h#kO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO[6kO~O$c6mOP$_q]$_qb$_qe$_qm$_qs$_qt$_qu$_qv$_qw$_qx$_qy$_qz$_q|$_q!O$_q!T$_q!V$_q!X$_q!Y$_q!i$_q!o$_q!r$_q!s$_q!t$_q!u$_q!v$_q!x$_q!{$_q#V$_q#a$_q#b$_q#i$_q#p$_q#t$_q#v$_q$R$_q$T$_q$Y$_q$Z$_q$`$_q$e$_q$g$_q$h$_q$k$_q$m$_q$o$_q$q$_q$s$_q$u$_q$w$_q${$_q$}$_q%U$_q%_$_q%`$_q%a$_q%c$_q%e$_q%g$_q%l$_q%o$_q%v$_q%|$_q&m$_q&r$_q&s$_q'Q$_q'R$_q'V$_q'Y$_q'a$_q'b$_q(m$_q(v$_q(x$_q)W$_q)Z$_q)]$_q)^$_q)`$_q)a$_q)c$_q)o$_q)p$_q!U$_q~O)`6nO~OPmO]$gOb!]Om;VO|#RO!V$hO!X!XO!Y!WO!i!YO#V#QO#a#VO#b#TO%_#ZO%`#[O%a#YO%e#UO%l#SO%v$oO&m!RO&r#WO&s!TO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x;XO)Z$mO)^$mO)`6pO)a!ZO)cXO)ocO)pdO~P&@lO(|6rO)q*wO~P),eO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`6pO)a$OO~P#4YO[6tO~P!(}O)`6xO~O)`6yO~O]-aOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!{!dO(x-]O)Z-^O~O]&eO!V3PO!h%Oa)`%Oa[%Oa~O!W7PO)Z7QO~P$&OO!h3QO)`)|a~O[7TO]&eO!V3PO~O!TxO$`!iO$e!jO$g!kO$h!lO$k-iO$m!nO$o!oO$q!pO$s!qO$u!rO$w!sO$}!uO(x:xOe$Xq!o$Xq!{$Xq#i$Xq#p$Xq#t$Xq#v$Xq$R$Xq$T$Xq$Y$Xq$Z$Xq${$Xq%U$Xq%c$Xq%g$Xq%o$Xq%|$Xq(m$Xq)]$Xq!U$Xq$c$Xq~P$0yOPmO]$gOb!]Om;VO|#RO!V$hO!X!XO!Y!WO!i!YO#V#QO#a#VO#b#TO%_#ZO%`#[O%a#YO%e#UO%l#SO%v$oO&m!RO&r#WO&s!TO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x;XO)WYO)Z$mO)^$mO)`7VO)a!ZO)cXO)ocO)pdO~P&@lO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`7YO)a$OO~P#4YO)`7ZO~OP7[O(vQO~Om*aO)`)eX~P$GhOq&hOm)TX)`)eX~P$GhO)`7^O~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO)`&Sa~P#4YO!U7`O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO)`7aO~OPmO]$gOb!]Om;WO|#RO!V$hO!X!XO!Y!WO!i!YO#V#QO#a#VO#b#TO%_#ZO%`#[O%a#YO%e#UO%l#SO%v$oO&m!RO&r#WO&s!TO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x;_O)WYO)Z$mO)^$mO)a0vO)cXO)ocO)pdO[)kP~P&@lO!h3zO)a7eO!T)fa~O!h3zO!T)fa~O)`7jO)q7lO~P('fO)`7nO~PGYO]4UOm)QOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!{!dO!|%TO%v$oO&r#WO(x)PO)Z4RO)]4VO)^4VO~O)Z7rO~O]&eO!T*vO!V7tO!h7uO#v!eO(|4YO~O)`7jO)q7wO~P)GyO]4UOm)QO!{!dO%v$oO&r#WO(x)PO)Z4RO)]4VO)^4VO~Oq&hO])jX!T)jX!V)jX!h)jX#v)jX(|)jX)`)jX)q)jX[)jX~O)`7jO~O!T(TO!l7}O(|(SO])Uie)Uim)Uis)Uit)Uiu)Uiv)Uiw)Uix)Uiy)Uiz)Ui!O)Ui!V)Ui!r)Ui!s)Ui!t)Ui!u)Ui!v)Ui!x)Ui!{)Ui%v)Ui&r)Ui&s)Ui(x)Ui)Z)Ui)])Ui)^)Ui)`)Ui[)Ui!X)Ui!Y)Ui![)Ui!^)Ui!_)Ui!a)Ui!b)Ui!e)Ui!f)Ui!h)Ui({)Ui(})Ui)O)Ui)[)Ui)_)Ui)a)Ui!g)Ui)q)Ui!W)UiQ)Ui!d)Ui!U)Ui#v)Ui~O(x%pO!U(hX!h(hX~O!h4cO!U*Ya~Oq&hO]*Xae*Xam*Xas*Xat*Xau*Xav*Xaw*Xax*Xay*Xaz*Xa!O*Xa!T*Xa!V*Xa!r*Xa!s*Xa!t*Xa!u*Xa!v*Xa!x*Xa!{*Xa%v*Xa&r*Xa&s*Xa(x*Xa)Z*Xa)]*Xa)^*Xa)`*Xa[*Xa!X*Xa!Y*Xa![*Xa!^*Xa!_*Xa!a*Xa!b*Xa!e*Xa!f*Xa!h*Xa({*Xa(}*Xa)O*Xa)[*Xa)_*Xa)a*Xa!g*Xa)q*Xa!W*XaQ*Xa!d*Xa(|*Xa!U*Xa#v*Xa~O!T(^O]&kqe&kqm&kqs&kqt&kqu&kqv&kqw&kqx&kqy&kqz&kq!O&kq!V&kq!r&kq!s&kq!t&kq!u&kq!v&kq!x&kq!{&kq%v&kq&r&kq&s&kq(x&kq)Z&kq)]&kq)^&kq)`&kq[&kq!X&kq!Y&kq![&kq!^&kq!_&kq!a&kq!b&kq!e&kq!f&kq!h&kq({&kq(}&kq)O&kq)[&kq)_&kq)a&kq!g&kq)q&kq!W&kqQ&kq!d&kq(|&kq!U&kq#v&kq~OPmOb%SOm;UO!T$YO!i!YO#V#QO%_#ZO%`#[O%a#YO%v$oO'Q!WO'R!WO'V#XO'Y![O'a![O'b![O(vQO(x$zO)cXO)ocO)pdO~O]*^i!V*^i!X*^i!Y*^i![*^i!^*^i!_*^i!a*^i!b*^i!e*^i!f*^i!h*^i({*^i(}*^i)O*^i)Z*^i)[*^i)]*^i)^*^i)_*^i)`*^i)a*^i!g*^i)q*^i[*^i!W*^i(|*^i!U*^iQ*^i!d*^i~P*'YO[8SO~O!W8TO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!h'^q)`'^q!g'^q)q'^q['^q!W'^q(|'^q!U'^qQ'^q!d'^q~P#4YO!h8UO[*bX~O[8WO~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!h_y)`_y!g_y)q_y[_y!W_y(|_y!U_yQ_y!d_y~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO[(ja!h(ja~P#4YO]$PO!T$YO!V'Zy!X'Zy!Y'Zy!['Zy!^'Zy!_'Zy!a'Zy!b'Zy!e'Zy!f'Zy!h'Zy({'Zy(}'Zy)O'Zy)Z'Zy)['Zy)]'Zy)^'Zy)_'Zy)`'Zy)a'Zy!g'Zy)q'Zy['Zy!W'Zy(|'Zy!U'ZyQ'Zy!d'Zy~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!h'^y)`'^y!g'^y)q'^y['^y!W'^y(|'^y!U'^yQ'^y!d'^y~P#4YO]&eO!V+pO!T%uy#v%uy)`%uy)q%uy~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!U(Va!h(Va~P#4YO!W5SO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!U#}i!h#}i~P#4YO!U8ZO~P&7rO!W8ZO~P&7rO[8ZO~P&7rO[8]O~P&7rO]&eO!V&dO[#Qy!T#Qy!h#Qy#v#Qy)`#Qy)q#QyQ#Qy!d#Qy(|#Qy~O]&eO!V+pO[rqQrq!drq!hrq)arq)`rq~O]&eOQ#Pi!d#Pi!h#Pi[#Pi~O!V+pO~P*:gOQ#nX!d#nX!h#nX[#nX~P(ElO!V&dO~P*:gOQ(PX](PXe'rXm'rXs(PXt(PXu(PXv(PXw(PXx(PXy(PXz(PX!V(PX!d(PX!h(PX!{'rX%v'rX(x'rX)Z(PX)](PX)^(PX[(PX~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OOQ#_i!d#_i!h#_i[#_i~P#4YO&r#WO&s$yOQ#fi!d#fi!h#fi~O(x-]O)a1bO)q1aOQ#`X!d#`X!h#`X~O!W8bO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!W8bO~P!(}O!T#qi!x#qi#v#qi(|#qi)q#qi[#qi!h#qi)`#qiQ#qi!d#qi)a#qi~O]&eO!V+pO~P*@cO]&[O!V&YO&r#WO&s$yO)Z&XO)]&]O)^&]O~P*@cO[8dO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!h8eO[)vX~O[8gO~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OOQ*]X!d*]X!h*]X~P#4YO)a8jOQ*[X!d*[X!h*[X~O)`8lO~O[$bi!h#{a)`#{a~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`8oO)a$OO~P#4YO[8qO~P!(}O[8qO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h#kO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO[8qO~O]&eO!V&dO(|8wO~O)`8xO~O]&eO!V3PO!h%Oi)`%Oi[%Oi~O!W8{O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!W8{O)Z8}O~P$&OO!W8{O~P!(}O]&eO!V3PO!h(Za)`(Za~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h#kO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`9OO)a$OO~P#4YO)`2qO~P!(}O)`9OO~OP%qO[9PO(vQO~O[9PO~O)`9QO~P%%{O#T9TO)O.WO)`9RO~O!h3zO!T)fi~O)a9XO!T'xa!h'xa~O)`9ZO)q9]O~P)GyO)`9ZO~O)`9ZO)q9aO~P('fOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O~P)HiO]&eO!V7tO!T!ya!h!ya#v!ya(|!ya)`!ya)q!ya[!ya~O!W9hO)Z9iO~P$&OO!T$YO!h7uO(|4YO)`9ZO)q9aO~O!T$YO~P#EtO[9lO]&eO!V7tO~O]&eO!V7tO!T&aa!h&aa#v&aa(|&aa)`&aa)q&aa[&aa~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO)`&ba~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`9ZO)a$OO~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!U&oi!h&oi~P#4YO!V/UO]']i!T']i!X']i!Y']i![']i!^']i!_']i!a']i!b']i!e']i!f']i!h']i({']i(}']i)O']i)Z']i)[']i)]']i)^']i)_']i)`']i)a']i!g']i)q']i[']i!W']i(|']i!U']iQ']i!d']i~O(x%pO)a9oO~O!h8UO[*ba~O[9qO~P&7rO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h#kO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO!U(Va)`#Zi~P#4YO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OOQ#_q!d#_q!h#_q[#_q~P#4YO&r#WO&s$yOQ#fq!d#fq!h#fq~O)q5tOQ#`a!d#`a!h#`a~O]&eO!V+pO!T#qq!x#qq#v#qq(|#qq)q#qq[#qq!h#qq)`#qqQ#qq!d#qq)a#qq~O!h8eO[)va~O)]6WO]&Vi!T&Vi!V&Vi)Z&Vi)[&Vi)^&Vis&Vit&Viu&Viv&Viw&Vix&Viy&Viz&Vi!l&Vi!x&Vi#T&Vi#V&Vi#p&Vi#v&Vi(|&Vi)O&Vi)q&Vib&Vie&Vim&Vi|&Vi!O&Vi!o&Vi!r&Vi!s&Vi!t&Vi!u&Vi!v&Vi!{&Vi#a&Vi#b&Vi#i&Vi#t&Vi${&Vi%c&Vi%e&Vi%k&Vi%l&Vi%o&Vi%v&Vi&m&Vi&r&Vi&s&Vi(x&Vi)W&Vi)`&Vi[&Vi!h&ViQ&Vi!d&Vi~O)`9tO~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO[$bq!h#{i)`#{i~P#4YO[9vO~P!(}O[9vO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h#kO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO[9vO~O]&eO!V&dO(|9yO~O[9zO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO[9zO~O]&eO!V3PO!h%Oq)`%Oq[%Oq~O!W:OO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!W:OO~P!(}O)`6pO~P!(}O)`:PO~O)`:QO~O)O.WO)`:QO~O!h3zO!T)fq~O)a:SO!T'xi!h'xi~O!T$YO!h7uO(|4YO)`:TO)q:VO~O)`:TO~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`:TO)a$OO~P#4YO)`:TO)q:YO~P)GyO]&eO!V7tO!T!yi!h!yi#v!yi(|!yi)`!yi)q!yi[!yi~O!W:^O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!W:^O)Z:`O~P$&OO!W:^O~P!(}O]&eO!V7tO!T(fa!h(fa(|(fa)`(fa)q(fa~O[:bO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O!h#kO({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO[:bO~O[:gO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO[:gO~O]&eO!V3PO!h%Oy)`%Oy[%Oy~O)`:hO~O)`:iO~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`:iO)a$OO~P#4YO!T$YO!h7uO(|4YO)`:iO)q:lO~O]&eO!V7tO!T!yq!h!yq#v!yq(|!yq)`!yq)q!yq[!yq~O!W:nO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO!W:nO~P!(}O[:pO!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)a$OO~P#4YO[:pO~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`:rO)a$OO~P#4YO)`:rO~O]&eO!V7tO!T!yy!h!yy#v!yy(|!yy)`!yy)q!yy[!yy~O!Y#sO![#tO!^#wO!_#xO!a#zO!b#{O!e#{O!f#|O({#hO)Z#oO)[#qO)]#pO)^#rO)_#jO)`:vO)a$OO~P#4YO)`:vO~O]ZXmhXqZXqjX!TjX!VZX!XZX!YZX![ZX!^ZX!_ZX!aZX!bZX!eZX!fZX!gZX!hZX({ZX(|$]X(}ZX)OZX)ZZX)[ZX)]ZX)^ZX)_ZX)`ZX)aZX)qZX~O]%WXmnXqoXq%WX!ToX!V%WX!X%WX!Y%WX![%WX!^%WX!_%WX!a%WX!b%WX!e%WX!f%WX!gnX!h%WX({%WX(}%WX)O%WX)Z%WX)[%WX)]%WX)^%WX)_%WX)a%WX)qnX[%WXQ%WX!d%WX~O)`%WX!W%WX(|%WX!U%WX~P+HoO]oX]%WXeoXmnXqoXq%WXsoXtoXuoXvoXwoXxoXyoXzoX!OoX!VoX!V%WX!roX!soX!toX!uoX!voX!xoX!{oX%voX&roX&soX(xoX)ZoX)]oX)^oX[oX[%WX!hoX)aoX~O)`oX)qoX~P+KPO]%WXmnXqoXq%WX!V%WX!h%WXQ%WX!d%WX[%WX~O!T%WX#v%WX)`%WX)q%WX(|%WX~P+MjOQoXQ%WX!ToX!X%WX!Y%WX![%WX!^%WX!_%WX!a%WX!b%WX!doX!d%WX!e%WX!f%WX!gnX!h%WX({%WX(}%WX)O%WX)Z%WX)[%WX)]%WX)^%WX)_%WX)a%WX)qnX~P+KPO]oX]%WXmnXqoXq%WXsoXtoXuoXvoXwoXxoXyoXzoX!OoX!V%WX!roX!soX!toX!uoX!voX!xoX!{oX%voX&roX&soX(xoX)ZoX)]oX)^oX~O!ToX(|oX)`oX)qoX~P,!bOmnXqoX!h%WX)`%WX~OeoX!VoX)`%WX~P,!bOe)tO%Y)uO)P:yO~Oe)tO%Y)uO)P;OO~Oe)tO%Y)uO)P:zO~Oe$TO%Y*YO'[$VO'_$WO)P:yO~Oe$TO%Y*YO'[$VO'_$WO)P:{O~Oe$TO%Y*YO'[$VO'_$WO)P:}O~O[jX]jXsjXtjXujXvjXwjXxjXyjXzjX!VjX&rjX&sjX)ZjX)]jX)^jXejX!OjX!rjX!sjX!tjX!ujX!vjX!xjX!{jX%vjX(xjX~P#1xO]ZXmhXqZXqjX!VZX!hZX)`ZX)qZX~O!TZX#vZX(|ZX~P,({OmhXqjX!hZX)WjX)`ZX)qjX~O]ZX]jXejXmhXqZXqjXsjXtjXujXvjXwjXxjXyjXzjX!OjX!VZX!VjX!rjX!sjX!tjX!ujX!vjX!xjX!{jX%vjX&rjX&sjX(xjX)ZjX)]jX)^jX[ZX[jX!hjX)ajX)qjX~O)`ZX~P,*YO]ZX]jXmhXqZXqjXsjXtjXujXvjXwjXxjXyjXzjX!TjX!VZX!VjX!XZX!YZX![ZX!^ZX!_ZX!aZX!bZX!eZX!fZX!gZX!hZX!hjX&rjX&sjX({ZX(}ZX)OZX)ZZX)ZjX)[ZX)]ZX)]jX)^ZX)^jX)_ZX)aZX)ajX)qZX~OQZXQjX!dZX!djX~P,,sO]jXejXsjXtjXujXvjXwjXxjXyjXzjX!OjX!VjX!rjX!sjX!tjX!ujX!vjX!xjX!{jX%vjX&rjX&sjX(xjX)ZjX)]jX)^jX~P#1xO[ZX[jXejX!OjX!rjX!sjX!tjX!ujX!vjX!xjX!{jX%vjX(xjX)qjX~P,,sO]ZX]jXmhXqZXqjXsjXtjXujXvjXwjXxjXyjXzjX!OjX!VZX!rjX!sjX!tjX!ujX!vjX!xjX!{jX%vjX&rjX&sjX(xjX)ZjX)]jX)^jX)`jX~O!TjX(|jX)qjX~P,2uOejX!VjX~P,2uOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O~PBXOe$TO%Y*YO)P:yO~Oe$TO%Y*YO)P:zO~Oe$TO%Y*YO)P;PO~Oe$TO%Y*YO)P;QO~O]%jOe!POm%dOs!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O!V%mO!{!dO!|%TO%v$oO(x$zO)Z;kO)];lO)^;lO~O]%jOe!POm%dO!V%mO!{!dO%v$oO(x$zO)Z;kO)];lO)^;lO~Oe$TO%Y$UO)P:zO~Oe$TO%Y$UO)P;OO~Om;TO~Om;SO~O]dXmhXqjX!TdX~Oe)tO%Y*YO)P:yO~Oe)tO%Y*YO)P:zO~Oe)tO%Y*YO)P:{O~Oe)tO%Y*YO)P:|O~Oe)tO%Y*YO)P:}O~Oe)tO%Y*YO)P;PO~Oe)tO%Y*YO)P;QO~Os!^Ot!^Ou!^Ov!^Ow!^Ox!^Oy!^Oz!^O~P,8VO])TXs)TXt)TXu)TXv)TXw)TXx)TXy)TXz)TX!O)TX!r)TX!s)TX!t)TX!u)TX!v)TX!x)TX!{)TX%v)TX&r)TX&s)TX(x)TX)Z)TX)])TX)^)TX)q)TX~Om;SO!T)TX(|)TX)`)TX~P,<UO]&wXmnXqoX!T&wX~Oe4uO%Y*YO)P<OO~Om;fO)Z<SO)]5kO)^5kO~P(FnOe!POm%dO!{!dO%v$oO(x$zO~O]1[O!V1YO)Z1SO)]<TO)^<TOQ#nX!d#nX!h#nX[#nX~P,?QO)Z;dO~Om;rO~Om;sO~Om;tO~Om;vO~Om;wO~Om;xO~Om;vO!T$YOQ)TX!d)TX!h)TX)a)TX[)TX)q)TX~P$GhOm;tO!T$YO~P$GhOm;rO!g$[O)q$[O~Om;tO!g$[O)q$[O~Om;vO!g$[O)q$[O~Om;sO[)TX!h)TX)a)TX)q)TX~P$GhOe/fO%Y*YO)P<OO~Om<PO~O)Z<dO~OV'e'h'i'g(v)c!R(xS(q%Z!Y!['je%[!i'R!f]'f*c'k(}!^!_'l'm'l~",
    goto: "%8g*cPPPPP*d*qP*tPP.jPP5P8Q8Q;[P;[>fP?P?c?wFpMq!&v!-_P!4Y!4}!5rP!6^PPPPPPPP!6wP!8aP!9r!;[P!;bPPPPPP!;eP!;ePP!;ePP!;qPPPPPP!=s!AZP!A^PP!Az!BoPPPPP!BsP?S!DUPP?S!F]!H^!Hl!JR!KrP!K}P!L^!L^# n#$}#&e#)q#,{!H^#-VPP!H^#-^#-d#-V#-V#-gP#-k#.Y#.Y#.Y#.Y!KrP#.s#/U#1kP#2PP#3lP#3p#3x#4m#4x#7W#7`#7`#3pP#3pP#7g#7mP#7wPP#8d#9R#9s#8dP#:e#:qP#8dP#8dPP#8d#8dP#8dP#8dP#8dP#8dP#8dP#8dP#:t#7w#;bP#;wP#<^#<^#<^#<^#<k#3pP#=R#BO#BmPPPPPPPP#CeP#CsP#CsP#DP#G^#;mPP#Cm#GpP#HT#H`#Hf#Hf#Cm#I[P#3p#3p#3p#3p#3pP!L^#Iv#I}#I}#I}#JR# h#J]# h#Ja!Hl!Hl!Hl#Jd#N|!Hl?S?S?S$%u!Bo!Bo!Bo!Bo!Bo!Bo!6w!6w!6w$&YP$'u$(T!6w$(ZPP!6w$*i$*l#C[$*o;[8Q$-u$/p$1a$3P8QPP8Q$4s8QP8Q8QP8QP$7y8QP8QPP8Q$8VPPPPPPPPP*qP$;_$;e$;k$>S$@Y$@`$@v$AQ$A]$Al$Ar$CQ$DP$DW$D_$De$Dm$Dw$D}$EY$E`$Ei$Eq$E|$FS$F^$Fd$Fn$Ft$F{$G[$Gb$GhP$Gn$Gv$G}$H]$Iy$JP$JV$J^$JjPPPPPPPPPPPP$Jp$JtPPPPP%#v$*i%#y%'R%)ZPP%)h%)kPPPPPPPPPP%)w%*z%+Q%+U%,{%.Y%.{%/S%1c%1iPPP%1s%2O%2R%2X%3`%3c%3m%3w%3{%5P%5r%5x#CeP%6c%6i%6y%6|%7^%7j%7n%7t%7z$*i$*l$*l%7}%8QP%8a%8dQ#dPa(s#b(p(q(r(t/]/_4rR#dP'`mO[aefwx{!W!X!g!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$g$h$m%_%o&S&U&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*v*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:pU%qm%r7[Q&o!`Q(p#^d0X*S0U0V0W0Z5X5Y5Z5^8[R7[3_b}Oaewx{!g&U*v&v$k[!W!X!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$g$h$m%_%o&S&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/X/d/k/t/v/{/}1T1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:pS%bf0p#d%lgnp|#O$i%O%P%U%f%j%k%y&u'w'x(T*_*e*g*y+b,q,{-f-w.O.m.t.v0e1R1S1W1[2g2r5k6q;b;c;d;j;k;l;y;z;{;|<Q<R<S<T<b<c<dS%sm!YS&w!h#PS'^!t'aQ'j!yQ'k!zQ(p#aQ(q#^Q(r#_Q*}%mQ,]&nQ,b&pQ-k'iQ-r'tS.y(^4cQ/n)lQ0m*rQ2Y,aQ2a,hQ2t-UQ3Y-lQ4l/TQ4p/^Q5p1VQ6f2]Q7X3ZQ8k6eQ9o8UR;e1Y$|#iS!]${%S%V%]&l&m'S'Z']'d'f(d(h(k(|(})W)X)Y)Z)[)])^)_)`)a)b)c)d)p)v)}+^+l,T,X,o,z-o-p.T/Q/x0h0j0o0q1P1h2R2i2p3]3m3n4m4n4t4w4}5P5T5U5n5z6R6`6o6s6}7U7{7|8O8^8_8m8p8t8|9_9f9u9{:W:_:d:j:sQ&r!dQ(j#ZQ(x#cQ)o$V[*x%g*]0s2h2o3VQ,c&qQ/V(iQ/](qQ/c(yS/q)n/WQ0z+VS4{/r/sR8Y4|'a![O[aefwx{!W!X!g!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$g$h$m%_%o&S&U&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*v*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:p'a!VO[aefwx{!W!X!g!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$g$h$m%_%o&S&U&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*v*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:pQ)T#mS+V%{0{Q/z)xk4X.n3}4R4U4V7m7o7p7r7u9c9d:]Q)V#mk4W.n3}4R4U4V7m7o7p7r7u9c9d:]l)U#m.n3}4R4U4V7m7o7p7r7u9c9d:]T+V%{0{[UOwx!g&U*vW$b[e$g(e#l$r_!f!u!}#R#S#T#U#V#Z$U$V$n%W&W&[&e&o'b(Q(S(X(a(j)o)u+a+f+g+y,O,^,p-P-X-v-{._.`.f.g.k.x.|1]1a1n1s1u2v3f3g3h3z4O5t6X6Z7f8e![%eg$i%f%k&u*_*y+b,q,{-f1S1W2g;b;c;d;k;l;y;z;{;|<Q<R<T<b<c<dY%unp%y-w.ml)R#m.n3}4R4U4V7m7o7p7r7u9c9d:]S;o'w.OU;p(T.t.v&|<Vaf{|!W!X!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$h$m%O%P%U%_%j%o&S&Y&d&{'O'Q'l'm'x'|(c(l)q)w*e*g*m*n*q*w+]+_+m+o+p,U,W,s,v-n.W.X.]/U/X/d/k/t/v/{/}0e0p1R1T1Y1i1j1t1x2S2k2q2r3P4Y4]4b4k5d5k5o5{6i6m6p6q6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:p;j<SQ<W1[d<X&z'R'e,|-d-e-h2n3U3XW<Y&h*{2U3s^<Z!t'a'i,a-U2]6eQ<[#OT<g%{0{[VOwx!g&U*vW$c[e$g(eQ$r.|!j$s_!f!u!}#V#Z$U$V$n%W&W&[&e&o'b(j)o)u+a+f+y,^,p-P-X-v.k1]1a1n1s1u2v4O5t8e&^$|af{!W!X!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$h$m%_%o&S&Y&d&{'O'Q'l'm'|(c(l)q)w*m*n*q*w+]+_+m+o+p,U,W,s,v-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2k2q3P4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:p![%eg$i%f%k&u*_*y+b,q,{-f1S1W2g;b;c;d;k;l;y;z;{;|<Q<R<T<b<c<dY%unp%y-w.mQ'u#O|(P#R#S#T#U(Q(S(X(a+g,O._.`.f.g.x3f3g3h3z6X6Z7fl)R#m.n3}4R4U4V7m7o7p7r7u9c9d:]S-u'w.OQ3b-{U;}(T.t.vn<V|%O%P%U%j'x*e*g0e1R2r5k6q;j<S^<Z!t'a'i,a-U2]6eW<]&h*{2U3sd<^&z'R'e,|-d-e-h2n3U3XQ<e1[T<g%{0{!Q!UO[ewx!g$g&U&h&z'R'e(e*v*{,|-d-e-h2U2n3U3X3s!v$v_!f!u!}#O#V#Z$U$V$n%W&W&[&e&o'b'w(T(j)o)u+a+y,^,p-P-X-v.O.k.t.v1[1]1a1n1s1u2v4O5t8e&^%Raf{!W!X!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$h$m%_%o&S&Y&d&{'O'Q'l'm'|(c(l)q)w*m*n*q*w+]+_+m+o+p,U,W,s,v-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2k2q3P4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:p$S%ngnp|#m$i%O%P%U%f%j%k%y%{&u'a'i'x*_*e*g*y+b,a,q,{-U-f-w.m.n0e0{1R1S1W2]2g2r3}4R4U4V5k6e6q7m7o7p7r7u9c9d:];b;c;d;j;k;l;y;z;{;|<Q<R<S<T<b<c<dQ'_!tz(R#R#S#T#U(Q(S(X(a,O._.`.f.g.x3f3g3h3z6X6Z7ff-b'c-[-^-a2z2{2}3Q6{6|8zQ1`+fQ1c+gQ2s-OQ3c-{Q4f.|Q5v1bR8a5w!Q!UO[ewx!g$g&U&h&z'R'e(e*v*{,|-d-e-h2U2n3U3X3s!x$v_!f!u!}#O#V#Z$U$V$n%W&W&[&e&o'b'w(T(j)o)u+a+f+y,^,p-P-X-v.O.k.t.v1[1]1a1n1s1u2v4O5t8e&^%Raf{!W!X!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$h$m%_%o&S&Y&d&{'O'Q'l'm'|(c(l)q)w*m*n*q*w+]+_+m+o+p,U,W,s,v-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2k2q3P4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:p$U%ngnp|!t#m$i%O%P%U%f%j%k%y%{&u'a'i'x*_*e*g*y+b,a,q,{-U-f-w.m.n0e0{1R1S1W2]2g2r3}4R4U4V5k6e6q7m7o7p7r7u9c9d:];b;c;d;j;k;l;y;z;{;|<Q<R<S<T<b<c<d|(R#R#S#T#U(Q(S(X(a+g,O._.`.f.g.x3f3g3h3z6X6Z7fQ3c-{R4f.|[WOwx!g&U*vW$d[e$g(e#l$r_!f!u!}#R#S#T#U#V#Z$U$V$n%W&W&[&e&o'b(Q(S(X(a(j)o)u+a+f+g+y,O,^,p-P-X-v-{._.`.f.g.k.x.|1]1a1n1s1u2v3f3g3h3z4O5t6X6Z7f8e![%eg$i%f%k&u*_*y+b,q,{-f1S1W2g;b;c;d;k;l;y;z;{;|<Q<R<T<b<c<dY%unp%y-w.ml)R#m.n3}4R4U4V7m7o7p7r7u9c9d:]S;o'w.OU;p(T.t.vn<V|%O%P%U%j'x*e*g0e1R2r5k6q;j<SQ<W1[^<Z!t'a'i,a-U2]6eQ<[#O&^<_af{!W!X!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$h$m%_%o&S&Y&d&{'O'Q'l'm'|(c(l)q)w*m*n*q*w+]+_+m+o+p,U,W,s,v-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2k2q3P4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:pd<`&z'R'e,|-d-e-h2n3U3XW<a&h*{2U3sT<g%{0{p$RT$a$q%d%t)Q;U;V;W;f;g;h;i;m;n<fo)r$X*Z*a/g;R;S;T;r;s;t;u;v;w;x<Pp$ST$a$q%d%t)Q;U;V;W;f;g;h;i;m;n<fo)s$X*Z*a/g;R;S;T;r;s;t;u;v;w;x<P^&g}!O$k$l%b%l;ed&k!U$v%R%n'_(R1`1c3c4fV/i)T)U4XS%[e$gQ,Y&hQ/S(eQ2w-XQ6T1uQ6a2UQ6w2vR9r8e#}!TO[_ewx!f!g!u!}#O#V#Z$U$V$g$n%W&U&W&[&e&h&o&z'R'b'e'w(T(e(j)o)u*v*{+a+f+y,^,p,|-P-X-d-e-h-v-{.O.k.t.v1[1]1a1n1s1u2U2n2v3U3X3s4O5t8e#[^O[_`wx!f!g!}#O$U$f$n$u$w&U&W&[&e&o&t&z'R'e'w(T)u*b*v*{+a,^,p,|-P-d-e-h-v-{.O.k.t.v1[1]1n2n3U3X3s4O_(X#R#S#T+g3f3g3h#}ZO[wx!g!k#R#S#T%o&U&W&[&e&o&y&z&{'O'Q'R'_'e'w'{(Q(S(T(X*v*{+a+g,^,m,p,v-W-d-e-h-v-{.O.R.f.k.t.x1[1]1n2k2s3U3X3f3g3h3s6m6t8q9v9z:b:g:pQ$_YR0]*TR*V$_e0X*S0U0V0W0Z5X5Y5Z5^8[$f#{S%V%]'S'Z']'d'f(k(|(})W)Z)[)])^)_)`)c)d)p)v)}+^+l,T,X,o,z-o-p.T/Q/x0h0j0o0q1P1h2R2i2p3]3m3n4m4n4t4w4}5P5T5U5n5z6R6`6o6s6}7U7{7|8O8^8_8m8p8t8|9_9f9u9{:W:_:d:j:se0X*S0U0V0W0Z5X5Y5Z5^8['`!YO[aefwx{!W!X!g!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$g$h$m%_%o&S&U&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*v*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:pe0X*S0U0V0W0Z5X5Y5Z5^8[R5_0]^(W#R#S#T+g3f3g3hY.d(Q(U(X(Y7_U3u.b.e.xS7c3v4aR9m7}^(V#R#S#T+g3f3g3h[.c(Q(U(W(X(Y7_W3t.b.d.e.xU7b3u3v4aS9U7c7}R:a9mT.r(T.td]Owx!g&U'w(T*v.O.t!v^[_`!f!}#O$U$f$n$u$w&W&[&e&o&t&z'R'e)u*b*{+a,^,p,|-P-d-e-h-v-{.k.v1[1]1n2n3U3X3s4OQ%vnT1},S2O!jbOaenpwx{|!g#O%O%P%U%j%y&U'w'x(T*e*g*v-w.O.m.t.v0e1R1[2r5k6q;j<Sf-_'c-[-^-a2z2{2}3Q6{6|8zj4S.n3}4R4U4V7m7o7p7r7u9c9d:]r<Ug$i%f%k&u*_*y,q,{-f2g;b;c;d;y;{<Qi<h+b1S1W;k;l;z;|<R<T<b<c<d!O&`y%Z&X&[&]'n)m*i*k+b+j+}/u0f1R1S1W1[1r5k6Q<S<Tz&cz%Q%Y%g&f'v*]*d,g.P0c0d0s1U2h2o3V5a5l6v8sS(O#Q.`n+q&Z*l+k+r+u-q/p0g1Z1f5O5b5j6P8cQ2`,f^3O-`2|3S6z7R8y9}e7s4T7i7q7y7z9`9b9j:[:mS+c&W1]Y+s&[&e*{1[3sR5}1n#w!POaegnpwx{|!g#O$i%O%P%U%f%j%k%y&U&u'w'x(T*_*e*g*v*y+b,q,{-f-w.O.m.t.v0e1R1S1W1[2g2r5k6q;b;c;d;j;k;l;y;z;{;|<Q<R<S<T<b<c<d`oOwx!g&U'w*v.O#U!Paeg{|#O$i%O%P%U%f%j%k&u'x*_*e*g*y+b,q,{-f0e1R1S1W1[2g2r5k6q;b;c;d;j;k;l;y;z;{;|<Q<R<S<T<b<c<dU%xnp-wQ+S%yS.l(T.tT4Q.m.vW+w&`+q+x1kV,P&c,Q7sQ+}&bU,P&c,Q7sQ.O'wT.Z'|.]'`![O[aefwx{!W!X!g!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$g$h$m%_%o&S&U&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*v*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:pX1z,O.`6X6Z'W!VO[aefwx{!W!X!g!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|$P$W$Y$[$g$h$m%_%o&S&U&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*v*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/d/k/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:pW1z,O.`6X6ZR2m,x!WjO[wx!g!k%o&U&{'O'Q'e*v,v-d-e-h2k3U6m6t8q9v9z:b:g:pY%Xe$g(e1x3sQ'U!nS)O#k5dQ,r&zQ,}'RS.V'|.]Q2j,sQ6u2qQ7W3XQ8r6pR9w8o'W![O[aefwx{!W!X!g!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|$P$W$Y$[$g$h$m%_%o&S&U&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*v*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/d/k/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:pX1z,O.`6X6Z'ayO[aefwx{!W!X!g!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|$P$W$Y$[$g$h$m%_%o&S&U&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*v*w*{+]+_+m+o+p,O,U,W,s,v,|-d-e-h-n.W.X.].`/U/d/k/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b5d5o5{6X6Z6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:pQ&byS'w#O-|R1d+hS+c&W1]R5x1dQ1X+bR5q1WR1X+bT+c&W1]z&^%Z&X&[&]'n)m*i*k+b+j/u0f1R1S1W1[1r5k6Q<S<TQ&_yR1v+}!P&^y%Z&X&[&]'n)m*i*k+b+j+}/u0f1R1S1W1[1r5k6Q<S<TQ+z&`S,R&c7sS1l+q+xQ1|,QR5|1k!WkO[wx!g!k%o&U&{'O'Q'e*v,v-d-e-h2k3U6m6t8q9v9z:b:g:pS%|o.lS&Qq-yQ&ayQ&s!eQ'h!yQ*u%gU+Q%x%}4QS+U%z&PQ+v&_Q,_&oS,`&p'jQ,w&}S0a*],gS0w+R+SQ0y+TQ1w+}S2[,b-mQ5`0cQ5e0xQ6V1vQ6d2ZQ6g2`Q7x4TQ9^7iR:Z9`[uOwx!g&U*vQ,_&oQ-}'wQ3d-{R3i.OxlOwx!g!k%o&U&{'Q*v,v2k6m6t8q9v9z:b:g:pU$j['O-eS%|o.lS&Qq-yQ*u%gU+Q%x%}4QS+U%z&PS0a*],gS0w+R+SQ0y+TQ5`0cQ5e0xQ7x4TQ9^7iR:Z9`T,d&s,e]uOwx!g&U*v[uOwx!g&U*vQ,_&oQ,s&zQ,|'RW-g'e-d-h3UQ-}'wQ3d-{Q3i.OR7V3X[%hg$i,q,{-f2gR0t*y^$ZV!U$c$|%R<]<^Q'U!nS)e$P*{S){$Y*vQ*O$[Y*x%g*]0s2o3VQ/V(iS/q)n/WS0i*m4kS0r*w6iQ0z+VQ4[.nQ4x/kS4{/r/sS5Q/v5dQ5V/}Q6j2hU7k3}4T4]Q8Y4|Q8u6rY9[7i7l7m7v7wQ9|8wW:U9Y9]9`9aQ:e9yU:k:V:X:YR:t:lS){$Y*vT5Q/v5dZ)y$Y)z*v/v5dQ&y!hR'{#PS,l&x'yQ2d,jR6h2cxlOwx!g!k%o&U&{'Q*v,v2k6m6t8q9v9z:b:g:pV$j['O-e!XkO[wx!g!k%o&U&{'O'Q'e*v,v-d-e-h2k3U6m6t8q9v9z:b:g:p!WhO[wx!g!k%o&U&{'O'Q'e*v,v-d-e-h2k3U6m6t8q9v9z:b:g:pR'Y!q!WkO[wx!g!k%o&U&{'O'Q'e*v,v-d-e-h2k3U6m6t8q9v9z:b:g:pR,s&zQ&{!iQ&}!jQ'Q!lR,v&|R,t&zxlOwx!g!k%o&U&{'Q*v,v2k6m6t8q9v9z:b:g:pX-g'e-d-h3U[uOwx!g&U*vQ-P'RQ-}'wS.r(T.tR3i.O[uOwx!g&U*vQ-P'RW-g'e-d-h3UT.r(T.tg-b'c-[-^-a2z2{2}3Q6{6|8zylOwx!g!k%o&U&{'Q*v,v2k6m6t8q9v9z:b:g:pb!OOaewx{!g&U*v&|$l[f!W!X!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$g$h$m%_%o&S&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:p#d%lgnp|#O$i%O%P%U%f%j%k%y&u'w'x(T*_*e*g*y+b,q,{-f-w.O.m.t.v0e1R1S1W1[2g2r5k6q;b;c;d;j;k;l;y;z;{;|<Q<R<S<T<b<c<dS'^!t'aQ-k'iQ2Y,aQ2t-UQ6f2]R8k6ej$TT$a%d%t;U;V;W;f;g;h;i;m;ni)t$X*Z;R;S;T;r;s;t;u;v;w;xj$TT$a%d%t;U;V;W;f;g;h;i;m;nh)t$X*Z;R;S;T;r;s;t;u;v;w;xS/f)Q<fV4u/g/h<P[uOwx!g&U*vQ-}'wR3i.O[uOwx!g&U*vT.r(T.t'`!YO[aefwx{!W!X!g!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$g$h$m%_%o&S&U&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*v*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:pR7]3_[uOwx!g&U*vQ-}'wS.r(T.tR3i.O[pOwx!g&U*vQ%ynS-w'w.OT.m(T.tS%}o.lS+R%x4QR0x+SQ+W%{R5g0{S%|o.lS&Qq-yU+Q%x%}4QS+U%z&PS0w+R+SQ0y+TQ5e0xQ7x4TQ9^7iR:Z9``qOwx!g&U(T*v.tS%zn-wU&Pp.m.vQ+T%yT-y'w.OS'}#Q.`R.a(OT.Y'|.]S.Z'|.]Q9S7`R:R9TT6X1y8iR6Z1y#d!Pgnp|#O$i%O%P%U%f%j%k%y&u'w'x(T*_*e*g*y+b,q,{-f-w.O.m.t.v0e1R1S1W1[2g2r5k6q;b;c;d;j;k;l;y;z;{;|<Q<R<S<T<b<c<db!QOaewx{!g&U*v&}![[f!W!X!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$g$h$m%_%o&S&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:p#d!Pgnp|#O$i%O%P%U%f%j%k%y&u'w'x(T*_*e*g*y+b,q,{-f-w.O.m.t.v0e1R1S1W1[2g2r5k6q;b;c;d;j;k;l;y;z;{;|<Q<R<S<T<b<c<db!QOaewx{!g&U*v&|![[f!W!X!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|#}$P$W$Y$[$g$h$m%_%o&S&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b4k5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:pk4W.n3}4R4U4V7m7o7p7r7u9c9d:]Q4[.nS7k3}4TU9[7i7m7vS:U9Y9`R:k:X#|!TO[_ewx!f!g!u!}#O#V#Z$U$V$g$n%W&U&W&[&e&h&o&z'R'b'e'w(T(e(j)o)u*v*{+a+f+y,^,p,|-P-X-d-e-h-v-{.O.k.t.v1[1]1a1n1s1u2U2n2v3U3X3s4O5t8eR4g.|Q(`#US.}(_(aS4h/O/PR8R4iQ.z(^R8P4c#|!TO[_ewx!f!g!u!}#O#V#Z$U$V$g$n%W&U&W&[&e&h&o&z'R'b'e'w(T(e(j)o)u*v*{+a+f+y,^,p,|-P-X-d-e-h-v-{.O.k.t.v1[1]1a1n1s1u2U2n2v3U3X3s4O5t8ep$y`$f$u%Z&t'c(b(i)n*i-[/s1r5u6Q8`q)S#m%{.n0{3}4R4U4V7m7o7p7r7u9c9d:]R,Z&hR6b2U'X!VO[aefwx{!W!X!g!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|$P$W$Y$[$g$h$m%_%o&S&U&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*v*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/d/k/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:p$q#tS%V%]'S'Z']'d'f(d(h(k(|(})W)X)Z)[)])^)_)`)a)b)c)d)p)v)}+^+l,T,X,o,z-o-p.T/Q/x0h0j0o0q1P1h2R2i2p3]3m3n4m4n4t4w4}5P5T5U5n5z6R6`6o6s6}7U7{7|8O8^8_8m8p8t8|9_9f9u9{:W:_:d:j:s$]#uS%V%]'S'Z']'d'f(k(|(})W)[)c)d)p)v)}+^+l,T,X,o,z-o-p.T/Q/x0h0j0o0q1P1h2R2i2p3]3m3n4m4n4t4w4}5P5T5U5n5z6R6`6o6s6}7U7{7|8O8^8_8m8p8t8|9_9f9u9{:W:_:d:j:s$Z#vS%V%]'S'Z']'d'f(k(|(})W)c)d)p)v)}+^+l,T,X,o,z-o-p.T/Q/x0h0j0o0q1P1h2R2i2p3]3m3n4m4n4t4w4}5P5T5U5n5z6R6`6o6s6}7U7{7|8O8^8_8m8p8t8|9_9f9u9{:W:_:d:j:s$c#yS%V%]'S'Z']'d'f(k(|(})W)Z)[)])^)c)d)p)v)}+^+l,T,X,o,z-o-p.T/Q/x0h0j0o0q1P1h2R2i2p3]3m3n4m4n4t4w4}5P5T5U5n5z6R6`6o6s6}7U7{7|8O8^8_8m8p8t8|9_9f9u9{:W:_:d:j:s'X![O[aefwx{!W!X!g!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|$P$W$Y$[$g$h$m%_%o&S&U&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*v*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/d/k/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:pQ/W(iQ/r)nQ4|/sR9n8T']![O[aefwx{!W!X!g!k!n!r!s!v!x#X#Y#[#h#k#n#s#t#u#v#w#x#y#z#{#|$P$W$Y$[$g$h$m%_%o&S&U&Y&d&h&z&{'O'Q'R'e'l'm'|(c(e(l)q)w*m*n*q*v*w*{+]+_+m+o+p,U,W,s,v,|-d-e-h-n.W.X.]/U/X/d/k/t/v/{/}0p1T1Y1i1j1t1x2S2U2k2n2q3P3U3X3s4Y4]4b5d5o5{6i6m6p6r6t7O7Q7V7l7t7w8o8q8w8}9O9]9a9g9i9v9y9z:V:Y:`:b:g:l:pQ(n#]R/Y(nQ#fQR(z#fU%Oa;j<Sb%We$g&h(e-X1u2U2v8eQ'b!u!Q*c%O%W'b*e*k+m,U0e0f1j2z6{7O7o8z9c9g:];b;y;z<Q<R<bS*e%P%UQ*k%ZS+m&Y1YQ,U&dQ0e*gQ0f*iQ1j+pQ2z-^S6{2{2}Q7O3PQ7o4RQ8z6|S9c7p7rQ9g7tQ:]9dQ;b%fS;y;c;dS;z<c<dQ<Q;{Q<R;|T<b1S;k[[Owx!g&U*vl$e['O(Q+a,^,m,p-W-e-v.R.f.k.xl'O!k%o&{'Q,v2k6m6t8q9v9z:b:g:p^(Q#R#S#T+g3f3g3h`+a&W&[&e*{1[1]1n3sS,^&o-{Q,m&yU,p&z'R3XS-W'_2sW-e'e-d-h3US-v'w.OQ.R'{Q.f(SS.k(T.tR.x(XQ*R$^R0Q*RQ0Z*SQ5X0UQ5Y0VQ5Z0WY5[0Z5X5Y5Z8[R8[5^Q*U$_S0^*U0_R0_*VS.g(S.fS3x.g7fR7f3zQ3{.hS7d3y3|U7h3{7d9VR9V7eQ.t(TR4^.t!|_O[wx!f!g!}#O$U$n&U&W&[&e&o&z'R'e'w(T)u*v*{+a,^,p,|-P-d-e-h-v-{.O.k.t.v1[1]1n2n3U3X3s4OU$t_$w*bU$w`$f&tR*b$uU%Pa;j<Sd*f%P*g2{6|7p9d;c;{;|<cQ*g%UQ2{-^Q6|2}Q7p4RQ9d7rQ;c%fQ;{;dQ;|<dT<c1S;kS,Q&c7sR1{,QS*o%]/xR0k*oQ1^+dR5s1^U+j&X1S<SR1e+jQ+x&`Q1k+qT1q+x1kQ8f6TR9s8fQwOS&Tw&UT&Ux*vQ,e&sR2_,eW)z$Y*v/v5dR/|)zU/w)v){0oR5R/w[*z%g%h*]2h2o3VR0u*zQ,i&wR2b,iQ-h'eQ3U-dT3W-h3UQ3R-`R7S3RQ-m'jQ2Z,bT3[-m2ZQ-V'^R2u-VS%rm7[R+P%rdnOwx!g&U'w(T*v.O.tR%wnQ0|+WR5h0|Q.]'|R3p.]Q2O,SR6[2OU*s%b*};eR0n*sS1o+s0vR6O1oQ7v4TQ9Y7iU9k7v9Y:XR:X9`$O!SO[_ewx!f!g!u!}#O#V#Z$U$V$g$n%W&U&W&[&e&h&o&z'R'b'e'w(T(e(j)o)u*v*{+a+f+y,^,p,|-P-X-d-e-h-v-{.O.k.t.v.|1[1]1a1n1s1u2U2n2v3U3X3s4O5t8eR&i!SQ4d.zR8Q4dQ2V,ZR6c2VS/l)d)eR4y/l^(t#b(p(q(r/]/_4rR/`(tQ8V4pR9p8VT)f$P*{!USO[wx!g!k%o&U&{'O'Q'e,v-d-e-h2k3U6m6t8q9v9z:b:g:pj${a{$m%_+o,W1i2S5{7Q8}9i:`Y%Ve$g(e1x3sY%]f$h(l)q*qQ&l!WQ&m!XQ'S!nQ'Z!rQ']!sQ'd!vQ'f!xQ(d#XQ(h#YS(k#[+_Q(|#hQ(}#kQ)W#nQ)X#sQ)Y#tQ)Z#uQ)[#vQ)]#wQ)^#xQ)_#yQ)`#zQ)a#{Q)b#|Q)c#}S)d$P*{Q)p$WQ)v$YQ)}$[Q+^&SS+l&Y1YQ,T&dQ,X&hQ,o&zQ,z'RQ-o'lQ-p'mS.T'|.]Q/Q(cS/x)w0pS0h*m4kQ0j*nQ0o*vQ0q*wQ1P+]S1h+m+pQ2R,UQ2i,sS2p,|7VQ3]-nQ3m.WQ3n.XQ4m/UQ4n/XQ4t/dQ4w/kQ4}/tQ5P/vQ5T/{Q5U/}Q5n1TQ5z1jQ6R1tQ6`2US6o2n9OQ6s2qQ6}3PQ7U3XQ7{4YQ7|4]Q8O4bQ8^5dQ8_5oQ8m6iQ8p6pQ8t6rQ8|7OS9_7l7wQ9f7tQ9u8oQ9{8wS:W9]9aQ:_9gQ:d9yS:j:V:YR:s:lR,[&hd]Owx!g&U'w(T*v.O.t!v^[_`!f!}#O$U$f$n$u$w&W&[&e&o&t&z'R'e)u*b*{+a,^,p,|-P-d-e-h-v-{.k.v1[1]1n2n3U3X3s4O#r$}ae!u$g%O%P%U%W%Z%f&Y&d&h'b(e*e*g*i*k+m+p,U-X-^0e0f1Y1j1u2U2v2z2{2}3P4R6{6|7O7o7p7r7t8e8z9c9d9g:];b;c;d;j;k;y;z;{;|<Q<R<b<c<dQ%vnS+i&X+jW+w&`+q+x1kU,P&c,Q7sQ1s+yT5m1S<S``Owx!g&U'w*v.OS$f[-vQ$u_b%Ze$g&h(e-X1u2U2v8e!h&t!f!}#O$U$n&W&[&e&o&z'R'e(T)u*{+a,^,p,|-P-d-e-h-{.k.t.v1[1]1n2n3U3X3s4OQ'c!uS(b#V+fQ(i#ZS)n$V(jQ*i%WQ-['bQ/s)oQ1r+yQ5u1aQ6Q1sR8`5tS(Z#R3gS([#S3hV(]#T+g3fR$`Ye0Y*S0U0V0W0Z5X5Y5Z5^8[W(U#R#S#T+gQ(_#US.b(Q(XS.h(S.fQ/P(aW1z,O.`6X6ZQ3e-{Q3r._Q3y.gQ4a.xU7_3f3g3hQ7g3zR9W7fQ.i(SR3w.fT.s(T.tdgOwx!g&U&o'w*v-{.OU$i[,^-vQ&u!fQ'n!}Q'x#OQ)m$UQ*_$n`+b&W&[&e*{1[1]1n3sQ,q&zQ,{'RY-f'e-d-h3U3XS.n(T.tQ/u)uQ1R+aS2g,p-eS2r,|-PS3}.k.vQ6q2nR7m4Od]Owx!g&U'w(T*v.O.t!v^[_`!f!}#O$U$f$n$u$w&W&[&e&o&t&z'R'e)u*b*{+a,^,p,|-P-d-e-h-v-{.k.v1[1]1n2n3U3X3s4OR%vnQ4T.nQ7i3}Q7q4RQ7y4UQ7z4VQ9`7mU9b7o7p7rQ9j7uS:[9c9dR:m:]Z+t&[&e*{1[3spzOnpwx!g%y&U'w(T*v-w.O.m.t.v[%Qa%f1S;j;k<SU%Ye%j1[Q%gg^&f{|%k1W5k;l<TQ'v#OQ*]$ib*d%O%P%U;b;c;d<b<c<dQ,g&uQ.P'xQ0c*_[0d*e*g;y;z;{;|Q0s*yQ1U+bQ2h,qQ2o,{S3V-f2gU5a0e<Q<RQ5l1RQ6v2rR8s6qQ,S&cR9e7sS1y,O.`Q8h6XR8i6Z[%`f$h(l)q)w0pR0l*qR+e&WQ+d&WR5r1]S&Zy+}Q*l%ZU+k&X1S<SS+r&[1[W+u&]1W5k<TQ-q'nQ/p)mS0g*i*kQ1Z+bQ1f+jQ5O/uQ5b0fQ5j1RQ6P1rR8c6QR6U1uYvOwx&U*vR&v!gW%ig,q,{-fT*^$i2gT)|$Y*v[uOwx!g&U*vQ'P!kQ+O%oQ,u&{Q,y'QQ2l,vQ6l2kQ8n6mQ8v6tQ9x8qQ:c9vQ:f9zQ:o:bQ:q:gR:u:pxlOwx!g!k%o&U&{'Q*v,v2k6m6t8q9v9z:b:g:pU$j['O-eX-g'e-d-h3UQ-c'cR2y-[S-`'c-[Q2|-^Q3S-aU6z2z2{2}Q7R3QS8y6{6|R9}8zQ'`!tR-Z'a[rOwx!g&U*vS-x'w.OT.o(T.tR+X%{[sOwx!g&U*vS-z'w.OT.p(T.t[tOwx!g&U*vT.q(T.tT.['|.]X%cf%m0p1YQ/O(_R4i/PR.{(^R(g#XQ(w#bU/[(p(q(rS4o/]/_R8X4rR/_(rR4q/^",
    nodeNames: "\u26A0 RawString > MacroName LineComment BlockComment PreprocDirective #include String EscapeSequence SystemLibString Identifier ) ( ArgumentList ConditionalExpression AssignmentExpression CallExpression PrimitiveType FieldExpression FieldIdentifier DestructorName TemplateMethod ScopedFieldIdentifier NamespaceIdentifier TemplateType TypeIdentifier ScopedTypeIdentifier ScopedNamespaceIdentifier :: NamespaceIdentifier TypeIdentifier TemplateArgumentList < TypeDescriptor const volatile restrict _Atomic mutable constexpr constinit consteval StructSpecifier struct MsDeclspecModifier __declspec Attribute AttributeName Identifier AttributeArgs { } [ ] UpdateOp ArithOp ArithOp ArithOp LogicOp BitOp BitOp BitOp CompareOp CompareOp CompareOp > CompareOp BitOp UpdateOp , Number CharLiteral AttributeArgs VirtualSpecifier BaseClassClause Access virtual FieldDeclarationList FieldDeclaration extern static register inline thread_local AttributeSpecifier __attribute__ PointerDeclarator MsBasedModifier __based MsPointerModifier FunctionDeclarator ParameterList ParameterDeclaration PointerDeclarator FunctionDeclarator Noexcept noexcept RequiresClause requires True False ParenthesizedExpression CommaExpression LambdaExpression LambdaCaptureSpecifier TemplateParameterList OptionalParameterDeclaration TypeParameterDeclaration typename class VariadicParameterDeclaration VariadicDeclarator ReferenceDeclarator OptionalTypeParameterDeclaration VariadicTypeParameterDeclaration TemplateTemplateParameterDeclaration template AbstractFunctionDeclarator AbstractPointerDeclarator AbstractArrayDeclarator AbstractParenthesizedDeclarator AbstractReferenceDeclarator ThrowSpecifier throw TrailingReturnType CompoundStatement FunctionDefinition MsCallModifier TryStatement try CatchClause catch LinkageSpecification Declaration InitDeclarator InitializerList InitializerPair SubscriptDesignator FieldDesignator ExportDeclaration export ImportDeclaration import ModuleName PartitionName HeaderName CaseStatement case default LabeledStatement StatementIdentifier ExpressionStatement IfStatement if ConditionClause Declaration else SwitchStatement switch DoStatement do while WhileStatement ForStatement for ReturnStatement return BreakStatement break ContinueStatement continue GotoStatement goto CoReturnStatement co_return CoYieldStatement co_yield AttributeStatement ForRangeLoop AliasDeclaration using TypeDefinition typedef PointerDeclarator FunctionDeclarator ArrayDeclarator ParenthesizedDeclarator ThrowStatement NamespaceDefinition namespace ScopedIdentifier Identifier OperatorName operator ArithOp BitOp CompareOp LogicOp new delete co_await ConceptDefinition concept UsingDeclaration enum StaticAssertDeclaration static_assert ConcatenatedString TemplateDeclaration FriendDeclaration friend union FunctionDefinition ExplicitFunctionSpecifier explicit FieldInitializerList FieldInitializer DefaultMethodClause DeleteMethodClause FunctionDefinition OperatorCast operator TemplateInstantiation FunctionDefinition FunctionDefinition Declaration ModuleDeclaration module RequiresExpression RequirementList SimpleRequirement TypeRequirement CompoundRequirement ReturnTypeRequirement ConstraintConjuction LogicOp ConstraintDisjunction LogicOp ArrayDeclarator ParenthesizedDeclarator ReferenceDeclarator TemplateFunction OperatorName StructuredBindingDeclarator ArrayDeclarator ParenthesizedDeclarator ReferenceDeclarator BitfieldClause FunctionDefinition FunctionDefinition Declaration FunctionDefinition Declaration AccessSpecifier UnionSpecifier ClassSpecifier EnumSpecifier SizedTypeSpecifier TypeSize EnumeratorList Enumerator DependentType Decltype decltype auto PlaceholderTypeSpecifier ParameterPackExpansion ParameterPackExpansion FieldIdentifier PointerExpression SubscriptExpression BinaryExpression ArithOp LogicOp LogicOp BitOp UnaryExpression LogicOp BitOp UpdateExpression CastExpression SizeofExpression sizeof CoAwaitExpression CompoundLiteralExpression NULL NewExpression new NewDeclarator DeleteExpression delete ParameterPackExpansion nullptr this UserDefinedLiteral ParamPack #define PreprocArg #if #ifdef #ifndef #else #endif #elif PreprocDirectiveName Macro Program",
    maxTerm: 433,
    nodeProps: [
      ["group", -35, 1, 8, 11, 15, 16, 17, 19, 71, 72, 100, 101, 102, 104, 191, 208, 229, 242, 243, 270, 271, 272, 277, 280, 281, 282, 284, 285, 286, 287, 290, 292, 293, 294, 295, 296, "Expression", -13, 18, 25, 26, 27, 43, 255, 256, 257, 258, 262, 263, 265, 266, "Type", -19, 126, 129, 147, 150, 152, 153, 158, 160, 163, 164, 166, 168, 170, 172, 174, 176, 178, 179, 188, "Statement"],
      ["isolate", -4, 4, 5, 8, 10, ""],
      ["openedBy", 12, "(", 52, "{", 54, "["],
      ["closedBy", 13, ")", 51, "}", 53, "]"]
    ],
    propSources: [cppHighlighting],
    skippedNodes: [0, 3, 4, 5, 6, 7, 10, 297, 298, 299, 300, 301, 302, 303, 304, 305, 306, 308, 349, 350],
    repeatNodeCount: 43,
    tokenData: "&AbMfR!UOX$eXY/]YZ5gZ]$e]^1g^p$epq/]qr5}rs8Zst:Ttu$euv!AWvw!Cbwx!Eqxy!Flyz!Gmz{!Hn{|!Iw|}!LX}!O!MY!O!P# m!P!Q#8a!Q!R#@T!R![$'k![!]$@f!]!^$Bn!^!_$Co!_!`%C`!`!a%Dg!a!b%HP!b!c$e!c!n%IQ!n!o%Jl!o!w%IQ!w!x%Jl!x!}%IQ!}#O%Mx#O#P& }#P#Q&3[#Q#R&5a#R#S%IQ#S#T$e#T#i%IQ#i#j&6j#j#o%IQ#o#p&8[#p#q&9]#q#r&;o#r#s&<p#s;'S$e;'S;=`/V<%lO$e,j$n[)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$e,f%kY)d`'f,UOY%dZw%dwx&Zx!P%d!P!Q(z!Q#O%d#O#P'b#P;'S%d;'S;=`*g<%lO%d,U&`W'f,UOY&ZZ!P&Z!P!Q&x!Q#O&Z#O#P'b#P;'S&Z;'S;=`'[<%lO&Z,U&{TOz&Z{!P&Z!Q;'S&Z;'S;=`'[<%lO&Z,U'_P;=`<%l&Z,U'gZ'f,UOY&ZYZ&ZZ]&Z]^(Y^!P&Z!P!Q&x!Q#O&Z#O#P'b#P;'S&Z;'S;=`'[<%lO&Z,U(_X'f,UOY&ZYZ&ZZ!P&Z!P!Q&x!Q#O&Z#O#P'b#P;'S&Z;'S;=`'[<%lO&Z,f)P])d`OY%dYZ&ZZw%dwx&Zxz%dz{)x{!P%d!P!Q)x!Q#O%d#O#P&Z#P;'S%d;'S;=`*g<%lO%d`)}U)d`OY)xZw)xx#O)x#P;'S)x;'S;=`*a<%lO)x`*dP;=`<%l)x,f*jP;=`<%l%d,Y*tY(wS'f,UOY*mZr*mrs&Zs!P*m!P!Q+d!Q#O*m#O#P'b#P;'S*m;'S;=`-P<%lO*m,Y+i](wSOY*mYZ&ZZr*mrs&Zsz*mz{,b{!P*m!P!Q,b!Q#O*m#O#P&Z#P;'S*m;'S;=`-P<%lO*mS,gU(wSOY,bZr,bs#O,b#P;'S,b;'S;=`,y<%lO,bS,|P;=`<%l,b,Y-SP;=`<%l*m,j-^_)d`(wSOY$eYZ&ZZr$ers%dsw$ewx*mxz$ez{.]{!P$e!P!Q.]!Q#O$e#O#P&Z#P;'S$e;'S;=`/V<%lO$ed.dX)d`(wSOY.]Zr.]rs)xsw.]wx,bx#O.]#P;'S.];'S;=`/P<%lO.]d/SP;=`<%l.],j/YP;=`<%l$eMf/jb)d`(wS(p<`'f,U*c1pOX$eXY/]YZ0rZ]$e]^1g^p$epq/]qr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P2z#P;'S$e;'S;=`/V<%lO$e<`0wT(p<`XY0rYZ0r]^0rpq0r#O#P1W<`1ZQYZ0r]^1a<`1dPYZ0rGz1rb)d`(wS(p<`'f,UOX$eXY1gYZ0rZ]$e]^1g^p$epq1gqr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P2z#P;'S$e;'S;=`/V<%lO$eGf3PZ'f,UOY&ZYZ3rZ]&Z]^4u^!P&Z!P!Q&x!Q#O&Z#O#P'b#P;'S&Z;'S;=`'[<%lO&ZGf3y^(p<`'f,UOX&ZXY3rYZ0rZ]&Z]^3r^p&Zpq3rq!P&Z!P!Q&x!Q#O&Z#O#P2z#P;'S&Z;'S;=`'[<%lO&ZGf4zX'f,UOY&ZYZ3rZ!P&Z!P!Q&x!Q#O&Z#O#P'b#P;'S&Z;'S;=`'[<%lO&ZMQ5nT*`1p(p<`XY0rYZ0r]^0rpq0r#O#P1WF`6[^%^#t'QQ)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q!_$e!_!`7W!`#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`7e[%]#t!a8O)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eKz8f[)d`(uS(v=j'f,UOY%dZr%drs9[sw%dwx&Zx!P%d!P!Q(z!Q#O%d#O#P'b#P;'S%d;'S;=`*g<%lO%d/[9eY*P#t)d`'f,UOY%dZw%dwx&Zx!P%d!P!Q(z!Q#O%d#O#P'b#P;'S%d;'S;=`*g<%lO%dGz:^h)d`(wS'f,UOX$eXY:TZp$epq:Tqr$ers%dsw$ewx*mx!P$e!P!Q-V!Q!c$e!c!};x!}#O$e#O#P'b#P#T$e#T#W;x#W#X=`#X#YFz#Y#];x#]#^!)O#^#o;x#o;'S$e;'S;=`/V<%lO$eGz<Tc)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#o;x#o;'S$e;'S;=`/V<%lO$eGz=ke)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#X;x#X#Y>|#Y#o;x#o;'S$e;'S;=`/V<%lO$eGz?Xe)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#Y;x#Y#Z@j#Z#o;x#o;'S$e;'S;=`/V<%lO$eGz@ue)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#];x#]#^BW#^#o;x#o;'S$e;'S;=`/V<%lO$eGzBce)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#b;x#b#cCt#c#o;x#o;'S$e;'S;=`/V<%lO$eGzDPe)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#X;x#X#YEb#Y#o;x#o;'S$e;'S;=`/V<%lO$eGzEoc)d`(wS'e<`'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#o;x#o;'S$e;'S;=`/V<%lO$eGzGVg)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#`;x#`#aHn#a#b;x#b#c!!n#c#o;x#o;'S$e;'S;=`/V<%lO$eGzHyg)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#];x#]#^Jb#^#g;x#g#hMh#h#o;x#o;'S$e;'S;=`/V<%lO$eGzJme)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#Y;x#Y#ZLO#Z#o;x#o;'S$e;'S;=`/V<%lO$eGzL]c)d`(wS'f,U'l<`'m<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#o;x#o;'S$e;'S;=`/V<%lO$eGzMse)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#X;x#X#Y! U#Y#o;x#o;'S$e;'S;=`/V<%lO$eGz! cc)d`(wS'j<`'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#o;x#o;'S$e;'S;=`/V<%lO$eGz!!ye)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#W;x#W#X!$[#X#o;x#o;'S$e;'S;=`/V<%lO$eGz!$ge)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#];x#]#^!%x#^#o;x#o;'S$e;'S;=`/V<%lO$eGz!&Te)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#Y;x#Y#Z!'f#Z#o;x#o;'S$e;'S;=`/V<%lO$eGz!'sc)d`(wS'f,U'k<`'m<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#o;x#o;'S$e;'S;=`/V<%lO$eGz!)Zg)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#Y;x#Y#Z!*r#Z#b;x#b#c!7l#c#o;x#o;'S$e;'S;=`/V<%lO$eGz!+Pg)d`(wS'g<`'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#W;x#W#X!,h#X#b;x#b#c!1[#c#o;x#o;'S$e;'S;=`/V<%lO$eGz!,se)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#X;x#X#Y!.U#Y#o;x#o;'S$e;'S;=`/V<%lO$eGz!.ae)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#Y;x#Y#Z!/r#Z#o;x#o;'S$e;'S;=`/V<%lO$eGz!0Pc)d`(wS'h<`'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#o;x#o;'S$e;'S;=`/V<%lO$eGz!1ge)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#W;x#W#X!2x#X#o;x#o;'S$e;'S;=`/V<%lO$eGz!3Te)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#X;x#X#Y!4f#Y#o;x#o;'S$e;'S;=`/V<%lO$eGz!4qe)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#Y;x#Y#Z!6S#Z#o;x#o;'S$e;'S;=`/V<%lO$eGz!6ac)d`(wS'i<`'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#o;x#o;'S$e;'S;=`/V<%lO$eGz!7we)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#V;x#V#W!9Y#W#o;x#o;'S$e;'S;=`/V<%lO$eGz!9ee)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#`;x#`#a!:v#a#o;x#o;'S$e;'S;=`/V<%lO$eGz!;Re)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#i;x#i#j!<d#j#o;x#o;'S$e;'S;=`/V<%lO$eGz!<oe)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#W;x#W#X!>Q#X#o;x#o;'S$e;'S;=`/V<%lO$eGz!>]e)d`(wS'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#X;x#X#Y!?n#Y#o;x#o;'S$e;'S;=`/V<%lO$eGz!?{c)d`(wSV<`'f,U'm<`OY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![;x![!c$e!c!};x!}#O$e#O#P'b#P#R$e#R#S;x#S#T$e#T#o;x#o;'S$e;'S;=`/V<%lO$eF`!Ae^)d`(wS%Z#t![8O'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q!_$e!_!`!Ba!`#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`!Bl[!g:t)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`!Co_)^8O)d`(wS%[#t'f,UOY$eZr$ers%dsv$evw!Dnwx*mx!P$e!P!Q-V!Q!_$e!_!`!Ba!`#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`!D{[)]8O%^#t)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eCb!E|Y)bW(wS)c8O'f,UOY*mZr*mrs&Zs!P*m!P!Q+d!Q#O*m#O#P'b#P;'S*m;'S;=`-P<%lO*mLS!Fw[)d`(wS]Kn'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$e-^!Gx[[r)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`!H{^)Z8O)d`(wS%Z#t'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q!_$e!_!`!Ba!`#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`!JU`)d`(wS%Z#t!Y8O'f,UOY$eZr$ers%dsw$ewx*mx{$e{|!KW|!P$e!P!Q-V!Q!_$e!_!`!Ba!`#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`!Kc[)d`!X:t(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eCr!Ld[!h8W)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`!Mga)d`(wS%Z#t!Y8O'f,UOY$eZr$ers%dsw$ewx*mx}$e}!O!KW!O!P$e!P!Q-V!Q!_$e!_!`!Ba!`!a!Nl!a#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`!Nw[)O:t)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eCr# x^)d`(wS'f,U(}8OOY$eZr$ers%dsw$ewx*mx!O$e!O!P#!t!P!Q-V!Q![#$w![#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eCr#!}])d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!O$e!O!P##v!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eCr#$R[)a8W)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eCj#%So)d`(wS!i8O'f,UOY$eZr$ers%dsw$ewx#'Tx!P$e!P!Q-V!Q![#$w![!g$e!g!h#1O!h!i#6j!i!n$e!n!o#6j!o!r$e!r!s#1O!s!w$e!w!x#6j!x#O$e#O#P'b#P#X$e#X#Y#1O#Y#Z#6j#Z#`$e#`#a#6j#a#d$e#d#e#1O#e#i$e#i#j#6j#j;'S$e;'S;=`/V<%lO$eCY#'[Z(wS'f,UOY*mZr*mrs&Zs!P*m!P!Q+d!Q![#'}![#O*m#O#P'b#P;'S*m;'S;=`-P<%lO*mCY#(Wo(wS!i8O'f,UOY*mZr*mrs&Zsw*mwx#'Tx!P*m!P!Q+d!Q![#'}![!g*m!g!h#*X!h!i#/a!i!n*m!n!o#/a!o!r*m!r!s#*X!s!w*m!w!x#/a!x#O*m#O#P'b#P#X*m#X#Y#*X#Y#Z#/a#Z#`*m#`#a#/a#a#d*m#d#e#*X#e#i*m#i#j#/a#j;'S*m;'S;=`-P<%lO*mCY#*bm(wS!i8O'f,UOY*mZr*mrs&Zs{*m{|#,]|}*m}!O#,]!O!P*m!P!Q+d!Q![#-c![!c*m!c!h#-c!h!i#-c!i!n*m!n!o#/a!o!w*m!w!x#/a!x#O*m#O#P'b#P#T*m#T#Y#-c#Y#Z#-c#Z#`*m#`#a#/a#a#i*m#i#j#/a#j;'S*m;'S;=`-P<%lO*mCY#,d_(wS'f,UOY*mZr*mrs&Zs!P*m!P!Q+d!Q![#-c![!c*m!c!i#-c!i#O*m#O#P'b#P#T*m#T#Z#-c#Z;'S*m;'S;=`-P<%lO*mCY#-lk(wS!i8O'f,UOY*mZr*mrs&Zsw*mwx#,]x!P*m!P!Q+d!Q![#-c![!c*m!c!h#-c!h!i#-c!i!n*m!n!o#/a!o!w*m!w!x#/a!x#O*m#O#P'b#P#T*m#T#Y#-c#Y#Z#-c#Z#`*m#`#a#/a#a#i*m#i#j#/a#j;'S*m;'S;=`-P<%lO*mCY#/jf(wS!i8O'f,UOY*mZr*mrs&Zs!P*m!P!Q+d!Q!h*m!h!i#/a!i!n*m!n!o#/a!o!w*m!w!x#/a!x#O*m#O#P'b#P#Y*m#Y#Z#/a#Z#`*m#`#a#/a#a#i*m#i#j#/a#j;'S*m;'S;=`-P<%lO*mCj#1Zo)d`(wS!i8O'f,UOY$eZr$ers%dsw$ewx*mx{$e{|#3[|}$e}!O#3[!O!P$e!P!Q-V!Q![#4j![!c$e!c!h#4j!h!i#4j!i!n$e!n!o#6j!o!w$e!w!x#6j!x#O$e#O#P'b#P#T$e#T#Y#4j#Y#Z#4j#Z#`$e#`#a#6j#a#i$e#i#j#6j#j;'S$e;'S;=`/V<%lO$eCj#3ea)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![#4j![!c$e!c!i#4j!i#O$e#O#P'b#P#T$e#T#Z#4j#Z;'S$e;'S;=`/V<%lO$eCj#4uk)d`(wS!i8O'f,UOY$eZr$ers%dsw$ewx#,]x!P$e!P!Q-V!Q![#4j![!c$e!c!h#4j!h!i#4j!i!n$e!n!o#6j!o!w$e!w!x#6j!x#O$e#O#P'b#P#T$e#T#Y#4j#Y#Z#4j#Z#`$e#`#a#6j#a#i$e#i#j#6j#j;'S$e;'S;=`/V<%lO$eCj#6uh)d`(wS!i8O'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q!h$e!h!i#6j!i!n$e!n!o#6j!o!w$e!w!x#6j!x#O$e#O#P'b#P#Y$e#Y#Z#6j#Z#`$e#`#a#6j#a#i$e#i#j#6j#j;'S$e;'S;=`/V<%lO$eMf#8la)d`(wS%Z#t![8OOY$eYZ&ZZr$ers%dsw$ewx*mxz$ez{#9q{!P$e!P!Q#:g!Q!_$e!_!`!Ba!`#O$e#O#P&Z#P;'S$e;'S;=`/V<%lO$eMf#9zX)d`(wS(qMQOY.]Zr.]rs)xsw.]wx,bx#O.]#P;'S.];'S;=`/P<%lO.]Mf#:pY)d`(wSSMQOY#:gZr#:grs#;`sw#:gwx#?Wx#O#:g#O#P#<h#P;'S#:g;'S;=`#?}<%lO#:gMb#;gW)d`SMQOY#;`Zw#;`wx#<Px#O#;`#O#P#<h#P;'S#;`;'S;=`#?Q<%lO#;`MQ#<UUSMQOY#<PZ#O#<P#O#P#<h#P;'S#<P;'S;=`#>z<%lO#<PMQ#<mUSMQOY#<PZ#O#<P#O#P#=P#P;'S#<P;'S;=`#>z<%lO#<PMQ#=UYSMQOY#<PZ#O#<P#O#P#=P#P#b#<P#b#c#<P#c#f#<P#f#g#=t#g;'S#<P;'S;=`#>z<%lO#<PMQ#=yUSMQOY#<PZ#O#<P#O#P#>]#P;'S#<P;'S;=`#>z<%lO#<PMQ#>bWSMQOY#<PZ#O#<P#O#P#=P#P#b#<P#b#c#<P#c;'S#<P;'S;=`#>z<%lO#<PMQ#>}P;=`<%l#<PMb#?TP;=`<%l#;`MU#?_W(wSSMQOY#?WZr#?Wrs#<Ps#O#?W#O#P#<h#P;'S#?W;'S;=`#?w<%lO#?WMU#?zP;=`<%l#?WMf#@QP;=`<%l#:gCj#@`t)d`(wS!i8O'f,UOY$eZr$ers%dsw$ewx#Bpx!O$e!O!P#NV!P!Q-V!Q![$'k![!g$e!g!h#1O!h!i#6j!i!n$e!n!o#6j!o!r$e!r!s#1O!s!w$e!w!x#6j!x#O$e#O#P'b#P#U$e#U#V$)z#V#X$e#X#Y#1O#Y#Z#6j#Z#`$e#`#a#6j#a#d$e#d#e#1O#e#i$e#i#j#6j#j#l$e#l#m$<_#m;'S$e;'S;=`/V<%lO$eCY#BwZ(wS'f,UOY*mZr*mrs&Zs!P*m!P!Q+d!Q![#Cj![#O*m#O#P'b#P;'S*m;'S;=`-P<%lO*mCY#Csp(wS!i8O'f,UOY*mZr*mrs&Zsw*mwx#Bpx!O*m!O!P#Ew!P!Q+d!Q![#Cj![!g*m!g!h#*X!h!i#/a!i!n*m!n!o#/a!o!r*m!r!s#*X!s!w*m!w!x#/a!x#O*m#O#P'b#P#X*m#X#Y#*X#Y#Z#/a#Z#`*m#`#a#/a#a#d*m#d#e#*X#e#i*m#i#j#/a#j;'S*m;'S;=`-P<%lO*mCY#FQo(wS!i8O'f,UOY*mZr*mrs&Zs!P*m!P!Q+d!Q![#HR![!c*m!c!g#HR!g!h#Ki!h!i#HR!i!n*m!n!o#/a!o!r*m!r!s#*X!s!w*m!w!x#/a!x#O*m#O#P'b#P#T*m#T#X#HR#X#Y#Ki#Y#Z#HR#Z#`*m#`#a#/a#a#d*m#d#e#*X#e#i*m#i#j#/a#j;'S*m;'S;=`-P<%lO*mCY#H[q(wS!i8O'f,UOY*mZr*mrs&Zsw*mwx#Jcx!P*m!P!Q+d!Q![#HR![!c*m!c!g#HR!g!h#Ki!h!i#HR!i!n*m!n!o#/a!o!r*m!r!s#*X!s!w*m!w!x#/a!x#O*m#O#P'b#P#T*m#T#X#HR#X#Y#Ki#Y#Z#HR#Z#`*m#`#a#/a#a#d*m#d#e#*X#e#i*m#i#j#/a#j;'S*m;'S;=`-P<%lO*mCY#Jj_(wS'f,UOY*mZr*mrs&Zs!P*m!P!Q+d!Q![#HR![!c*m!c!i#HR!i#O*m#O#P'b#P#T*m#T#Z#HR#Z;'S*m;'S;=`-P<%lO*mCY#Kru(wS!i8O'f,UOY*mZr*mrs&Zsw*mwx#Jcx{*m{|#,]|}*m}!O#,]!O!P*m!P!Q+d!Q![#HR![!c*m!c!g#HR!g!h#Ki!h!i#HR!i!n*m!n!o#/a!o!r*m!r!s#*X!s!w*m!w!x#/a!x#O*m#O#P'b#P#T*m#T#X#HR#X#Y#Ki#Y#Z#HR#Z#`*m#`#a#/a#a#d*m#d#e#*X#e#i*m#i#j#/a#j;'S*m;'S;=`-P<%lO*mCj#Nbq)d`(wS!i8O'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![$!i![!c$e!c!g$!i!g!h$${!h!i$!i!i!n$e!n!o#6j!o!r$e!r!s#1O!s!w$e!w!x#6j!x#O$e#O#P'b#P#T$e#T#X$!i#X#Y$${#Y#Z$!i#Z#`$e#`#a#6j#a#d$e#d#e#1O#e#i$e#i#j#6j#j;'S$e;'S;=`/V<%lO$eCj$!tq)d`(wS!i8O'f,UOY$eZr$ers%dsw$ewx#Jcx!P$e!P!Q-V!Q![$!i![!c$e!c!g$!i!g!h$${!h!i$!i!i!n$e!n!o#6j!o!r$e!r!s#1O!s!w$e!w!x#6j!x#O$e#O#P'b#P#T$e#T#X$!i#X#Y$${#Y#Z$!i#Z#`$e#`#a#6j#a#d$e#d#e#1O#e#i$e#i#j#6j#j;'S$e;'S;=`/V<%lO$eCj$%Wu)d`(wS!i8O'f,UOY$eZr$ers%dsw$ewx#Jcx{$e{|#3[|}$e}!O#3[!O!P$e!P!Q-V!Q![$!i![!c$e!c!g$!i!g!h$${!h!i$!i!i!n$e!n!o#6j!o!r$e!r!s#1O!s!w$e!w!x#6j!x#O$e#O#P'b#P#T$e#T#X$!i#X#Y$${#Y#Z$!i#Z#`$e#`#a#6j#a#d$e#d#e#1O#e#i$e#i#j#6j#j;'S$e;'S;=`/V<%lO$eCj$'vp)d`(wS!i8O'f,UOY$eZr$ers%dsw$ewx#Bpx!O$e!O!P#NV!P!Q-V!Q![$'k![!g$e!g!h#1O!h!i#6j!i!n$e!n!o#6j!o!r$e!r!s#1O!s!w$e!w!x#6j!x#O$e#O#P'b#P#X$e#X#Y#1O#Y#Z#6j#Z#`$e#`#a#6j#a#d$e#d#e#1O#e#i$e#i#j#6j#j;'S$e;'S;=`/V<%lO$eCj$*T_)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!O$e!O!P$+S!P!Q-V!Q!R$,U!R![$'k![#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eCj$+]])d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![#$w![#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eCj$,at)d`(wS!i8O'f,UOY$eZr$ers%dsw$ewx#Bpx!O$e!O!P#NV!P!Q-V!Q![$'k![!g$e!g!h#1O!h!i#6j!i!n$e!n!o#6j!o!r$e!r!s#1O!s!w$e!w!x#6j!x#O$e#O#P'b#P#U$e#U#V$.q#V#X$e#X#Y#1O#Y#Z#6j#Z#`$e#`#a#6j#a#d$e#d#e#1O#e#i$e#i#j#6j#j#l$e#l#m$/s#m;'S$e;'S;=`/V<%lO$eCj$.z])d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![$'k![#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eCj$/|a)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![$1R![!c$e!c!i$1R!i#O$e#O#P'b#P#T$e#T#Z$1R#Z;'S$e;'S;=`/V<%lO$eCj$1^r)d`(wS!i8O'f,UOY$eZr$ers%dsw$ewx$3hx!O$e!O!P#NV!P!Q-V!Q![$1R![!c$e!c!g$1R!g!h$9o!h!i$1R!i!n$e!n!o#6j!o!r$e!r!s#1O!s!w$e!w!x#6j!x#O$e#O#P'b#P#T$e#T#X$1R#X#Y$9o#Y#Z$1R#Z#`$e#`#a#6j#a#d$e#d#e#1O#e#i$e#i#j#6j#j;'S$e;'S;=`/V<%lO$eCY$3o_(wS'f,UOY*mZr*mrs&Zs!P*m!P!Q+d!Q![$4n![!c*m!c!i$4n!i#O*m#O#P'b#P#T*m#T#Z$4n#Z;'S*m;'S;=`-P<%lO*mCY$4wr(wS!i8O'f,UOY*mZr*mrs&Zsw*mwx$3hx!O*m!O!P#Ew!P!Q+d!Q![$4n![!c*m!c!g$4n!g!h$7R!h!i$4n!i!n*m!n!o#/a!o!r*m!r!s#*X!s!w*m!w!x#/a!x#O*m#O#P'b#P#T*m#T#X$4n#X#Y$7R#Y#Z$4n#Z#`*m#`#a#/a#a#d*m#d#e#*X#e#i*m#i#j#/a#j;'S*m;'S;=`-P<%lO*mCY$7[u(wS!i8O'f,UOY*mZr*mrs&Zsw*mwx$3hx{*m{|#,]|}*m}!O#,]!O!P#Ew!P!Q+d!Q![$4n![!c*m!c!g$4n!g!h$7R!h!i$4n!i!n*m!n!o#/a!o!r*m!r!s#*X!s!w*m!w!x#/a!x#O*m#O#P'b#P#T*m#T#X$4n#X#Y$7R#Y#Z$4n#Z#`*m#`#a#/a#a#d*m#d#e#*X#e#i*m#i#j#/a#j;'S*m;'S;=`-P<%lO*mCj$9zu)d`(wS!i8O'f,UOY$eZr$ers%dsw$ewx$3hx{$e{|#3[|}$e}!O#3[!O!P#NV!P!Q-V!Q![$1R![!c$e!c!g$1R!g!h$9o!h!i$1R!i!n$e!n!o#6j!o!r$e!r!s#1O!s!w$e!w!x#6j!x#O$e#O#P'b#P#T$e#T#X$1R#X#Y$9o#Y#Z$1R#Z#`$e#`#a#6j#a#d$e#d#e#1O#e#i$e#i#j#6j#j;'S$e;'S;=`/V<%lO$eCj$<hc)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!O$e!O!P$+S!P!Q-V!Q!R$=s!R![$1R![!c$e!c!i$1R!i#O$e#O#P'b#P#T$e#T#Z$1R#Z;'S$e;'S;=`/V<%lO$eCj$>Ov)d`(wS!i8O'f,UOY$eZr$ers%dsw$ewx$3hx!O$e!O!P#NV!P!Q-V!Q![$1R![!c$e!c!g$1R!g!h$9o!h!i$1R!i!n$e!n!o#6j!o!r$e!r!s#1O!s!w$e!w!x#6j!x#O$e#O#P'b#P#T$e#T#U$1R#U#V$1R#V#X$1R#X#Y$9o#Y#Z$1R#Z#`$e#`#a#6j#a#d$e#d#e#1O#e#i$e#i#j#6j#j#l$e#l#m$/s#m;'S$e;'S;=`/V<%lO$eGz$@q^(|9b)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![$e![!]$Am!]#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eFh$Ax[m:|)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eCj$By[)`8O)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eM^$C|aq8O%]#t)d`(wS'f,UOY$ERYZ$FZZr$ERrs$Fxsw$ERwx%4^x!P$ER!P!Q%8|!Q!^$ER!^!_%=a!_!`%?z!`!a%B_!a#O$ER#O#P%.w#P;'S$ER;'S;=`%=Z<%lO$ER3h$E[_)d`(wS'f,UOY$ERYZ$FZZr$ERrs$Fxsw$ERwx%4^x!P$ER!P!Q%8|!Q!`$ER!`!a%<W!a#O$ER#O#P%.w#P;'S$ER;'S;=`%=Z<%lO$ER!b$F^TO!`$FZ!`!a$Fm!a;'S$FZ;'S;=`$Fr<%lO$FZ!b$FrO$W!b!b$FuP;=`<%l$FZ3d$GP])d`'f,UOY$FxYZ$FZZw$Fxwx$Gxx!P$Fx!P!Q%0n!Q!`$Fx!`!a%3]!a#O$Fx#O#P%.w#P;'S$Fx;'S;=`%4W<%lO$Fx3S$G}Z'f,UOY$GxYZ$FZZ!P$Gx!P!Q$Hp!Q!`$Gx!`!a%$S!a#O$Gx#O#P%.w#P;'S$Gx;'S;=`%0h<%lO$Gx3S$Hs]OY$GxYZ$IlZz$Gxz{$Mo{!P$Gx!P!Q$Mo!Q!`$Gx!`!a%$S!a#O$Gx#O#P%$u#P;'S$Gx;'S;=`%0h<%lO$Gx-h$IqZ'f,UOY$IlYZ$FZZ!P$Il!P!Q$Jd!Q!`$Il!`!a$KS!a#O$Il#O#P$Ky#P;'S$Il;'S;=`$Ks<%lO$Il-h$JgXOz$Ilz{$FZ{!P$Il!P!Q$FZ!Q!`$Il!`!a$KS!a;'S$Il;'S;=`$Ks<%lO$Il-h$KZW$W!b'f,UOY&ZZ!P&Z!P!Q&x!Q#O&Z#O#P'b#P;'S&Z;'S;=`'[<%lO&Z-h$KvP;=`<%l$Il-h$LO]'f,UOY$IlYZ$IlZ]$Il]^$Lw^!P$Il!P!Q$Jd!Q!`$Il!`!a$KS!a#O$Il#O#P$Ky#P;'S$Il;'S;=`$Ks<%lO$Il-h$L|Z'f,UOY$IlYZ$IlZ!P$Il!P!Q$Jd!Q!`$Il!`!a$KS!a#O$Il#O#P$Ky#P;'S$Il;'S;=`$Ks<%lO$Il'|$MrXOY$MoYZ$FZZ!`$Mo!`!a$N_!a#O$Mo#O#P$Nf#P;'S$Mo;'S;=`%#|<%lO$Mo'|$NfO$W!bY&j'|$NiUO!`$Mo!`!a$N{!a;'S$Mo;'S;=`%#^;=`<%l% j<%lO$Mo'|% QW$W!bOY% jZ!`% j!`!a%!V!a#O% j#O#P%![#P;'S% j;'S;=`%#W<%lO% j&j% mWOY% jZ!`% j!`!a%!V!a#O% j#O#P%![#P;'S% j;'S;=`%#W<%lO% j&j%![OY&j&j%!_RO;'S% j;'S;=`%!h;=`O% j&j%!kXOY% jZ!`% j!`!a%!V!a#O% j#O#P%![#P;'S% j;'S;=`%#W;=`<%l% j<%lO% j&j%#ZP;=`<%l% j'|%#aXOY% jZ!`% j!`!a%!V!a#O% j#O#P%![#P;'S% j;'S;=`%#W;=`<%l$Mo<%lO% j'|%$PP;=`<%l$Mo3S%$]W$W!bY&j'f,UOY&ZZ!P&Z!P!Q&x!Q#O&Z#O#P'b#P;'S&Z;'S;=`'[<%lO&Z3S%$z['f,UOY$GxYZ$MoZ!P$Gx!P!Q$Hp!Q!`$Gx!`!a%%p!a#O$Gx#O#P%-R#P;'S$Gx;'S;=`%/x;=`<%l% j<%lO$Gx3S%%wY$W!b'f,UOY%&gZ!P%&g!P!Q%'[!Q!`%&g!`!a%(W!a#O%&g#O#P%+b#P;'S%&g;'S;=`%,{<%lO%&g1p%&lY'f,UOY%&gZ!P%&g!P!Q%'[!Q!`%&g!`!a%(W!a#O%&g#O#P%+b#P;'S%&g;'S;=`%,{<%lO%&g1p%'_]OY%&gYZ&ZZz%&gz{% j{!P%&g!P!Q% j!Q!`%&g!`!a%(W!a#O%&g#O#P%(w#P;'S%&g;'S;=`%,{<%lO%&g1p%(_WY&j'f,UOY&ZZ!P&Z!P!Q&x!Q#O&Z#O#P'b#P;'S&Z;'S;=`'[<%lO&Z1p%(|Y'f,UOY%&gYZ% jZ!P%&g!P!Q%'[!Q#O%&g#O#P%)l#P;'S%&g;'S;=`%,];=`<%l% j<%lO%&g1p%)q]'f,UOY%&gYZ&ZZ]%&g]^%*j^!P%&g!P!Q%'[!Q!`%&g!`!a%(W!a#O%&g#O#P%+b#P;'S%&g;'S;=`%,{<%lO%&g1p%*oZ'f,UOY%&gYZ&ZZ!P%&g!P!Q%'[!Q!`%&g!`!a%(W!a#O%&g#O#P%+b#P;'S%&g;'S;=`%,{<%lO%&g1p%+g['f,UOY%&gYZ%&gZ]%&g]^%*j^!P%&g!P!Q%'[!Q#O%&g#O#P%)l#P;'S%&g;'S;=`%,];=`<%l% j<%lO%&g1p%,`XOY% jZ!`% j!`!a%!V!a#O% j#O#P%![#P;'S% j;'S;=`%#W;=`<%l%&g<%lO% j1p%-OP;=`<%l%&g3S%-W]'f,UOY$GxYZ$IlZ]$Gx]^%.P^!P$Gx!P!Q$Hp!Q!`$Gx!`!a%$S!a#O$Gx#O#P%.w#P;'S$Gx;'S;=`%0h<%lO$Gx3S%.UZ'f,UOY$GxYZ$IlZ!P$Gx!P!Q$Hp!Q!`$Gx!`!a%$S!a#O$Gx#O#P%.w#P;'S$Gx;'S;=`%0h<%lO$Gx3S%.|^'f,UOY$GxYZ$GxZ]$Gx]^%.P^!P$Gx!P!Q$Hp!Q!`$Gx!`!a%%p!a#O$Gx#O#P%-R#P;'S$Gx;'S;=`%/x;=`<%l% j<%lO$Gx3S%/{XOY% jZ!`% j!`!a%!V!a#O% j#O#P%![#P;'S% j;'S;=`%#W;=`<%l$Gx<%lO% j3S%0kP;=`<%l$Gx3d%0s_)d`OY$FxYZ$IlZw$Fxwx$Gxxz$Fxz{%1r{!P$Fx!P!Q%1r!Q!`$Fx!`!a%3]!a#O$Fx#O#P%$u#P;'S$Fx;'S;=`%4W<%lO$Fx(^%1wZ)d`OY%1rYZ$FZZw%1rwx$Mox!`%1r!`!a%2j!a#O%1r#O#P$Nf#P;'S%1r;'S;=`%3V<%lO%1r(^%2sU$W!bY&j)d`OY)xZw)xx#O)x#P;'S)x;'S;=`*a<%lO)x(^%3YP;=`<%l%1r3d%3hY$W!bY&j)d`'f,UOY%dZw%dwx&Zx!P%d!P!Q(z!Q#O%d#O#P'b#P;'S%d;'S;=`*g<%lO%d3d%4ZP;=`<%l$Fx3W%4e](wS'f,UOY%4^YZ$FZZr%4^rs$Gxs!P%4^!P!Q%5^!Q!`%4^!`!a%7{!a#O%4^#O#P%.w#P;'S%4^;'S;=`%8v<%lO%4^3W%5c_(wSOY%4^YZ$IlZr%4^rs$Gxsz%4^z{%6b{!P%4^!P!Q%6b!Q!`%4^!`!a%7{!a#O%4^#O#P%$u#P;'S%4^;'S;=`%8v<%lO%4^(Q%6gZ(wSOY%6bYZ$FZZr%6brs$Mos!`%6b!`!a%7Y!a#O%6b#O#P$Nf#P;'S%6b;'S;=`%7u<%lO%6b(Q%7cU$W!bY&j(wSOY,bZr,bs#O,b#P;'S,b;'S;=`,y<%lO,b(Q%7xP;=`<%l%6b3W%8WY$W!bY&j(wS'f,UOY*mZr*mrs&Zs!P*m!P!Q+d!Q#O*m#O#P'b#P;'S*m;'S;=`-P<%lO*m3W%8yP;=`<%l%4^3h%9Ta)d`(wSOY$ERYZ$IlZr$ERrs$Fxsw$ERwx%4^xz$ERz{%:Y{!P$ER!P!Q%:Y!Q!`$ER!`!a%<W!a#O$ER#O#P%$u#P;'S$ER;'S;=`%=Z<%lO$ER(b%:a])d`(wSOY%:YYZ$FZZr%:Yrs%1rsw%:Ywx%6bx!`%:Y!`!a%;Y!a#O%:Y#O#P$Nf#P;'S%:Y;'S;=`%<Q<%lO%:Y(b%;eX$W!bY&j)d`(wSOY.]Zr.]rs)xsw.]wx,bx#O.]#P;'S.];'S;=`/P<%lO.](b%<TP;=`<%l%:Y3h%<e[$W!bY&j)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$e3h%=^P;=`<%l$ERM^%=n`)d`(wS%[#t!f8O'f,UOY$ERYZ$FZZr$ERrs$Fxsw$ERwx%4^x!P$ER!P!Q%8|!Q!_$ER!_!`%>p!`!a%<W!a#O$ER#O#P%.w#P;'S$ER;'S;=`%=Z<%lO$ERM^%>{_!g:t)d`(wS'f,UOY$ERYZ$FZZr$ERrs$Fxsw$ERwx%4^x!P$ER!P!Q%8|!Q!`$ER!`!a%<W!a#O$ER#O#P%.w#P;'S$ER;'S;=`%=Z<%lO$ERM^%@X_%]#t!b8O)d`(wS'f,UOY$ERYZ$FZZr$ERrs$Fxsw$ERwx%4^x!P$ER!P!Q%8|!Q!`$ER!`!a%AW!a#O$ER#O#P%.w#P;'S$ER;'S;=`%=Z<%lO$ERM^%Ai[%]#t!b8O$W!bY&j)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$e2U%Bj[Y&j)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`%Ck^)q#v)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q!_$e!_!`7W!`#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`%Dt_%]#t)d`(wS!d8O'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q!_$e!_!`%Es!`!a%Fv!a#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`%FQ[%]#t!b8O)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`%GT^)d`(wS%[#t!f8O'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q!_$e!_!`!Ba!`#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$e,l%H[[({Q)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eMf%Iac)d`)PW(wS!R7|(x*t'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![%IQ![!c$e!c!}%IQ!}#O$e#O#P'b#P#R$e#R#S%IQ#S#T$e#T#o%IQ#o;'S$e;'S;=`/V<%lO$eMf%J{c)d`)PW(wS!R7|(x*t'f,UOY$eZr$ers%LWsw$ewx%MPx!P$e!P!Q-V!Q![%IQ![!c$e!c!}%IQ!}#O$e#O#P'b#P#R$e#R#S%IQ#S#T$e#T#o%IQ#o;'S$e;'S;=`/V<%lO$eIQ%LaY)d`(v=j'f,UOY%dZw%dwx&Zx!P%d!P!Q(z!Q#O%d#O#P'b#P;'S%d;'S;=`*g<%lO%dCY%MYY(wS)c8O'f,UOY*mZr*mrs&Zs!P*m!P!Q+d!Q#O*m#O#P'b#P;'S*m;'S;=`-P<%lO*mF`%NT]!V:t)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q!}$e!}#O%N|#O#P'b#P;'S$e;'S;=`/V<%lO$e,l& X[)WQ)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eGz&!Sb'f,UOY&#[YZ&#{Z]&#[]^&%Q^!P&#[!P!Q&%t!Q![&&Y![!w&#[!w!x&'p!x#O&#[#O#P&/`#P#i&#[#i#j&+h#j#l&#[#l#m&0Y#m;'S&#[;'S;=`&3U<%lO&#[,j&#cWXd'f,UOY&ZZ!P&Z!P!Q&x!Q#O&Z#O#P'b#P;'S&Z;'S;=`'[<%lO&ZGz&$U^Xd(p<`'f,UOX&ZXY3rYZ0rZ]&Z]^3r^p&Zpq3rq!P&Z!P!Q&x!Q#O&Z#O#P2z#P;'S&Z;'S;=`'[<%lO&ZGz&%XXXd'f,UOY&ZYZ3rZ!P&Z!P!Q&x!Q#O&Z#O#P'b#P;'S&Z;'S;=`'[<%lO&Z,j&%yTXdOz&Z{!P&Z!Q;'S&Z;'S;=`'[<%lO&Z,j&&aXXd'f,UOY&ZZ!P&Z!P!Q&x!Q![&&|![#O&Z#O#P'b#P;'S&Z;'S;=`'[<%lO&Z,j&'TXXd'f,UOY&ZZ!P&Z!P!Q&x!Q![&#[![#O&Z#O#P'b#P;'S&Z;'S;=`'[<%lO&Z,j&'u]'f,UOY&ZZ!P&Z!P!Q&x!Q![&(n![!c&Z!c!i&(n!i#O&Z#O#P'b#P#T&Z#T#Z&(n#Z;'S&Z;'S;=`'[<%lO&Z,j&(s]'f,UOY&ZZ!P&Z!P!Q&x!Q![&)l![!c&Z!c!i&)l!i#O&Z#O#P'b#P#T&Z#T#Z&)l#Z;'S&Z;'S;=`'[<%lO&Z,j&)q]'f,UOY&ZZ!P&Z!P!Q&x!Q![&*j![!c&Z!c!i&*j!i#O&Z#O#P'b#P#T&Z#T#Z&*j#Z;'S&Z;'S;=`'[<%lO&Z,j&*o]'f,UOY&ZZ!P&Z!P!Q&x!Q![&+h![!c&Z!c!i&+h!i#O&Z#O#P'b#P#T&Z#T#Z&+h#Z;'S&Z;'S;=`'[<%lO&Z,j&+m]'f,UOY&ZZ!P&Z!P!Q&x!Q![&,f![!c&Z!c!i&,f!i#O&Z#O#P'b#P#T&Z#T#Z&,f#Z;'S&Z;'S;=`'[<%lO&Z,j&,k]'f,UOY&ZZ!P&Z!P!Q&x!Q![&-d![!c&Z!c!i&-d!i#O&Z#O#P'b#P#T&Z#T#Z&-d#Z;'S&Z;'S;=`'[<%lO&Z,j&-i]'f,UOY&ZZ!P&Z!P!Q&x!Q![&.b![!c&Z!c!i&.b!i#O&Z#O#P'b#P#T&Z#T#Z&.b#Z;'S&Z;'S;=`'[<%lO&Z,j&.g]'f,UOY&ZZ!P&Z!P!Q&x!Q![&#[![!c&Z!c!i&#[!i#O&Z#O#P'b#P#T&Z#T#Z&#[#Z;'S&Z;'S;=`'[<%lO&Z,j&/gZXd'f,UOY&ZYZ&ZZ]&Z]^(Y^!P&Z!P!Q&x!Q#O&Z#O#P'b#P;'S&Z;'S;=`'[<%lO&Z,j&0_]'f,UOY&ZZ!P&Z!P!Q&x!Q![&1W![!c&Z!c!i&1W!i#O&Z#O#P'b#P#T&Z#T#Z&1W#Z;'S&Z;'S;=`'[<%lO&Z,j&1]]'f,UOY&ZZ!P&Z!P!Q&x!Q![&2U![!c&Z!c!i&2U!i#O&Z#O#P'b#P#T&Z#T#Z&2U#Z;'S&Z;'S;=`'[<%lO&Z,j&2]]Xd'f,UOY&ZZ!P&Z!P!Q&x!Q![&2U![!c&Z!c!i&2U!i#O&Z#O#P'b#P#T&Z#T#Z&2U#Z;'S&Z;'S;=`'[<%lO&Z,j&3XP;=`<%l&#[Cr&3g]!W7^)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P#Q&4`#Q;'S$e;'S;=`/V<%lO$e-d&4k[)Vx)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`&5n^)d`(wS%[#t'f,U!_8OOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q!_$e!_!`!Ba!`#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eMf&6ye)d`)PW(wS!R7|(x*t'f,UOY$eZr$ers%LWsw$ewx%MPx!P$e!P!Q-V!Q!Y%IQ!Y!Z%Jl!Z![%IQ![!c$e!c!}%IQ!}#O$e#O#P'b#P#R$e#R#S%IQ#S#T$e#T#o%IQ#o;'S$e;'S;=`/V<%lO$eCj&8g[!T8O)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$eF`&9j`)d`(wS%[#t'f,U!^8OOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q!_$e!_!`!Ba!`#O$e#O#P'b#P#p$e#p#q&:l#q;'S$e;'S;=`/V<%lO$eF`&:y[)[8O%^#t)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$e-^&;z[!Ur)d`(wS'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q#O$e#O#P'b#P;'S$e;'S;=`/V<%lO$e/j&<}e)d`(wS%[#t'RQ'f,UOX$eXY&>`Zp$epq&>`qr$ers%dsw$ewx*mx!P$e!P!Q-V!Q!c$e!c!}&?z!}#O$e#O#P'b#P#R$e#R#S&?z#S#T$e#T#o&?z#o;'S$e;'S;=`/V<%lO$e,t&>ie)d`(wS'f,UOX$eXY&>`Zp$epq&>`qr$ers%dsw$ewx*mx!P$e!P!Q-V!Q!c$e!c!}&?z!}#O$e#O#P'b#P#R$e#R#S&?z#S#T$e#T#o&?z#o;'S$e;'S;=`/V<%lO$e,t&@Vc)d`(wSeY'f,UOY$eZr$ers%dsw$ewx*mx!P$e!P!Q-V!Q![&?z![!c$e!c!}&?z!}#O$e#O#P'b#P#R$e#R#S&?z#S#T$e#T#o&?z#o;'S$e;'S;=`/V<%lO$e",
    tokenizers: [rawString, fallback, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, new LocalTokenGroup("j~RQYZXz{^~^O(s~~aP!P!Qd~iO(t~~", 25, 356)],
    topRules: { "Program": [0, 307] },
    dynamicPrecedences: { "17": 1, "65": 1, "87": 1, "94": 1, "119": 1, "184": 1, "187": -10, "240": -10, "241": 1, "244": -1, "246": -10, "247": 1, "262": -1, "267": 2, "268": 2, "306": -10, "371": 3, "425": 1, "426": 3, "427": 1, "428": 1 },
    specialized: [{ term: 362, get: (value) => spec_identifier3[value] || -1 }, { term: 33, get: (value) => spec_[value] || -1 }, { term: 66, get: (value) => spec_templateArgsEnd[value] || -1 }, { term: 369, get: (value) => spec_scopedIdentifier[value] || -1 }],
    tokenPrec: 24852
  });

  // node_modules/@lezer/markdown/dist/index.js
  var CompositeBlock = class _CompositeBlock {
    static create(type, value, from, parentHash, end) {
      let hash2 = parentHash + (parentHash << 8) + type + (value << 4) | 0;
      return new _CompositeBlock(type, value, from, hash2, end, [], []);
    }
    constructor(type, value, from, hash2, end, children, positions) {
      this.type = type;
      this.value = value;
      this.from = from;
      this.hash = hash2;
      this.end = end;
      this.children = children;
      this.positions = positions;
      this.hashProp = [[NodeProp.contextHash, hash2]];
    }
    addChild(child, pos) {
      if (child.prop(NodeProp.contextHash) != this.hash)
        child = new Tree(child.type, child.children, child.positions, child.length, this.hashProp);
      this.children.push(child);
      this.positions.push(pos);
    }
    toTree(nodeSet, end = this.end) {
      let last = this.children.length - 1;
      if (last >= 0)
        end = Math.max(end, this.positions[last] + this.children[last].length + this.from);
      return new Tree(nodeSet.types[this.type], this.children, this.positions, end - this.from).balance({
        makeTree: (children, positions, length) => new Tree(NodeType.none, children, positions, length, this.hashProp)
      });
    }
  };
  var Type;
  (function(Type2) {
    Type2[Type2["Document"] = 1] = "Document";
    Type2[Type2["CodeBlock"] = 2] = "CodeBlock";
    Type2[Type2["FencedCode"] = 3] = "FencedCode";
    Type2[Type2["Blockquote"] = 4] = "Blockquote";
    Type2[Type2["HorizontalRule"] = 5] = "HorizontalRule";
    Type2[Type2["BulletList"] = 6] = "BulletList";
    Type2[Type2["OrderedList"] = 7] = "OrderedList";
    Type2[Type2["ListItem"] = 8] = "ListItem";
    Type2[Type2["ATXHeading1"] = 9] = "ATXHeading1";
    Type2[Type2["ATXHeading2"] = 10] = "ATXHeading2";
    Type2[Type2["ATXHeading3"] = 11] = "ATXHeading3";
    Type2[Type2["ATXHeading4"] = 12] = "ATXHeading4";
    Type2[Type2["ATXHeading5"] = 13] = "ATXHeading5";
    Type2[Type2["ATXHeading6"] = 14] = "ATXHeading6";
    Type2[Type2["SetextHeading1"] = 15] = "SetextHeading1";
    Type2[Type2["SetextHeading2"] = 16] = "SetextHeading2";
    Type2[Type2["HTMLBlock"] = 17] = "HTMLBlock";
    Type2[Type2["LinkReference"] = 18] = "LinkReference";
    Type2[Type2["Paragraph"] = 19] = "Paragraph";
    Type2[Type2["CommentBlock"] = 20] = "CommentBlock";
    Type2[Type2["ProcessingInstructionBlock"] = 21] = "ProcessingInstructionBlock";
    Type2[Type2["Escape"] = 22] = "Escape";
    Type2[Type2["Entity"] = 23] = "Entity";
    Type2[Type2["HardBreak"] = 24] = "HardBreak";
    Type2[Type2["Emphasis"] = 25] = "Emphasis";
    Type2[Type2["StrongEmphasis"] = 26] = "StrongEmphasis";
    Type2[Type2["Link"] = 27] = "Link";
    Type2[Type2["Image"] = 28] = "Image";
    Type2[Type2["InlineCode"] = 29] = "InlineCode";
    Type2[Type2["HTMLTag"] = 30] = "HTMLTag";
    Type2[Type2["Comment"] = 31] = "Comment";
    Type2[Type2["ProcessingInstruction"] = 32] = "ProcessingInstruction";
    Type2[Type2["Autolink"] = 33] = "Autolink";
    Type2[Type2["HeaderMark"] = 34] = "HeaderMark";
    Type2[Type2["QuoteMark"] = 35] = "QuoteMark";
    Type2[Type2["ListMark"] = 36] = "ListMark";
    Type2[Type2["LinkMark"] = 37] = "LinkMark";
    Type2[Type2["EmphasisMark"] = 38] = "EmphasisMark";
    Type2[Type2["CodeMark"] = 39] = "CodeMark";
    Type2[Type2["CodeText"] = 40] = "CodeText";
    Type2[Type2["CodeInfo"] = 41] = "CodeInfo";
    Type2[Type2["LinkTitle"] = 42] = "LinkTitle";
    Type2[Type2["LinkLabel"] = 43] = "LinkLabel";
    Type2[Type2["URL"] = 44] = "URL";
  })(Type || (Type = {}));
  var LeafBlock = class {
    /**
    @internal
    */
    constructor(start, content2) {
      this.start = start;
      this.content = content2;
      this.marks = [];
      this.parsers = [];
    }
  };
  var Line = class {
    constructor() {
      this.text = "";
      this.baseIndent = 0;
      this.basePos = 0;
      this.depth = 0;
      this.markers = [];
      this.pos = 0;
      this.indent = 0;
      this.next = -1;
    }
    /**
    @internal
    */
    forward() {
      if (this.basePos > this.pos)
        this.forwardInner();
    }
    /**
    @internal
    */
    forwardInner() {
      let newPos = this.skipSpace(this.basePos);
      this.indent = this.countIndent(newPos, this.pos, this.indent);
      this.pos = newPos;
      this.next = newPos == this.text.length ? -1 : this.text.charCodeAt(newPos);
    }
    /**
    Skip whitespace after the given position, return the position of
    the next non-space character or the end of the line if there's
    only space after `from`.
    */
    skipSpace(from) {
      return skipSpace(this.text, from);
    }
    /**
    @internal
    */
    reset(text) {
      this.text = text;
      this.baseIndent = this.basePos = this.pos = this.indent = 0;
      this.forwardInner();
      this.depth = 1;
      while (this.markers.length)
        this.markers.pop();
    }
    /**
    Move the line's base position forward to the given position.
    This should only be called by composite [block
    parsers](#BlockParser.parse) or [markup skipping
    functions](#NodeSpec.composite).
    */
    moveBase(to) {
      this.basePos = to;
      this.baseIndent = this.countIndent(to, this.pos, this.indent);
    }
    /**
    Move the line's base position forward to the given _column_.
    */
    moveBaseColumn(indent) {
      this.baseIndent = indent;
      this.basePos = this.findColumn(indent);
    }
    /**
    Store a composite-block-level marker. Should be called from
    [markup skipping functions](#NodeSpec.composite) when they
    consume any non-whitespace characters.
    */
    addMarker(elt2) {
      this.markers.push(elt2);
    }
    /**
    Find the column position at `to`, optionally starting at a given
    position and column.
    */
    countIndent(to, from = 0, indent = 0) {
      for (let i = from; i < to; i++)
        indent += this.text.charCodeAt(i) == 9 ? 4 - indent % 4 : 1;
      return indent;
    }
    /**
    Find the position corresponding to the given column.
    */
    findColumn(goal) {
      let i = 0;
      for (let indent = 0; i < this.text.length && indent < goal; i++)
        indent += this.text.charCodeAt(i) == 9 ? 4 - indent % 4 : 1;
      return i;
    }
    /**
    @internal
    */
    scrub() {
      if (!this.baseIndent)
        return this.text;
      let result = "";
      for (let i = 0; i < this.basePos; i++)
        result += " ";
      return result + this.text.slice(this.basePos);
    }
  };
  function skipForList(bl, cx, line) {
    if (line.pos == line.text.length || bl != cx.block && line.indent >= cx.stack[line.depth + 1].value + line.baseIndent)
      return true;
    if (line.indent >= line.baseIndent + 4)
      return false;
    let size = (bl.type == Type.OrderedList ? isOrderedList : isBulletList)(line, cx, false);
    return size > 0 && (bl.type != Type.BulletList || isHorizontalRule(line, cx, false) < 0) && line.text.charCodeAt(line.pos + size - 1) == bl.value;
  }
  var DefaultSkipMarkup = {
    [Type.Blockquote](bl, cx, line) {
      if (line.next != 62)
        return false;
      line.markers.push(elt(Type.QuoteMark, cx.lineStart + line.pos, cx.lineStart + line.pos + 1));
      line.moveBase(line.pos + (space3(line.text.charCodeAt(line.pos + 1)) ? 2 : 1));
      bl.end = cx.lineStart + line.text.length;
      return true;
    },
    [Type.ListItem](bl, _cx, line) {
      if (line.indent < line.baseIndent + bl.value && line.next > -1)
        return false;
      line.moveBaseColumn(line.baseIndent + bl.value);
      return true;
    },
    [Type.OrderedList]: skipForList,
    [Type.BulletList]: skipForList,
    [Type.Document]() {
      return true;
    }
  };
  function space3(ch) {
    return ch == 32 || ch == 9 || ch == 10 || ch == 13;
  }
  function skipSpace(line, i = 0) {
    while (i < line.length && space3(line.charCodeAt(i)))
      i++;
    return i;
  }
  function skipSpaceBack(line, i, to) {
    while (i > to && space3(line.charCodeAt(i - 1)))
      i--;
    return i;
  }
  function isFencedCode(line) {
    if (line.next != 96 && line.next != 126)
      return -1;
    let pos = line.pos + 1;
    while (pos < line.text.length && line.text.charCodeAt(pos) == line.next)
      pos++;
    if (pos < line.pos + 3)
      return -1;
    if (line.next == 96) {
      for (let i = pos; i < line.text.length; i++)
        if (line.text.charCodeAt(i) == 96)
          return -1;
    }
    return pos;
  }
  function isBlockquote(line) {
    return line.next != 62 ? -1 : line.text.charCodeAt(line.pos + 1) == 32 ? 2 : 1;
  }
  function isHorizontalRule(line, cx, breaking) {
    if (line.next != 42 && line.next != 45 && line.next != 95)
      return -1;
    let count = 1;
    for (let pos = line.pos + 1; pos < line.text.length; pos++) {
      let ch = line.text.charCodeAt(pos);
      if (ch == line.next)
        count++;
      else if (!space3(ch))
        return -1;
    }
    if (breaking && line.next == 45 && isSetextUnderline(line) > -1 && line.depth == cx.stack.length && cx.parser.leafBlockParsers.indexOf(DefaultLeafBlocks.SetextHeading) > -1)
      return -1;
    return count < 3 ? -1 : 1;
  }
  function inList(cx, type) {
    for (let i = cx.stack.length - 1; i >= 0; i--)
      if (cx.stack[i].type == type)
        return true;
    return false;
  }
  function isBulletList(line, cx, breaking) {
    return (line.next == 45 || line.next == 43 || line.next == 42) && (line.pos == line.text.length - 1 || space3(line.text.charCodeAt(line.pos + 1))) && (!breaking || inList(cx, Type.BulletList) || line.skipSpace(line.pos + 2) < line.text.length) ? 1 : -1;
  }
  function isOrderedList(line, cx, breaking) {
    let pos = line.pos, next = line.next;
    for (; ; ) {
      if (next >= 48 && next <= 57)
        pos++;
      else
        break;
      if (pos == line.text.length)
        return -1;
      next = line.text.charCodeAt(pos);
    }
    if (pos == line.pos || pos > line.pos + 9 || next != 46 && next != 41 || pos < line.text.length - 1 && !space3(line.text.charCodeAt(pos + 1)) || breaking && !inList(cx, Type.OrderedList) && (line.skipSpace(pos + 1) == line.text.length || pos > line.pos + 1 || line.next != 49))
      return -1;
    return pos + 1 - line.pos;
  }
  function isAtxHeading(line) {
    if (line.next != 35)
      return -1;
    let pos = line.pos + 1;
    while (pos < line.text.length && line.text.charCodeAt(pos) == 35)
      pos++;
    if (pos < line.text.length && line.text.charCodeAt(pos) != 32)
      return -1;
    let size = pos - line.pos;
    return size > 6 ? -1 : size;
  }
  function isSetextUnderline(line) {
    if (line.next != 45 && line.next != 61 || line.indent >= line.baseIndent + 4)
      return -1;
    let pos = line.pos + 1;
    while (pos < line.text.length && line.text.charCodeAt(pos) == line.next)
      pos++;
    let end = pos;
    while (pos < line.text.length && space3(line.text.charCodeAt(pos)))
      pos++;
    return pos == line.text.length ? end : -1;
  }
  var EmptyLine = /^[ \t]*$/;
  var CommentEnd = /-->/;
  var ProcessingEnd = /\?>/;
  var HTMLBlockStyle = [
    [/^<(?:script|pre|style)(?:\s|>|$)/i, /<\/(?:script|pre|style)>/i],
    [/^\s*<!--/, CommentEnd],
    [/^\s*<\?/, ProcessingEnd],
    [/^\s*<![A-Z]/, />/],
    [/^\s*<!\[CDATA\[/, /\]\]>/],
    [/^\s*<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i, EmptyLine],
    [/^\s*(?:<\/[a-z][\w-]*\s*>|<[a-z][\w-]*(\s+[a-z:_][\w-.]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*>)\s*$/i, EmptyLine]
  ];
  function isHTMLBlock(line, _cx, breaking) {
    if (line.next != 60)
      return -1;
    let rest = line.text.slice(line.pos);
    for (let i = 0, e = HTMLBlockStyle.length - (breaking ? 1 : 0); i < e; i++)
      if (HTMLBlockStyle[i][0].test(rest))
        return i;
    return -1;
  }
  function getListIndent(line, pos) {
    let indentAfter = line.countIndent(pos, line.pos, line.indent);
    let skipped = line.skipSpace(pos);
    let indented = line.countIndent(skipped, pos, indentAfter);
    return indented >= indentAfter + 5 || skipped == line.text.length ? indentAfter + 1 : indented;
  }
  function addCodeText(marks, from, to) {
    let last = marks.length - 1;
    if (last >= 0 && marks[last].to == from && marks[last].type == Type.CodeText)
      marks[last].to = to;
    else
      marks.push(elt(Type.CodeText, from, to));
  }
  var DefaultBlockParsers = {
    LinkReference: void 0,
    IndentedCode(cx, line) {
      let base = line.baseIndent + 4;
      if (line.indent < base)
        return false;
      let start = line.findColumn(base);
      let from = cx.lineStart + start, to = cx.lineStart + line.text.length;
      let marks = [], pendingMarks = [];
      addCodeText(marks, from, to);
      while (cx.nextLine() && line.depth >= cx.stack.length) {
        if (line.pos == line.text.length) {
          addCodeText(pendingMarks, cx.lineStart - 1, cx.lineStart);
          for (let m of line.markers)
            pendingMarks.push(m);
        } else if (line.indent < base) {
          break;
        } else {
          if (pendingMarks.length) {
            for (let m of pendingMarks) {
              if (m.type == Type.CodeText)
                addCodeText(marks, m.from, m.to);
              else
                marks.push(m);
            }
            pendingMarks = [];
          }
          addCodeText(marks, cx.lineStart - 1, cx.lineStart);
          for (let m of line.markers)
            marks.push(m);
          to = cx.lineStart + line.text.length;
          let codeStart = cx.lineStart + line.findColumn(line.baseIndent + 4);
          if (codeStart < to)
            addCodeText(marks, codeStart, to);
        }
      }
      if (pendingMarks.length) {
        pendingMarks = pendingMarks.filter((m) => m.type != Type.CodeText);
        if (pendingMarks.length)
          line.markers = pendingMarks.concat(line.markers);
      }
      cx.addNode(cx.buffer.writeElements(marks, -from).finish(Type.CodeBlock, to - from), from);
      return true;
    },
    FencedCode(cx, line) {
      let fenceEnd = isFencedCode(line);
      if (fenceEnd < 0)
        return false;
      let from = cx.lineStart + line.pos, ch = line.next, len = fenceEnd - line.pos;
      let infoFrom = line.skipSpace(fenceEnd), infoTo = skipSpaceBack(line.text, line.text.length, infoFrom);
      let marks = [elt(Type.CodeMark, from, from + len)];
      if (infoFrom < infoTo)
        marks.push(elt(Type.CodeInfo, cx.lineStart + infoFrom, cx.lineStart + infoTo));
      for (let first = true, empty = true, hasLine = false; cx.nextLine() && line.depth >= cx.stack.length; first = false) {
        let i = line.pos;
        if (line.indent - line.baseIndent < 4)
          while (i < line.text.length && line.text.charCodeAt(i) == ch)
            i++;
        if (i - line.pos >= len && line.skipSpace(i) == line.text.length) {
          for (let m of line.markers)
            marks.push(m);
          if (empty && hasLine)
            addCodeText(marks, cx.lineStart - 1, cx.lineStart);
          marks.push(elt(Type.CodeMark, cx.lineStart + line.pos, cx.lineStart + i));
          cx.nextLine();
          break;
        } else {
          hasLine = true;
          if (!first) {
            addCodeText(marks, cx.lineStart - 1, cx.lineStart);
            empty = false;
          }
          for (let m of line.markers)
            marks.push(m);
          let textStart = cx.lineStart + line.basePos, textEnd = cx.lineStart + line.text.length;
          if (textStart < textEnd) {
            addCodeText(marks, textStart, textEnd);
            empty = false;
          }
        }
      }
      cx.addNode(cx.buffer.writeElements(marks, -from).finish(Type.FencedCode, cx.prevLineEnd() - from), from);
      return true;
    },
    Blockquote(cx, line) {
      let size = isBlockquote(line);
      if (size < 0)
        return false;
      cx.startContext(Type.Blockquote, line.pos);
      cx.addNode(Type.QuoteMark, cx.lineStart + line.pos, cx.lineStart + line.pos + 1);
      line.moveBase(line.pos + size);
      return null;
    },
    HorizontalRule(cx, line) {
      if (isHorizontalRule(line, cx, false) < 0)
        return false;
      let from = cx.lineStart + line.pos;
      cx.nextLine();
      cx.addNode(Type.HorizontalRule, from);
      return true;
    },
    BulletList(cx, line) {
      let size = isBulletList(line, cx, false);
      if (size < 0)
        return false;
      if (cx.block.type != Type.BulletList)
        cx.startContext(Type.BulletList, line.basePos, line.next);
      let newBase = getListIndent(line, line.pos + 1);
      cx.startContext(Type.ListItem, line.basePos, newBase - line.baseIndent);
      cx.addNode(Type.ListMark, cx.lineStart + line.pos, cx.lineStart + line.pos + size);
      line.moveBaseColumn(newBase);
      return null;
    },
    OrderedList(cx, line) {
      let size = isOrderedList(line, cx, false);
      if (size < 0)
        return false;
      if (cx.block.type != Type.OrderedList)
        cx.startContext(Type.OrderedList, line.basePos, line.text.charCodeAt(line.pos + size - 1));
      let newBase = getListIndent(line, line.pos + size);
      cx.startContext(Type.ListItem, line.basePos, newBase - line.baseIndent);
      cx.addNode(Type.ListMark, cx.lineStart + line.pos, cx.lineStart + line.pos + size);
      line.moveBaseColumn(newBase);
      return null;
    },
    ATXHeading(cx, line) {
      let size = isAtxHeading(line);
      if (size < 0)
        return false;
      let off = line.pos, from = cx.lineStart + off;
      let endOfSpace = skipSpaceBack(line.text, line.text.length, off), after = endOfSpace;
      while (after > off && line.text.charCodeAt(after - 1) == line.next)
        after--;
      if (after == endOfSpace || after == off || !space3(line.text.charCodeAt(after - 1)))
        after = line.text.length;
      let buf = cx.buffer.write(Type.HeaderMark, 0, size).writeElements(cx.parser.parseInline(line.text.slice(off + size + 1, after), from + size + 1), -from);
      if (after < line.text.length)
        buf.write(Type.HeaderMark, after - off, endOfSpace - off);
      let node = buf.finish(Type.ATXHeading1 - 1 + size, line.text.length - off);
      cx.nextLine();
      cx.addNode(node, from);
      return true;
    },
    HTMLBlock(cx, line) {
      let type = isHTMLBlock(line, cx, false);
      if (type < 0)
        return false;
      let from = cx.lineStart + line.pos, end = HTMLBlockStyle[type][1];
      let marks = [], trailing = end != EmptyLine;
      while (!end.test(line.text) && cx.nextLine()) {
        if (line.depth < cx.stack.length) {
          trailing = false;
          break;
        }
        for (let m of line.markers)
          marks.push(m);
      }
      if (trailing)
        cx.nextLine();
      let nodeType = end == CommentEnd ? Type.CommentBlock : end == ProcessingEnd ? Type.ProcessingInstructionBlock : Type.HTMLBlock;
      let to = cx.prevLineEnd();
      cx.addNode(cx.buffer.writeElements(marks, -from).finish(nodeType, to - from), from);
      return true;
    },
    SetextHeading: void 0
    // Specifies relative precedence for block-continue function
  };
  var LinkReferenceParser = class {
    constructor(leaf) {
      this.stage = 0;
      this.elts = [];
      this.pos = 0;
      this.start = leaf.start;
      this.advance(leaf.content);
    }
    nextLine(cx, line, leaf) {
      if (this.stage == -1)
        return false;
      let content2 = leaf.content + "\n" + line.scrub();
      let finish = this.advance(content2);
      if (finish > -1 && finish < content2.length)
        return this.complete(cx, leaf, finish);
      return false;
    }
    finish(cx, leaf) {
      if ((this.stage == 2 || this.stage == 3) && skipSpace(leaf.content, this.pos) == leaf.content.length)
        return this.complete(cx, leaf, leaf.content.length);
      return false;
    }
    complete(cx, leaf, len) {
      cx.addLeafElement(leaf, elt(Type.LinkReference, this.start, this.start + len, this.elts));
      return true;
    }
    nextStage(elt2) {
      if (elt2) {
        this.pos = elt2.to - this.start;
        this.elts.push(elt2);
        this.stage++;
        return true;
      }
      if (elt2 === false)
        this.stage = -1;
      return false;
    }
    advance(content2) {
      for (; ; ) {
        if (this.stage == -1) {
          return -1;
        } else if (this.stage == 0) {
          if (!this.nextStage(parseLinkLabel(content2, this.pos, this.start, true)))
            return -1;
          if (content2.charCodeAt(this.pos) != 58)
            return this.stage = -1;
          this.elts.push(elt(Type.LinkMark, this.pos + this.start, this.pos + this.start + 1));
          this.pos++;
        } else if (this.stage == 1) {
          if (!this.nextStage(parseURL(content2, skipSpace(content2, this.pos), this.start)))
            return -1;
        } else if (this.stage == 2) {
          let skip = skipSpace(content2, this.pos), end = 0;
          if (skip > this.pos) {
            let title = parseLinkTitle(content2, skip, this.start);
            if (title) {
              let titleEnd = lineEnd(content2, title.to - this.start);
              if (titleEnd > 0) {
                this.nextStage(title);
                end = titleEnd;
              }
            }
          }
          if (!end)
            end = lineEnd(content2, this.pos);
          return end > 0 && end < content2.length ? end : -1;
        } else {
          return lineEnd(content2, this.pos);
        }
      }
    }
  };
  function lineEnd(text, pos) {
    for (; pos < text.length; pos++) {
      let next = text.charCodeAt(pos);
      if (next == 10)
        break;
      if (!space3(next))
        return -1;
    }
    return pos;
  }
  var SetextHeadingParser = class {
    nextLine(cx, line, leaf) {
      let underline = line.depth < cx.stack.length ? -1 : isSetextUnderline(line);
      let next = line.next;
      if (underline < 0)
        return false;
      let underlineMark = elt(Type.HeaderMark, cx.lineStart + line.pos, cx.lineStart + underline);
      cx.nextLine();
      cx.addLeafElement(leaf, elt(next == 61 ? Type.SetextHeading1 : Type.SetextHeading2, leaf.start, cx.prevLineEnd(), [
        ...cx.parser.parseInline(leaf.content, leaf.start),
        underlineMark
      ]));
      return true;
    }
    finish() {
      return false;
    }
  };
  var DefaultLeafBlocks = {
    LinkReference(_, leaf) {
      return leaf.content.charCodeAt(0) == 91 ? new LinkReferenceParser(leaf) : null;
    },
    SetextHeading() {
      return new SetextHeadingParser();
    }
  };
  var DefaultEndLeaf = [
    (_, line) => isAtxHeading(line) >= 0,
    (_, line) => isFencedCode(line) >= 0,
    (_, line) => isBlockquote(line) >= 0,
    (p, line) => isBulletList(line, p, true) >= 0,
    (p, line) => isOrderedList(line, p, true) >= 0,
    (p, line) => isHorizontalRule(line, p, true) >= 0,
    (p, line) => isHTMLBlock(line, p, true) >= 0
  ];
  var scanLineResult = { text: "", end: 0 };
  var BlockContext = class {
    /**
    @internal
    */
    constructor(parser7, input, fragments, ranges) {
      this.parser = parser7;
      this.input = input;
      this.ranges = ranges;
      this.line = new Line();
      this.atEnd = false;
      this.reusePlaceholders = /* @__PURE__ */ new Map();
      this.stoppedAt = null;
      this.rangeI = 0;
      this.to = ranges[ranges.length - 1].to;
      this.lineStart = this.absoluteLineStart = this.absoluteLineEnd = ranges[0].from;
      this.block = CompositeBlock.create(Type.Document, 0, this.lineStart, 0, 0);
      this.stack = [this.block];
      this.fragments = fragments.length ? new FragmentCursor3(fragments, input) : null;
      this.readLine();
    }
    get parsedPos() {
      return this.absoluteLineStart;
    }
    advance() {
      if (this.stoppedAt != null && this.absoluteLineStart > this.stoppedAt)
        return this.finish();
      let { line } = this;
      for (; ; ) {
        for (let markI = 0; ; ) {
          let next = line.depth < this.stack.length ? this.stack[this.stack.length - 1] : null;
          while (markI < line.markers.length && (!next || line.markers[markI].from < next.end)) {
            let mark = line.markers[markI++];
            this.addNode(mark.type, mark.from, mark.to);
          }
          if (!next)
            break;
          this.finishContext();
        }
        if (line.pos < line.text.length)
          break;
        if (!this.nextLine())
          return this.finish();
      }
      if (this.fragments && this.reuseFragment(line.basePos))
        return null;
      start: for (; ; ) {
        for (let type of this.parser.blockParsers)
          if (type) {
            let result = type(this, line);
            if (result != false) {
              if (result == true)
                return null;
              line.forward();
              continue start;
            }
          }
        break;
      }
      if (line.pos == line.text.length)
        return this.nextLine() ? null : this.finish();
      let leaf = new LeafBlock(this.lineStart + line.pos, line.text.slice(line.pos));
      for (let parse of this.parser.leafBlockParsers)
        if (parse) {
          let parser7 = parse(this, leaf);
          if (parser7)
            leaf.parsers.push(parser7);
        }
      lines: while (this.nextLine()) {
        if (line.pos == line.text.length)
          break;
        if (line.indent < line.baseIndent + 4) {
          for (let stop of this.parser.endLeafBlock)
            if (stop(this, line, leaf))
              break lines;
        }
        for (let parser7 of leaf.parsers)
          if (parser7.nextLine(this, line, leaf))
            return null;
        leaf.content += "\n" + line.scrub();
        for (let m of line.markers)
          leaf.marks.push(m);
      }
      this.finishLeaf(leaf);
      return null;
    }
    stopAt(pos) {
      if (this.stoppedAt != null && this.stoppedAt < pos)
        throw new RangeError("Can't move stoppedAt forward");
      this.stoppedAt = pos;
    }
    reuseFragment(start) {
      if (!this.fragments.moveTo(this.absoluteLineStart + start, this.absoluteLineStart) || !this.fragments.matches(this.block.hash))
        return false;
      let taken = this.fragments.takeNodes(this);
      if (!taken)
        return false;
      this.absoluteLineStart += taken;
      this.lineStart = toRelative(this.absoluteLineStart, this.ranges);
      this.moveRangeI();
      if (this.absoluteLineStart < this.to) {
        this.lineStart++;
        this.absoluteLineStart++;
        this.readLine();
      } else {
        this.atEnd = true;
        this.readLine();
      }
      return true;
    }
    /**
    The number of parent blocks surrounding the current block.
    */
    get depth() {
      return this.stack.length;
    }
    /**
    Get the type of the parent block at the given depth. When no
    depth is passed, return the type of the innermost parent.
    */
    parentType(depth = this.depth - 1) {
      return this.parser.nodeSet.types[this.stack[depth].type];
    }
    /**
    Move to the next input line. This should only be called by
    (non-composite) [block parsers](#BlockParser.parse) that consume
    the line directly, or leaf block parser
    [`nextLine`](#LeafBlockParser.nextLine) methods when they
    consume the current line (and return true).
    */
    nextLine() {
      this.lineStart += this.line.text.length;
      if (this.absoluteLineEnd >= this.to) {
        this.absoluteLineStart = this.absoluteLineEnd;
        this.atEnd = true;
        this.readLine();
        return false;
      } else {
        this.lineStart++;
        this.absoluteLineStart = this.absoluteLineEnd + 1;
        this.moveRangeI();
        this.readLine();
        return true;
      }
    }
    /**
    Retrieve the text of the line after the current one, without
    actually moving the context's current line forward.
    */
    peekLine() {
      return this.scanLine(this.absoluteLineEnd + 1).text;
    }
    moveRangeI() {
      while (this.rangeI < this.ranges.length - 1 && this.absoluteLineStart >= this.ranges[this.rangeI].to) {
        this.rangeI++;
        this.absoluteLineStart = Math.max(this.absoluteLineStart, this.ranges[this.rangeI].from);
      }
    }
    /**
    @internal
    Collect the text for the next line.
    */
    scanLine(start) {
      let r = scanLineResult;
      r.end = start;
      if (start >= this.to) {
        r.text = "";
      } else {
        r.text = this.lineChunkAt(start);
        r.end += r.text.length;
        if (this.ranges.length > 1) {
          let textOffset = this.absoluteLineStart, rangeI = this.rangeI;
          while (this.ranges[rangeI].to < r.end) {
            rangeI++;
            let nextFrom = this.ranges[rangeI].from;
            let after = this.lineChunkAt(nextFrom);
            r.end = nextFrom + after.length;
            r.text = r.text.slice(0, this.ranges[rangeI - 1].to - textOffset) + after;
            textOffset = r.end - r.text.length;
          }
        }
      }
      return r;
    }
    /**
    @internal
    Populate this.line with the content of the next line. Skip
    leading characters covered by composite blocks.
    */
    readLine() {
      let { line } = this, { text, end } = this.scanLine(this.absoluteLineStart);
      this.absoluteLineEnd = end;
      line.reset(text);
      for (; line.depth < this.stack.length; line.depth++) {
        let cx = this.stack[line.depth], handler = this.parser.skipContextMarkup[cx.type];
        if (!handler)
          throw new Error("Unhandled block context " + Type[cx.type]);
        let marks = this.line.markers.length;
        if (!handler(cx, this, line)) {
          if (this.line.markers.length > marks)
            cx.end = this.line.markers[this.line.markers.length - 1].to;
          line.forward();
          break;
        }
        line.forward();
      }
    }
    lineChunkAt(pos) {
      let next = this.input.chunk(pos), text;
      if (!this.input.lineChunks) {
        let eol = next.indexOf("\n");
        text = eol < 0 ? next : next.slice(0, eol);
      } else {
        text = next == "\n" ? "" : next;
      }
      return pos + text.length > this.to ? text.slice(0, this.to - pos) : text;
    }
    /**
    The end position of the previous line.
    */
    prevLineEnd() {
      return this.atEnd ? this.lineStart : this.lineStart - 1;
    }
    /**
    @internal
    */
    startContext(type, start, value = 0) {
      this.block = CompositeBlock.create(type, value, this.lineStart + start, this.block.hash, this.lineStart + this.line.text.length);
      this.stack.push(this.block);
    }
    /**
    Start a composite block. Should only be called from [block
    parser functions](#BlockParser.parse) that return null.
    */
    startComposite(type, start, value = 0) {
      this.startContext(this.parser.getNodeType(type), start, value);
    }
    /**
    @internal
    */
    addNode(block, from, to) {
      if (typeof block == "number")
        block = new Tree(this.parser.nodeSet.types[block], none, none, (to !== null && to !== void 0 ? to : this.prevLineEnd()) - from);
      this.block.addChild(block, from - this.block.from);
    }
    /**
    Add a block element. Can be called by [block
    parsers](#BlockParser.parse).
    */
    addElement(elt2) {
      this.block.addChild(elt2.toTree(this.parser.nodeSet), elt2.from - this.block.from);
    }
    /**
    Add a block element from a [leaf parser](#LeafBlockParser). This
    makes sure any extra composite block markup (such as blockquote
    markers) inside the block are also added to the syntax tree.
    */
    addLeafElement(leaf, elt2) {
      this.addNode(this.buffer.writeElements(injectMarks(elt2.children, leaf.marks), -elt2.from).finish(elt2.type, elt2.to - elt2.from), elt2.from);
    }
    /**
    @internal
    */
    finishContext() {
      let cx = this.stack.pop();
      let top = this.stack[this.stack.length - 1];
      top.addChild(cx.toTree(this.parser.nodeSet), cx.from - top.from);
      this.block = top;
    }
    finish() {
      while (this.stack.length > 1)
        this.finishContext();
      return this.addGaps(this.block.toTree(this.parser.nodeSet, this.lineStart));
    }
    addGaps(tree) {
      return this.ranges.length > 1 ? injectGaps(this.ranges, 0, tree.topNode, this.ranges[0].from, this.reusePlaceholders) : tree;
    }
    /**
    @internal
    */
    finishLeaf(leaf) {
      for (let parser7 of leaf.parsers)
        if (parser7.finish(this, leaf))
          return;
      let inline = injectMarks(this.parser.parseInline(leaf.content, leaf.start), leaf.marks);
      this.addNode(this.buffer.writeElements(inline, -leaf.start).finish(Type.Paragraph, leaf.content.length), leaf.start);
    }
    elt(type, from, to, children) {
      if (typeof type == "string")
        return elt(this.parser.getNodeType(type), from, to, children);
      return new TreeElement(type, from);
    }
    /**
    @internal
    */
    get buffer() {
      return new Buffer(this.parser.nodeSet);
    }
  };
  function injectGaps(ranges, rangeI, tree, offset, dummies) {
    let rangeEnd = ranges[rangeI].to;
    let children = [], positions = [], start = tree.from + offset;
    function movePastNext(upto, inclusive) {
      while (inclusive ? upto >= rangeEnd : upto > rangeEnd) {
        let size = ranges[rangeI + 1].from - rangeEnd;
        offset += size;
        upto += size;
        rangeI++;
        rangeEnd = ranges[rangeI].to;
      }
    }
    for (let ch = tree.firstChild; ch; ch = ch.nextSibling) {
      movePastNext(ch.from + offset, true);
      let from = ch.from + offset, node, reuse = dummies.get(ch.tree);
      if (reuse) {
        node = reuse;
      } else if (ch.to + offset > rangeEnd) {
        node = injectGaps(ranges, rangeI, ch, offset, dummies);
        movePastNext(ch.to + offset, false);
      } else {
        node = ch.toTree();
      }
      children.push(node);
      positions.push(from - start);
    }
    movePastNext(tree.to + offset, false);
    return new Tree(tree.type, children, positions, tree.to + offset - start, tree.tree ? tree.tree.propValues : void 0);
  }
  var MarkdownParser = class _MarkdownParser extends Parser {
    /**
    @internal
    */
    constructor(nodeSet, blockParsers, leafBlockParsers, blockNames, endLeafBlock, skipContextMarkup, inlineParsers, inlineNames, wrappers) {
      super();
      this.nodeSet = nodeSet;
      this.blockParsers = blockParsers;
      this.leafBlockParsers = leafBlockParsers;
      this.blockNames = blockNames;
      this.endLeafBlock = endLeafBlock;
      this.skipContextMarkup = skipContextMarkup;
      this.inlineParsers = inlineParsers;
      this.inlineNames = inlineNames;
      this.wrappers = wrappers;
      this.nodeTypes = /* @__PURE__ */ Object.create(null);
      for (let t2 of nodeSet.types)
        this.nodeTypes[t2.name] = t2.id;
    }
    createParse(input, fragments, ranges) {
      let parse = new BlockContext(this, input, fragments, ranges);
      for (let w of this.wrappers)
        parse = w(parse, input, fragments, ranges);
      return parse;
    }
    /**
    Reconfigure the parser.
    */
    configure(spec) {
      let config = resolveConfig(spec);
      if (!config)
        return this;
      let { nodeSet, skipContextMarkup } = this;
      let blockParsers = this.blockParsers.slice(), leafBlockParsers = this.leafBlockParsers.slice(), blockNames = this.blockNames.slice(), inlineParsers = this.inlineParsers.slice(), inlineNames = this.inlineNames.slice(), endLeafBlock = this.endLeafBlock.slice(), wrappers = this.wrappers;
      if (nonEmpty(config.defineNodes)) {
        skipContextMarkup = Object.assign({}, skipContextMarkup);
        let nodeTypes2 = nodeSet.types.slice(), styles;
        for (let s of config.defineNodes) {
          let { name: name2, block, composite, style } = typeof s == "string" ? { name: s } : s;
          if (nodeTypes2.some((t2) => t2.name == name2))
            continue;
          if (composite)
            skipContextMarkup[nodeTypes2.length] = (bl, cx, line) => composite(cx, line, bl.value);
          let id2 = nodeTypes2.length;
          let group = composite ? ["Block", "BlockContext"] : !block ? void 0 : id2 >= Type.ATXHeading1 && id2 <= Type.SetextHeading2 ? ["Block", "LeafBlock", "Heading"] : ["Block", "LeafBlock"];
          nodeTypes2.push(NodeType.define({
            id: id2,
            name: name2,
            props: group && [[NodeProp.group, group]]
          }));
          if (style) {
            if (!styles)
              styles = {};
            if (Array.isArray(style) || style instanceof Tag)
              styles[name2] = style;
            else
              Object.assign(styles, style);
          }
        }
        nodeSet = new NodeSet(nodeTypes2);
        if (styles)
          nodeSet = nodeSet.extend(styleTags(styles));
      }
      if (nonEmpty(config.props))
        nodeSet = nodeSet.extend(...config.props);
      if (nonEmpty(config.remove)) {
        for (let rm of config.remove) {
          let block = this.blockNames.indexOf(rm), inline = this.inlineNames.indexOf(rm);
          if (block > -1)
            blockParsers[block] = leafBlockParsers[block] = void 0;
          if (inline > -1)
            inlineParsers[inline] = void 0;
        }
      }
      if (nonEmpty(config.parseBlock)) {
        for (let spec2 of config.parseBlock) {
          let found = blockNames.indexOf(spec2.name);
          if (found > -1) {
            blockParsers[found] = spec2.parse;
            leafBlockParsers[found] = spec2.leaf;
          } else {
            let pos = spec2.before ? findName(blockNames, spec2.before) : spec2.after ? findName(blockNames, spec2.after) + 1 : blockNames.length - 1;
            blockParsers.splice(pos, 0, spec2.parse);
            leafBlockParsers.splice(pos, 0, spec2.leaf);
            blockNames.splice(pos, 0, spec2.name);
          }
          if (spec2.endLeaf)
            endLeafBlock.push(spec2.endLeaf);
        }
      }
      if (nonEmpty(config.parseInline)) {
        for (let spec2 of config.parseInline) {
          let found = inlineNames.indexOf(spec2.name);
          if (found > -1) {
            inlineParsers[found] = spec2.parse;
          } else {
            let pos = spec2.before ? findName(inlineNames, spec2.before) : spec2.after ? findName(inlineNames, spec2.after) + 1 : inlineNames.length - 1;
            inlineParsers.splice(pos, 0, spec2.parse);
            inlineNames.splice(pos, 0, spec2.name);
          }
        }
      }
      if (config.wrap)
        wrappers = wrappers.concat(config.wrap);
      return new _MarkdownParser(nodeSet, blockParsers, leafBlockParsers, blockNames, endLeafBlock, skipContextMarkup, inlineParsers, inlineNames, wrappers);
    }
    /**
    @internal
    */
    getNodeType(name2) {
      let found = this.nodeTypes[name2];
      if (found == null)
        throw new RangeError(`Unknown node type '${name2}'`);
      return found;
    }
    /**
    Parse the given piece of inline text at the given offset,
    returning an array of [`Element`](#Element) objects representing
    the inline content.
    */
    parseInline(text, offset) {
      let cx = new InlineContext(this, text, offset);
      outer: for (let pos = offset; pos < cx.end; ) {
        let next = cx.char(pos);
        for (let token of this.inlineParsers)
          if (token) {
            let result = token(cx, next, pos);
            if (result >= 0) {
              pos = result;
              continue outer;
            }
          }
        pos++;
      }
      return cx.resolveMarkers(0);
    }
  };
  function nonEmpty(a2) {
    return a2 != null && a2.length > 0;
  }
  function resolveConfig(spec) {
    if (!Array.isArray(spec))
      return spec;
    if (spec.length == 0)
      return null;
    let conf = resolveConfig(spec[0]);
    if (spec.length == 1)
      return conf;
    let rest = resolveConfig(spec.slice(1));
    if (!rest || !conf)
      return conf || rest;
    let conc = (a2, b) => (a2 || none).concat(b || none);
    let wrapA = conf.wrap, wrapB = rest.wrap;
    return {
      props: conc(conf.props, rest.props),
      defineNodes: conc(conf.defineNodes, rest.defineNodes),
      parseBlock: conc(conf.parseBlock, rest.parseBlock),
      parseInline: conc(conf.parseInline, rest.parseInline),
      remove: conc(conf.remove, rest.remove),
      wrap: !wrapA ? wrapB : !wrapB ? wrapA : (inner, input, fragments, ranges) => wrapA(wrapB(inner, input, fragments, ranges), input, fragments, ranges)
    };
  }
  function findName(names, name2) {
    let found = names.indexOf(name2);
    if (found < 0)
      throw new RangeError(`Position specified relative to unknown parser ${name2}`);
    return found;
  }
  var nodeTypes = [NodeType.none];
  for (let i = 1, name2; name2 = Type[i]; i++) {
    nodeTypes[i] = NodeType.define({
      id: i,
      name: name2,
      props: i >= Type.Escape ? [] : [[NodeProp.group, i in DefaultSkipMarkup ? ["Block", "BlockContext"] : ["Block", "LeafBlock"]]],
      top: name2 == "Document"
    });
  }
  var none = [];
  var Buffer = class {
    constructor(nodeSet) {
      this.nodeSet = nodeSet;
      this.content = [];
      this.nodes = [];
    }
    write(type, from, to, children = 0) {
      this.content.push(type, from, to, 4 + children * 4);
      return this;
    }
    writeElements(elts, offset = 0) {
      for (let e of elts)
        e.writeTo(this, offset);
      return this;
    }
    finish(type, length) {
      return Tree.build({
        buffer: this.content,
        nodeSet: this.nodeSet,
        reused: this.nodes,
        topID: type,
        length
      });
    }
  };
  var Element2 = class {
    /**
    @internal
    */
    constructor(type, from, to, children = none) {
      this.type = type;
      this.from = from;
      this.to = to;
      this.children = children;
    }
    /**
    @internal
    */
    writeTo(buf, offset) {
      let startOff = buf.content.length;
      buf.writeElements(this.children, offset);
      buf.content.push(this.type, this.from + offset, this.to + offset, buf.content.length + 4 - startOff);
    }
    /**
    @internal
    */
    toTree(nodeSet) {
      return new Buffer(nodeSet).writeElements(this.children, -this.from).finish(this.type, this.to - this.from);
    }
  };
  var TreeElement = class {
    constructor(tree, from) {
      this.tree = tree;
      this.from = from;
    }
    get to() {
      return this.from + this.tree.length;
    }
    get type() {
      return this.tree.type.id;
    }
    get children() {
      return none;
    }
    writeTo(buf, offset) {
      buf.nodes.push(this.tree);
      buf.content.push(buf.nodes.length - 1, this.from + offset, this.to + offset, -1);
    }
    toTree() {
      return this.tree;
    }
  };
  function elt(type, from, to, children) {
    return new Element2(type, from, to, children);
  }
  var EmphasisUnderscore = { resolve: "Emphasis", mark: "EmphasisMark" };
  var EmphasisAsterisk = { resolve: "Emphasis", mark: "EmphasisMark" };
  var LinkStart = {};
  var ImageStart = {};
  var InlineDelimiter = class {
    constructor(type, from, to, side) {
      this.type = type;
      this.from = from;
      this.to = to;
      this.side = side;
    }
  };
  var Escapable = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
  var Punctuation = /[!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~\xA1\u2010-\u2027]/;
  try {
    Punctuation = new RegExp("[\\p{S}|\\p{P}]", "u");
  } catch (_) {
  }
  var DefaultInline = {
    Escape(cx, next, start) {
      if (next != 92 || start == cx.end - 1)
        return -1;
      let escaped = cx.char(start + 1);
      for (let i = 0; i < Escapable.length; i++)
        if (Escapable.charCodeAt(i) == escaped)
          return cx.append(elt(Type.Escape, start, start + 2));
      return -1;
    },
    Entity(cx, next, start) {
      if (next != 38)
        return -1;
      let m = /^(?:#\d+|#x[a-f\d]+|\w+);/i.exec(cx.slice(start + 1, start + 31));
      return m ? cx.append(elt(Type.Entity, start, start + 1 + m[0].length)) : -1;
    },
    InlineCode(cx, next, start) {
      if (next != 96 || start && cx.char(start - 1) == 96)
        return -1;
      let pos = start + 1;
      while (pos < cx.end && cx.char(pos) == 96)
        pos++;
      let size = pos - start, curSize = 0;
      for (; pos < cx.end; pos++) {
        if (cx.char(pos) == 96) {
          curSize++;
          if (curSize == size && cx.char(pos + 1) != 96)
            return cx.append(elt(Type.InlineCode, start, pos + 1, [
              elt(Type.CodeMark, start, start + size),
              elt(Type.CodeMark, pos + 1 - size, pos + 1)
            ]));
        } else {
          curSize = 0;
        }
      }
      return -1;
    },
    HTMLTag(cx, next, start) {
      if (next != 60 || start == cx.end - 1)
        return -1;
      let after = cx.slice(start + 1, cx.end);
      let url = /^(?:[a-z][-\w+.]+:[^\s>]+|[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)*)>/i.exec(after);
      if (url) {
        return cx.append(elt(Type.Autolink, start, start + 1 + url[0].length, [
          elt(Type.LinkMark, start, start + 1),
          // url[0] includes the closing bracket, so exclude it from this slice
          elt(Type.URL, start + 1, start + url[0].length),
          elt(Type.LinkMark, start + url[0].length, start + 1 + url[0].length)
        ]));
      }
      let comment2 = /^!--[^>](?:-[^-]|[^-])*?-->/i.exec(after);
      if (comment2)
        return cx.append(elt(Type.Comment, start, start + 1 + comment2[0].length));
      let procInst = /^\?[^]*?\?>/.exec(after);
      if (procInst)
        return cx.append(elt(Type.ProcessingInstruction, start, start + 1 + procInst[0].length));
      let m = /^(?:![A-Z][^]*?>|!\[CDATA\[[^]*?\]\]>|\/\s*[a-zA-Z][\w-]*\s*>|\s*[a-zA-Z][\w-]*(\s+[a-zA-Z:_][\w-.:]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*(\/\s*)?>)/.exec(after);
      if (!m)
        return -1;
      return cx.append(elt(Type.HTMLTag, start, start + 1 + m[0].length));
    },
    Emphasis(cx, next, start) {
      if (next != 95 && next != 42)
        return -1;
      let pos = start + 1;
      while (cx.char(pos) == next)
        pos++;
      let before = cx.slice(start - 1, start), after = cx.slice(pos, pos + 1);
      let pBefore = Punctuation.test(before), pAfter = Punctuation.test(after);
      let sBefore = /\s|^$/.test(before), sAfter = /\s|^$/.test(after);
      let leftFlanking = !sAfter && (!pAfter || sBefore || pBefore);
      let rightFlanking = !sBefore && (!pBefore || sAfter || pAfter);
      let canOpen = leftFlanking && (next == 42 || !rightFlanking || pBefore);
      let canClose = rightFlanking && (next == 42 || !leftFlanking || pAfter);
      return cx.append(new InlineDelimiter(next == 95 ? EmphasisUnderscore : EmphasisAsterisk, start, pos, (canOpen ? 1 : 0) | (canClose ? 2 : 0)));
    },
    HardBreak(cx, next, start) {
      if (next == 92 && cx.char(start + 1) == 10)
        return cx.append(elt(Type.HardBreak, start, start + 2));
      if (next == 32) {
        let pos = start + 1;
        while (cx.char(pos) == 32)
          pos++;
        if (cx.char(pos) == 10 && pos >= start + 2)
          return cx.append(elt(Type.HardBreak, start, pos + 1));
      }
      return -1;
    },
    Link(cx, next, start) {
      return next == 91 ? cx.append(new InlineDelimiter(
        LinkStart,
        start,
        start + 1,
        1
        /* Mark.Open */
      )) : -1;
    },
    Image(cx, next, start) {
      return next == 33 && cx.char(start + 1) == 91 ? cx.append(new InlineDelimiter(
        ImageStart,
        start,
        start + 2,
        1
        /* Mark.Open */
      )) : -1;
    },
    LinkEnd(cx, next, start) {
      if (next != 93)
        return -1;
      for (let i = cx.parts.length - 1; i >= 0; i--) {
        let part = cx.parts[i];
        if (part instanceof InlineDelimiter && (part.type == LinkStart || part.type == ImageStart)) {
          if (!part.side || cx.skipSpace(part.to) == start && !/[(\[]/.test(cx.slice(start + 1, start + 2))) {
            cx.parts[i] = null;
            return -1;
          }
          let content2 = cx.takeContent(i);
          let link = cx.parts[i] = finishLink(cx, content2, part.type == LinkStart ? Type.Link : Type.Image, part.from, start + 1);
          if (part.type == LinkStart)
            for (let j = 0; j < i; j++) {
              let p = cx.parts[j];
              if (p instanceof InlineDelimiter && p.type == LinkStart)
                p.side = 0;
            }
          return link.to;
        }
      }
      return -1;
    }
  };
  function finishLink(cx, content2, type, start, startPos) {
    let { text } = cx, next = cx.char(startPos), endPos = startPos;
    content2.unshift(elt(Type.LinkMark, start, start + (type == Type.Image ? 2 : 1)));
    content2.push(elt(Type.LinkMark, startPos - 1, startPos));
    if (next == 40) {
      let pos = cx.skipSpace(startPos + 1);
      let dest = parseURL(text, pos - cx.offset, cx.offset), title;
      if (dest) {
        pos = cx.skipSpace(dest.to);
        if (pos != dest.to) {
          title = parseLinkTitle(text, pos - cx.offset, cx.offset);
          if (title)
            pos = cx.skipSpace(title.to);
        }
      }
      if (cx.char(pos) == 41) {
        content2.push(elt(Type.LinkMark, startPos, startPos + 1));
        endPos = pos + 1;
        if (dest)
          content2.push(dest);
        if (title)
          content2.push(title);
        content2.push(elt(Type.LinkMark, pos, endPos));
      }
    } else if (next == 91) {
      let label = parseLinkLabel(text, startPos - cx.offset, cx.offset, false);
      if (label) {
        content2.push(label);
        endPos = label.to;
      }
    }
    return elt(type, start, endPos, content2);
  }
  function parseURL(text, start, offset) {
    let next = text.charCodeAt(start);
    if (next == 60) {
      for (let pos = start + 1; pos < text.length; pos++) {
        let ch = text.charCodeAt(pos);
        if (ch == 62)
          return elt(Type.URL, start + offset, pos + 1 + offset);
        if (ch == 60 || ch == 10)
          return false;
      }
      return null;
    } else {
      let depth = 0, pos = start;
      for (let escaped = false; pos < text.length; pos++) {
        let ch = text.charCodeAt(pos);
        if (space3(ch)) {
          break;
        } else if (escaped) {
          escaped = false;
        } else if (ch == 40) {
          depth++;
        } else if (ch == 41) {
          if (!depth)
            break;
          depth--;
        } else if (ch == 92) {
          escaped = true;
        }
      }
      return pos > start ? elt(Type.URL, start + offset, pos + offset) : pos == text.length ? null : false;
    }
  }
  function parseLinkTitle(text, start, offset) {
    let next = text.charCodeAt(start);
    if (next != 39 && next != 34 && next != 40)
      return false;
    let end = next == 40 ? 41 : next;
    for (let pos = start + 1, escaped = false; pos < text.length; pos++) {
      let ch = text.charCodeAt(pos);
      if (escaped)
        escaped = false;
      else if (ch == end)
        return elt(Type.LinkTitle, start + offset, pos + 1 + offset);
      else if (ch == 92)
        escaped = true;
    }
    return null;
  }
  function parseLinkLabel(text, start, offset, requireNonWS) {
    for (let escaped = false, pos = start + 1, end = Math.min(text.length, pos + 999); pos < end; pos++) {
      let ch = text.charCodeAt(pos);
      if (escaped)
        escaped = false;
      else if (ch == 93)
        return requireNonWS ? false : elt(Type.LinkLabel, start + offset, pos + 1 + offset);
      else {
        if (requireNonWS && !space3(ch))
          requireNonWS = false;
        if (ch == 91)
          return false;
        else if (ch == 92)
          escaped = true;
      }
    }
    return null;
  }
  var InlineContext = class {
    /**
    @internal
    */
    constructor(parser7, text, offset) {
      this.parser = parser7;
      this.text = text;
      this.offset = offset;
      this.parts = [];
    }
    /**
    Get the character code at the given (document-relative)
    position.
    */
    char(pos) {
      return pos >= this.end ? -1 : this.text.charCodeAt(pos - this.offset);
    }
    /**
    The position of the end of this inline section.
    */
    get end() {
      return this.offset + this.text.length;
    }
    /**
    Get a substring of this inline section. Again uses
    document-relative positions.
    */
    slice(from, to) {
      return this.text.slice(from - this.offset, to - this.offset);
    }
    /**
    @internal
    */
    append(elt2) {
      this.parts.push(elt2);
      return elt2.to;
    }
    /**
    Add a [delimiter](#DelimiterType) at this given position. `open`
    and `close` indicate whether this delimiter is opening, closing,
    or both. Returns the end of the delimiter, for convenient
    returning from [parse functions](#InlineParser.parse).
    */
    addDelimiter(type, from, to, open, close) {
      return this.append(new InlineDelimiter(type, from, to, (open ? 1 : 0) | (close ? 2 : 0)));
    }
    /**
    Returns true when there is an unmatched link or image opening
    token before the current position.
    */
    get hasOpenLink() {
      for (let i = this.parts.length - 1; i >= 0; i--) {
        let part = this.parts[i];
        if (part instanceof InlineDelimiter && (part.type == LinkStart || part.type == ImageStart))
          return true;
      }
      return false;
    }
    /**
    Add an inline element. Returns the end of the element.
    */
    addElement(elt2) {
      return this.append(elt2);
    }
    /**
    Resolve markers between this.parts.length and from, wrapping matched markers in the
    appropriate node and updating the content of this.parts. @internal
    */
    resolveMarkers(from) {
      for (let i = from; i < this.parts.length; i++) {
        let close = this.parts[i];
        if (!(close instanceof InlineDelimiter && close.type.resolve && close.side & 2))
          continue;
        let emp = close.type == EmphasisUnderscore || close.type == EmphasisAsterisk;
        let closeSize = close.to - close.from;
        let open, j = i - 1;
        for (; j >= from; j--) {
          let part = this.parts[j];
          if (part instanceof InlineDelimiter && part.side & 1 && part.type == close.type && // Ignore emphasis delimiters where the character count doesn't match
          !(emp && (close.side & 1 || part.side & 2) && (part.to - part.from + closeSize) % 3 == 0 && ((part.to - part.from) % 3 || closeSize % 3))) {
            open = part;
            break;
          }
        }
        if (!open)
          continue;
        let type = close.type.resolve, content2 = [];
        let start = open.from, end = close.to;
        if (emp) {
          let size = Math.min(2, open.to - open.from, closeSize);
          start = open.to - size;
          end = close.from + size;
          type = size == 1 ? "Emphasis" : "StrongEmphasis";
        }
        if (open.type.mark)
          content2.push(this.elt(open.type.mark, start, open.to));
        for (let k = j + 1; k < i; k++) {
          if (this.parts[k] instanceof Element2)
            content2.push(this.parts[k]);
          this.parts[k] = null;
        }
        if (close.type.mark)
          content2.push(this.elt(close.type.mark, close.from, end));
        let element = this.elt(type, start, end, content2);
        this.parts[j] = emp && open.from != start ? new InlineDelimiter(open.type, open.from, start, open.side) : null;
        let keep = this.parts[i] = emp && close.to != end ? new InlineDelimiter(close.type, end, close.to, close.side) : null;
        if (keep)
          this.parts.splice(i, 0, element);
        else
          this.parts[i] = element;
      }
      let result = [];
      for (let i = from; i < this.parts.length; i++) {
        let part = this.parts[i];
        if (part instanceof Element2)
          result.push(part);
      }
      return result;
    }
    /**
    Find an opening delimiter of the given type. Returns `null` if
    no delimiter is found, or an index that can be passed to
    [`takeContent`](#InlineContext.takeContent) otherwise.
    */
    findOpeningDelimiter(type) {
      for (let i = this.parts.length - 1; i >= 0; i--) {
        let part = this.parts[i];
        if (part instanceof InlineDelimiter && part.type == type && part.side & 1)
          return i;
      }
      return null;
    }
    /**
    Remove all inline elements and delimiters starting from the
    given index (which you should get from
    [`findOpeningDelimiter`](#InlineContext.findOpeningDelimiter),
    resolve delimiters inside of them, and return them as an array
    of elements.
    */
    takeContent(startIndex) {
      let content2 = this.resolveMarkers(startIndex);
      this.parts.length = startIndex;
      return content2;
    }
    /**
    Return the delimiter at the given index. Mostly useful to get
    additional info out of a delimiter index returned by
    [`findOpeningDelimiter`](#InlineContext.findOpeningDelimiter).
    Returns null if there is no delimiter at this index.
    */
    getDelimiterAt(index) {
      let part = this.parts[index];
      return part instanceof InlineDelimiter ? part : null;
    }
    /**
    Skip space after the given (document) position, returning either
    the position of the next non-space character or the end of the
    section.
    */
    skipSpace(from) {
      return skipSpace(this.text, from - this.offset) + this.offset;
    }
    elt(type, from, to, children) {
      if (typeof type == "string")
        return elt(this.parser.getNodeType(type), from, to, children);
      return new TreeElement(type, from);
    }
  };
  InlineContext.linkStart = LinkStart;
  InlineContext.imageStart = ImageStart;
  function injectMarks(elements, marks) {
    if (!marks.length)
      return elements;
    if (!elements.length)
      return marks;
    let elts = elements.slice(), eI = 0;
    for (let mark of marks) {
      while (eI < elts.length && elts[eI].to < mark.to)
        eI++;
      if (eI < elts.length && elts[eI].from < mark.from) {
        let e = elts[eI];
        if (e instanceof Element2)
          elts[eI] = new Element2(e.type, e.from, e.to, injectMarks(e.children, [mark]));
      } else {
        elts.splice(eI++, 0, mark);
      }
    }
    return elts;
  }
  var NotLast = [Type.CodeBlock, Type.ListItem, Type.OrderedList, Type.BulletList];
  var FragmentCursor3 = class {
    constructor(fragments, input) {
      this.fragments = fragments;
      this.input = input;
      this.i = 0;
      this.fragment = null;
      this.fragmentEnd = -1;
      this.cursor = null;
      if (fragments.length)
        this.fragment = fragments[this.i++];
    }
    nextFragment() {
      this.fragment = this.i < this.fragments.length ? this.fragments[this.i++] : null;
      this.cursor = null;
      this.fragmentEnd = -1;
    }
    moveTo(pos, lineStart) {
      while (this.fragment && this.fragment.to <= pos)
        this.nextFragment();
      if (!this.fragment || this.fragment.from > (pos ? pos - 1 : 0))
        return false;
      if (this.fragmentEnd < 0) {
        let end = this.fragment.to;
        while (end > 0 && this.input.read(end - 1, end) != "\n")
          end--;
        this.fragmentEnd = end ? end - 1 : 0;
      }
      let c = this.cursor;
      if (!c) {
        c = this.cursor = this.fragment.tree.cursor();
        c.firstChild();
      }
      let rPos = pos + this.fragment.offset;
      while (c.to <= rPos)
        if (!c.parent())
          return false;
      for (; ; ) {
        if (c.from >= rPos)
          return this.fragment.from <= lineStart;
        if (!c.childAfter(rPos))
          return false;
      }
    }
    matches(hash2) {
      let tree = this.cursor.tree;
      return tree && tree.prop(NodeProp.contextHash) == hash2;
    }
    takeNodes(cx) {
      let cur = this.cursor, off = this.fragment.offset, fragEnd = this.fragmentEnd - (this.fragment.openEnd ? 1 : 0);
      let start = cx.absoluteLineStart, end = start, blockI = cx.block.children.length;
      let prevEnd = end, prevI = blockI;
      for (; ; ) {
        if (cur.to - off > fragEnd) {
          if (cur.type.isAnonymous && cur.firstChild())
            continue;
          break;
        }
        let pos = toRelative(cur.from - off, cx.ranges);
        if (cur.to - off <= cx.ranges[cx.rangeI].to) {
          cx.addNode(cur.tree, pos);
        } else {
          let dummy = new Tree(cx.parser.nodeSet.types[Type.Paragraph], [], [], 0, cx.block.hashProp);
          cx.reusePlaceholders.set(dummy, cur.tree);
          cx.addNode(dummy, pos);
        }
        if (cur.type.is("Block")) {
          if (NotLast.indexOf(cur.type.id) < 0) {
            end = cur.to - off;
            blockI = cx.block.children.length;
          } else {
            end = prevEnd;
            blockI = prevI;
          }
          prevEnd = cur.to - off;
          prevI = cx.block.children.length;
        }
        if (!cur.nextSibling())
          break;
      }
      while (cx.block.children.length > blockI) {
        cx.block.children.pop();
        cx.block.positions.pop();
      }
      return end - start;
    }
  };
  function toRelative(abs, ranges) {
    let pos = abs;
    for (let i = 1; i < ranges.length; i++) {
      let gapFrom = ranges[i - 1].to, gapTo = ranges[i].from;
      if (gapFrom < abs)
        pos -= gapTo - gapFrom;
    }
    return pos;
  }
  var markdownHighlighting = styleTags({
    "Blockquote/...": tags.quote,
    HorizontalRule: tags.contentSeparator,
    "ATXHeading1/... SetextHeading1/...": tags.heading1,
    "ATXHeading2/... SetextHeading2/...": tags.heading2,
    "ATXHeading3/...": tags.heading3,
    "ATXHeading4/...": tags.heading4,
    "ATXHeading5/...": tags.heading5,
    "ATXHeading6/...": tags.heading6,
    "Comment CommentBlock": tags.comment,
    Escape: tags.escape,
    Entity: tags.character,
    "Emphasis/...": tags.emphasis,
    "StrongEmphasis/...": tags.strong,
    "Link/... Image/...": tags.link,
    "OrderedList/... BulletList/...": tags.list,
    "BlockQuote/...": tags.quote,
    "InlineCode CodeText": tags.monospace,
    "URL Autolink": tags.url,
    "HeaderMark HardBreak QuoteMark ListMark LinkMark EmphasisMark CodeMark": tags.processingInstruction,
    "CodeInfo LinkLabel": tags.labelName,
    LinkTitle: tags.string,
    Paragraph: tags.content
  });
  var parser5 = new MarkdownParser(new NodeSet(nodeTypes).extend(markdownHighlighting), Object.keys(DefaultBlockParsers).map((n) => DefaultBlockParsers[n]), Object.keys(DefaultBlockParsers).map((n) => DefaultLeafBlocks[n]), Object.keys(DefaultBlockParsers), DefaultEndLeaf, DefaultSkipMarkup, Object.keys(DefaultInline).map((n) => DefaultInline[n]), Object.keys(DefaultInline), []);
  var StrikethroughDelim = { resolve: "Strikethrough", mark: "StrikethroughMark" };
  var Strikethrough = {
    defineNodes: [{
      name: "Strikethrough",
      style: { "Strikethrough/...": tags.strikethrough }
    }, {
      name: "StrikethroughMark",
      style: tags.processingInstruction
    }],
    parseInline: [{
      name: "Strikethrough",
      parse(cx, next, pos) {
        if (next != 126 || cx.char(pos + 1) != 126 || cx.char(pos + 2) == 126)
          return -1;
        let before = cx.slice(pos - 1, pos), after = cx.slice(pos + 2, pos + 3);
        let sBefore = /\s|^$/.test(before), sAfter = /\s|^$/.test(after);
        let pBefore = Punctuation.test(before), pAfter = Punctuation.test(after);
        return cx.addDelimiter(StrikethroughDelim, pos, pos + 2, !sAfter && (!pAfter || sBefore || pBefore), !sBefore && (!pBefore || sAfter || pAfter));
      },
      after: "Emphasis"
    }]
  };
  function parseRow(cx, line, startI = 0, elts, offset = 0) {
    let count = 0, first = true, cellStart = -1, cellEnd = -1, esc = false;
    let parseCell = () => {
      elts.push(cx.elt("TableCell", offset + cellStart, offset + cellEnd, cx.parser.parseInline(line.slice(cellStart, cellEnd), offset + cellStart)));
    };
    for (let i = startI; i < line.length; i++) {
      let next = line.charCodeAt(i);
      if (next == 124 && !esc) {
        if (!first || cellStart > -1)
          count++;
        first = false;
        if (elts) {
          if (cellStart > -1)
            parseCell();
          elts.push(cx.elt("TableDelimiter", i + offset, i + offset + 1));
        }
        cellStart = cellEnd = -1;
      } else if (esc || next != 32 && next != 9) {
        if (cellStart < 0)
          cellStart = i;
        cellEnd = i + 1;
      }
      esc = !esc && next == 92;
    }
    if (cellStart > -1) {
      count++;
      if (elts)
        parseCell();
    }
    return count;
  }
  function hasPipe(str, start) {
    for (let i = start; i < str.length; i++) {
      let next = str.charCodeAt(i);
      if (next == 124)
        return true;
      if (next == 92)
        i++;
    }
    return false;
  }
  var delimiterLine = /^[>\s]*\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?$/;
  var TableParser = class {
    constructor() {
      this.rows = null;
    }
    nextLine(cx, line, leaf) {
      if (this.rows == null) {
        this.rows = false;
        let lineText;
        if ((line.next == 45 || line.next == 58 || line.next == 124) && delimiterLine.test(lineText = line.text.slice(line.pos))) {
          let firstRow = [], firstCount = parseRow(cx, leaf.content, 0, firstRow, leaf.start);
          if (firstCount == parseRow(cx, lineText, 0))
            this.rows = [
              cx.elt("TableHeader", leaf.start, leaf.start + leaf.content.length, firstRow),
              cx.elt("TableDelimiter", cx.lineStart + line.pos, cx.lineStart + line.text.length)
            ];
        }
      } else if (this.rows) {
        let content2 = [];
        parseRow(cx, line.text, line.pos, content2, cx.lineStart);
        this.rows.push(cx.elt("TableRow", cx.lineStart + line.pos, cx.lineStart + line.text.length, content2));
      }
      return false;
    }
    finish(cx, leaf) {
      if (!this.rows)
        return false;
      cx.addLeafElement(leaf, cx.elt("Table", leaf.start, leaf.start + leaf.content.length, this.rows));
      return true;
    }
  };
  var Table = {
    defineNodes: [
      { name: "Table", block: true },
      { name: "TableHeader", style: { "TableHeader/...": tags.heading } },
      "TableRow",
      { name: "TableCell", style: tags.content },
      { name: "TableDelimiter", style: tags.processingInstruction }
    ],
    parseBlock: [{
      name: "Table",
      leaf(_, leaf) {
        return hasPipe(leaf.content, 0) ? new TableParser() : null;
      },
      endLeaf(cx, line, leaf) {
        if (leaf.parsers.some((p) => p instanceof TableParser) || !hasPipe(line.text, line.basePos))
          return false;
        let next = cx.peekLine();
        return delimiterLine.test(next) && parseRow(cx, line.text, line.basePos) == parseRow(cx, next, line.basePos);
      },
      before: "SetextHeading"
    }]
  };
  var TaskParser = class {
    nextLine() {
      return false;
    }
    finish(cx, leaf) {
      cx.addLeafElement(leaf, cx.elt("Task", leaf.start, leaf.start + leaf.content.length, [
        cx.elt("TaskMarker", leaf.start, leaf.start + 3),
        ...cx.parser.parseInline(leaf.content.slice(3), leaf.start + 3)
      ]));
      return true;
    }
  };
  var TaskList = {
    defineNodes: [
      { name: "Task", block: true, style: tags.list },
      { name: "TaskMarker", style: tags.atom }
    ],
    parseBlock: [{
      name: "TaskList",
      leaf(cx, leaf) {
        return /^\[[ xX]\][ \t]/.test(leaf.content) && cx.parentType().name == "ListItem" ? new TaskParser() : null;
      },
      after: "SetextHeading"
    }]
  };
  function parseSubSuper(ch, node, mark) {
    return (cx, next, pos) => {
      if (next != ch || cx.char(pos + 1) == ch)
        return -1;
      let elts = [cx.elt(mark, pos, pos + 1)];
      for (let i = pos + 1; i < cx.end; i++) {
        let next2 = cx.char(i);
        if (next2 == ch)
          return cx.addElement(cx.elt(node, pos, i + 1, elts.concat(cx.elt(mark, i, i + 1))));
        if (next2 == 92)
          elts.push(cx.elt("Escape", i, i++ + 2));
        if (space3(next2))
          break;
      }
      return -1;
    };
  }
  var Superscript = {
    defineNodes: [
      { name: "Superscript", style: tags.special(tags.content) },
      { name: "SuperscriptMark", style: tags.processingInstruction }
    ],
    parseInline: [{
      name: "Superscript",
      parse: parseSubSuper(94, "Superscript", "SuperscriptMark")
    }]
  };
  var Subscript = {
    defineNodes: [
      { name: "Subscript", style: tags.special(tags.content) },
      { name: "SubscriptMark", style: tags.processingInstruction }
    ],
    parseInline: [{
      name: "Subscript",
      parse: parseSubSuper(126, "Subscript", "SubscriptMark")
    }]
  };
  var Emoji = {
    defineNodes: [{ name: "Emoji", style: tags.character }],
    parseInline: [{
      name: "Emoji",
      parse(cx, next, pos) {
        let match;
        if (next != 58 || !(match = /^[a-zA-Z_0-9]+:/.exec(cx.slice(pos + 1, cx.end))))
          return -1;
        return cx.addElement(cx.elt("Emoji", pos, pos + 1 + match[0].length));
      }
    }]
  };

  // lezer-lua/lua-parser.js
  var spec_identifier4 = { __proto__: null, break: 16, goto: 20, do: 24, end: 26, while: 30, nil: 32, true: 34, false: 36, or: 80, and: 82, not: 106, function: 114, repeat: 120, until: 122, if: 126, then: 128, elseif: 130, else: 132, for: 136, in: 144, local: 154, return: 168 };
  var parser6 = LRParser.deserialize({
    version: 14,
    states: "<bO!ZQPOOOOQO'#Cc'#CcO!UQPO'#CaO!bQPOOOOQO'#Ee'#EeO!vQQO'#CwO$YQPO'#EdOOQO'#Ed'#EdO$dQPO'#EdOOQO'#D}'#D}O%sQPO'#D|OOQO'#E`'#E`OOQO'#ET'#ETO%xQPO'#C_OOQO'#C_'#C_QOQPOOO!UQPO'#CeO&]QPO'#CgO!vQQO'#CjO&dQPO'#DiO!vQQO'#DlO!UQPO'#DqO!UQPO'#DxO&kQPO'#EOO&sQQO'#ERO'ZQPO,58{OOQO'#Cq'#CqO!UQPO,59^O!vQQO,59`O(aQQO'#C|O(hQQO'#EjOOQO'#Ef'#EfOOQO,59f,59fO!UQPO,59fO(oQPO'#EbO,_QPO,59cOOQO'#Dd'#DdOOQO'#De'#DeO!vQQO'#DbOOQO'#Eb'#EbO,fQPO'#DfO,kQPO'#EYO,sQPO,5;dO!vQQO,5:hOOQO-E8R-E8ROOQO,58y,58yOOQO,59P,59PO,{QPO,59RO-QQPO,59UO-XQPO,5:TO-^QPO,5:WO-eQPO'#EwOOQO'#Du'#DuO-pQPO'#DtO-uQPO,5:]O-zQPO'#DyO,fQPO,5:dO.VQQO'#EyOOQO'#EP'#EPO!UQPO,5:fO/mQPO,5:jO0}QPO,5:mOOQO,5:m,5:mOOQO1G.g1G.gOOQO1G.x1G.xO1eQPO1G.zO1lQSO'#EbO2xQSO'#EeO!vQQO'#DOO5mQSO'#DQOOQO'#Eg'#EgOOQO,59h,59hO5wQSO,59hO5|QPO'#EkOOQO,5;U,5;UO7cQPO,5;UO7hQPO1G/QOOQO1G.}1G.}OOQO'#DX'#DXOOQO'#DY'#DYOOQO'#DZ'#DZOOQO'#D['#D[OOQO'#D^'#D^OOQO'#D_'#D_OOQO'#Da'#DaO!vQQO,59oO!vQQO,59oO!vQQO,59oO!vQQO,59oO!vQQO,59oO!vQQO,59oOOQO,59o,59oO!vQQO,59oO!vQQO,59oO!vQQO,59oO8wQPO,59|O:dQPO'#DhOOQO,5:Q,5:QO:iQPO,5:tOOQO-E8W-E8WOOQO'#Dw'#DwOOQO1G0S1G0SOOQO1G.m1G.mO&]QPO1G.pO!vQQO1G/oO:sQPO1G/rO!vQQO,5:_O!UQPO'#EWO:}QPO,5;cO!vQQO,5:`O&]QPO1G/wO!UQPO'#EXO;VQPO,5:eO!UQPO,5:eOOQO1G0O1G0OO!UQPO'#EQO;bQPO,5;eO,fQPO1G0QO!vQQO1G0UOOQO1G0X1G0XOOQO7+$f7+$fO<uQQO,59kO=sQPO,59jO'`QQO1G/SO=zQSO,59|O!vQQO'#EUO>UQPO,5;VOOQO1G0p1G0pOOQO7+$l7+$lOBRQPO1G/ZOBYQPO1G/ZODyQPO1G/ZOEQQPO1G/ZOGkQPO1G/ZOGxQPO1G/ZOIyQPO1G/ZOM`QPO1G/ZOMgQPO1G/ZO&]QPO,5:SOMnQPO7+$[OMsQPO7+%ZO! SQPO7+%^O! [QPO1G/yOOQO,5:r,5:rOOQO-E8U-E8UOOQO1G/z1G/zO! cQPO7+%cOOQO,5:s,5:sOOQO-E8V-E8VO!UQPO1G0POOQO1G0P1G0PO! hQQO,5:lO!UQPO'#EZO! mQPO1G1POOQO7+%l7+%lOOQO7+%p7+%pO!#QQSO1G/VO!#[QPO1G/UO!$hQSO1G/ZO!$oQSO1G/ZO!%}QSO1G/ZO!&UQSO1G/ZO!'^QSO1G/ZO!'kQSO1G/ZO!(ZQSO1G/ZO!*_QSO1G/ZO!*fQSO1G/ZO!*mQSO7+$nO!*uQPO,5:pOOQO-E8S-E8SO!,[QPO1G/nOOQO<<Gv<<GvO!,aQPO<<HxO!vQQO'#EVO&]QPO<<HxO!vQQO7+%eOOQO<<H}<<H}OOQO7+%k7+%kOOQO1G0W1G0WO.VQQO,5:uOOQO-E8X-E8XO<uQQO7+$pOOQO<<HY<<HYO!,iQPO<<HYOOQO7+%Y7+%YOOQO-E8T-E8TO&]QPOAN>dO!,nQPO,5:qO!,uQPOAN>dO!,zQPO<<IPOOQO1G0a1G0aO!-UQSO<<H[OOQOAN=tAN=tO!-`QPOG24OO:sQPO1G0]OOQOG24OG24OO!vQQOAN>kOOQOLD)jLD)jOOQO7+%w7+%wO!-eQPOG24VO<uQQO'#DbO<uQQO,59oO<uQQO,59oO<uQQO,59oO<uQQO,59oO<uQQO,59oO<uQQO,59oO<uQQO,59oO<uQQO,59oO<uQQO,59o",
    stateData: "!-o~O#QOS#ROSPOS~OSZOUQOWZOY`O[aO_bOlTO!ZfO!^cO!adO!feO!ogO!vhO#TPO~O#ORP~P]OgkOilOlnOoqOqmO#VjO~O`wOawObwOcwOdwOlTOqmO!VvO!ZxO#TPO#VjO#buO#etO#ftO~Og#WXi#WXl#WXo#WXq#WX#V#WX~OvyO#[#lX~P#tOS#SXU#SXW#SXY#SX[#SX_#SXl#SX!Z#SX!^#SX!a#SX!f#SX!o#SX!v#SX#O#SX#T#SX]#SX!_#SX!c#SX!d#SX~P#tO#[{O~O#ORX]RX!_RX!cRX!dRX~P]O]RP~P]O!_RP~P]O!Z!]O#TPO~OS!`O#O!uX]!uX!_!uX!c!uX!d!uX~P!vOU!aO~O`wOawObwOcwOdwOi!fOlTOqmO!V%`O!ZxO#TPO#VjO#buO#etO#ftO~Ou!iO~P'`Om!lO~P!vOm#UXx#UXy#UXz#UX!P#UX!S#UX#`#UX#a#UX#b#UX#c#UX#d#UX#e#UX#f#UX#g#UX#h#UX#i#UX#j#UX[#UX!b#UXS#UX#O#UXj#UXv#UXU#UXW#UXY#UX_#UX!Z#UX!^#UX!a#UX!f#UX!o#UX!v#UX#T#UX]#UX!_#UX!c#UX!d#UX~P!bOx#POy#QOz!wO!P!{O!S!uO#`!pO#a!qO#b!rO#c!sO#d!sO#e!tO#f!tO#g!uO#h!uO#i!uO#j!vO~Om!oO~P+ZOl#SO~OlTO#TPO~OvyO#[#la~O]#YO~O[#ZO~P+ZO!_#[O~O!b#]O~P+ZOv#_O#[#^O!j#kX~O!j#aO~O[#bO~Og#cOo#eOl!mX~O#n#gOS!tPU!tPW!tPY!tP[!tP_!tPl!tPv!tP!Z!tP!^!tP!a!tP!f!tP!o!tP!v!tP#O!tP#T!tP#[!tP]!tP!_!tP!c!tP!d!tP~O#[#jOS!raU!raW!raY!ra[!ra_!ral!ra!Z!ra!^!ra!a!ra!f!ra!o!ra!v!ra#O!ra#T!ra]!ra!_!ra!c!ra!d!ra~OS#kO#O!ua]!ua!_!ua!c!ua!d!ua~P+ZOj#lO~P+ZOx#UXy#UXz#UX!P#UX!S#UX#]#UX#`#UX#a#UX#b#UX#c#UX#d#UX#e#UX#f#UX#g#UX#h#UX#i#UX#j#UXu#UX~P!bO#[#mOg#XXi#XXl#XXo#XXq#XXx#XXy#XXz#XX!P#XX!S#XX#V#XX#]#XX#`#XX#a#XX#b#XX#c#XX#d#XX#e#XX#f#XX#g#XX#h#XX#i#XX#j#XXu#XX~Ox%hOy%iOz%aO!P%eO!S!uO#`!pO#a!qO#b!rO#c!sO#d!sO#e!tO#f!tO#g!uO#h!uO#i!uO#j!vO~O#]tXutX~P4iO#]#oO~Ov#qOm#_XS#_XU#_XW#_XY#_X[#_X_#_Xl#_X!Z#_X!^#_X!a#_X!f#_X!o#_X!v#_X#O#_X#T#_X]#_X!_#_X!c#_X!d#_X~P+ZOm#sO~OlnOqmO#VjO~O#j!vOx!Uay!Uaz!Ua!P!Ua!S!Ua#`!Ua#a!Ua#b!Ua#c!Ua#d!Ua#e!Ua#f!Ua#g!Ua#h!Ua#i!Ua~Om!Ua[!Ua!b!UaS!Ua#O!Uaj!Uav!UaU!UaW!UaY!Ua_!Ual!Ua!Z!Ua!^!Ua!a!Ua!f!Ua!o!Ua!v!Ua#T!Ua]!Ua!_!Ua!c!Ua!d!Ua~P7sOm$OO~Ov!|a#[!|a~P#tO!cRP!dRP~P]Ov#_O!j#ka~Og#cOo$ZOl!ma~Ov$^OS#maU#maW#maY#ma[#ma_#mal#ma!Z#ma!^#ma!a#ma!f#ma!o#ma!v#ma#O#ma#T#ma#[#ma]#ma!_#ma!c#ma!d#ma~O`wOawObwOcwOdwOlTOqmO!V%`O!ZxO#TPO#VjO#buO#etO#ftO~Oj$cO~P+ZO#]!Uau!Ua~P7sOv#qOm#_aS#_aU#_aW#_aY#_a[#_a_#_al#_a!Z#_a!^#_a!a#_a!f#_a!o#_a!v#_a#O#_a#T#_a]#_a!_#_a!c#_a!d#_a~O!P!{O!S!uO#a!qO#b!rO#c!sO#d!sO#e!tO#f!tO#g!uO#h!uO#i!uO#j!vOmwixwiywizwi[wi!bwiSwi#OwijwivwiUwiWwiYwi_wilwi!Zwi!^wi!awi!fwi!owi!vwi#Twi]wi!_wi!cwi!dwi~O#`!pO~P?iO#`wi~P?iO!P!{O!S!uO#c!sO#d!sO#e!tO#f!tO#g!uO#h!uO#i!uO#j!vOmwixwiywizwi#`wi#bwi[wi!bwiSwi#OwijwivwiUwiWwiYwi_wilwi!Zwi!^wi!awi!fwi!owi!vwi#Twi]wi!_wi!cwi!dwi~O#awi~PBaO#a!qO~PBaO!S!uO#g!uO#h!uO#i!uO#j!vOmwixwiywizwi#`wi#awi#bwi#cwi#dwi[wi!bwiSwi#OwijwivwiUwiWwiYwi_wilwi!Zwi!^wi!awi!fwi!owi!vwi#Twi]wi!_wi!cwi!dwi~O!P!{O#e!tO#f!tO~PEXO!Pwi#ewi#fwi~PEXO#j!vOmwixwiywi[wi!bwiSwi#OwijwivwiUwiWwiYwi_wilwi!Zwi!^wi!awi!fwi!owi!vwi#Twi]wi!_wi!cwi!dwi~Ozwi!Pwi!Swi#`wi#awi#bwi#cwi#dwi#ewi#fwi#gwi#hwi#iwi~PHVOz!wO!P!{O!S!uO#`!pO#a!qO#b!rO#c!sO#d!sO#e!tO#f!tO#g!uO#h!uO#i!uO#j!vOmwixwi[wi!bwiSwi#OwijwivwiUwiWwiYwi_wilwi!Zwi!^wi!awi!fwi!owi!vwi#Twi]wi!_wi!cwi!dwi~Oy#QO~PJvOywi~PJvO]$qO~OS!]qU!]qW!]qY!]q[!]q_!]ql!]q!Z!]q!^!]q!a!]q!f!]q!o!]q!v!]q#O!]q#T!]q]!]q!_!]q!c!]q!d!]q~P+ZO!c$sO!d$tO~Ov$uO~P+ZO]$vO~O#o$xO~Ov$^OS#miU#miW#miY#mi[#mi_#mil#mi!Z#mi!^#mi!a#mi!f#mi!o#mi!v#mi#O#mi#T#mi#[#mi]#mi!_#mi!c#mi!d#mi~O#]siusi~P4iO#[${O~O!P%eO!S!uO#a!qO#b!rO#c!sO#d!sO#e!tO#f!tO#g!uO#h!uO#i!uO#j!vOxwiywizwi#]wiuwi~O#`!pO~P!#aO#`wi~P!#aO!P%eO!S!uO#c!sO#d!sO#e!tO#f!tO#g!uO#h!uO#i!uO#j!vOxwiywizwi#]wi#`wi#bwiuwi~O#awi~P!$vO#a!qO~P!$vO!S!uO#g!uO#h!uO#i!uO#j!vOxwiywizwi#]wi#`wi#awi#bwi#cwi#dwiuwi~O!P%eO#e!tO#f!tO~P!&]O!Pwi#ewi#fwi~P!&]O#j!vOxwiywi#]wiuwi~Ozwi!Pwi!Swi#`wi#awi#bwi#cwi#dwi#ewi#fwi#gwi#hwi#iwi~P!'xOz%aO!P%eO!S!uO#`!pO#a!qO#b!rO#c!sO#d!sO#e!tO#f!tO#g!uO#h!uO#i!uO#j!vOxwi#]wiuwi~Oy%iO~P!)WOywi~P!)WOu$|O#]$}O~Om!xav!xaS!xaU!xaW!xaY!xa[!xa_!xal!xa!Z!xa!^!xa!a!xa!f!xa!o!xa!v!xa#O!xa#T!xa]!xa!_!xa!c!xa!d!xa~P+ZO]%OO~O!c$sO!d%QO~Ou%WO~O!b%YO~P+ZO]%ZO~Ov%[O[!gy~P+ZO#]ryury~P4iO]%]O~O[!g!Z~P+ZOP#f~",
    goto: ":P#nPPP#oP$_P$lP$_P$_PP$_PPPPPP&r'tP'tPP(|PP*UP&rP+`+`+`PP&xPPP+d,O,n-[P-|.pP/d&xP0^0^&xP1[$_PP$_PPPP$_P1e1e1hP1k$_1t$_P$_1w$_2U2X2_P2n2}3T3Z3a3g3mPPPP3sP4QP6f7r9O9WPP9^9dPPPPPPPPPPP9l9o9|Q_OQ!PaQ!RcQ$P#ZQ$R#]Q$W#bQ$p$OQ%S$tQ%X%QR%^%YgZO]ac#Z#]#b$O$t%Q%Y#WSOT]abcdhlnvy{!f!w!x!y!z!{!|#O#P#Q#Z#[#]#^#a#b#j#m#q$O$s$t$u${%Q%Y%[%`%a%b%c%d%e%f%g%h%iQiQQ!O`Q!TeQ!XfQ!ZgQ!bkS!em#oQ!nqQ#i!]Q$T#_Q$X#cQ$[#eQ$]#gQ$w$ZR$y$^WoRr!d!n!swTbdhlmnv{!f!w!x!y!z!{!|#O#P#Q#[#^#a#j#m#o#q$s$u${%[%`%a%b%c%d%e%f%g%h%i#]SOT]abcdhlmnvy{!f!w!x!y!z!{!|#O#P#Q#Z#[#]#^#a#b#j#m#o#q$O$s$t$u${%Q%Y%[%`%a%b%c%d%e%f%g%h%i#]VOT]abcdhlmnvy{!f!w!x!y!z!{!|#O#P#Q#Z#[#]#^#a#b#j#m#o#q$O$s$t$u${%Q%Y%[%`%a%b%c%d%e%f%g%h%i!tVTbdhlmnvy{!f!w!x!y!z!{!|#O#P#Q#[#^#a#j#m#o#q$s$u${%[%`%a%b%c%d%e%f%g%h%igWO]ac#Z#]#b$O$t%Q%YT!hm#op!xs!Q!S!_!c!k#n#u#|#}$Q$S$n%R%T%_]%b!g$b$d$k$l%Vt!ys!Q!S!_!c!k#n#u#v#x#|#}$Q$S$n%R%T%_a%c!g$b$d$e$g$k$l%Vr!zs!Q!S!_!c!k#n#u#v#|#}$Q$S$n%R%T%__%d!g$b$d$e$k$l%Vv!{s!Q!S!_!c!k#n#u#v#w#x#|#}$Q$S$n%R%T%_c%e!g$b$d$e$f$g$k$l%Vx!|s!Q!S!_!c!k#n#u#v#w#x#y#|#}$Q$S$n%R%T%_e%f!g$b$d$e$f$g$h$k$l%V!c!}s!Q!S!_!c!g!k#n#u#v#w#x#y#z#|#}$Q$S$b$d$e$f$g$h$i$k$l$n%R%T%V%_!O#Os!Q!S!_!c!k#R#n#u#v#w#x#y#z#{#|#}$Q$S$n%R%T%_k%g!g#p$b$d$e$f$g$h$i$j$k$l%V!UvTbdhlnv{!f!w!x!y!z!{!|#O#P#Q#[#^#a#j#q$s$u%[m%`m#m#o${%`%a%b%c%d%e%f%g%h%iQ#TxQ#f!YR$`#iR!WeR!VeQ#X{Q$V#aR$a#jR!YfgYO]ac#Z#]#b$O$t%Q%YR!^gQ#h!ZR%U$yd^Oac#Z#]#b$O$t%Q%YR}]d]Oac#Z#]#b$O$t%Q%YR|]Q#r!kR$o#rQ$r$RR%P$rQ#`!TR$U#`Q#d!XR$Y#dQzUR#VzQ$_#hR$z$_g[O]ac#Z#]#b$O$t%Q%YQsTQ!QbQ!SdQ!_hQ!clS!gm#oW!kn{#a#jQ#RvQ#n!fQ#p%`Q#u!wQ#v!xQ#w!yQ#x!zQ#y!{Q#z!|Q#{#OQ#|#PQ#}#QQ$Q#[Q$S#^Q$b#mQ$d%aQ$e%bQ$f%cQ$g%dQ$h%eQ$i%fQ$j%gQ$k%hQ$l%iQ$n#qQ%R$sQ%T$uQ%V${R%_%[hRO]acy#Z#]#b$O$t%Q%Y!UrTbdhlnv{!f!w!x!y!z!{!|#O#P#Q#[#^#a#j#q$s$u%[m!dm#m#o${%`%a%b%c%d%e%f%g%h%ifUO]ac#Z#]#b$O$t%Q%Y!rVTbdhlmnv{!f!w!x!y!z!{!|#O#P#Q#[#^#a#j#m#o#q$s$u${%[%`%a%b%c%d%e%f%g%h%iR#UyUpRr!dR#t!nQ!jmR$m#oXoRr!d!nQ!mnV#W{#a#jR!UegXO]ac#Z#]#b$O$t%Q%YR![g",
    nodeNames: "\u26A0 Comment Chunk Block ; Label :: Name break Goto goto Scope do end WhileStatement while nil true false Ellipsis Number LiteralString Property . MemberExpression [ ] Parens ( ) FunctionCall : TableConstructor { FieldDynamic FieldProp FieldExp } , BinaryExpression or and CompareOp BitOp BitOp BitOp BitOp Concat ArithOp ArithOp * ArithOp UnaryExpression not ArithOp BitOp FunctionDef function FuncBody RepeatStatement repeat until IfStatement if then elseif else ForStatement for ForNumeric ForGeneric NameList in ExpList Function FuncName LocalFunction local Assign VarList Local AttNameList Attrib ReturnStatement return",
    maxTerm: 123,
    nodeProps: [
      ["group", -14, 4, 5, 8, 9, 11, 14, 30, 59, 62, 67, 74, 76, 78, 80, "Statement", -3, 34, 35, 36, "Field"]
    ],
    skippedNodes: [0, 1],
    repeatNodeCount: 7,
    tokenData: "6s~RrXY#]YZ#w[]#]]^$Upq#]rs$^uv)avw)fwx)kxy.iyz.nz{.s{|.x|}.}}!O/U!O!P/x!P!Q0_!Q!R0l!R![2Q![!]4U!]!^4c!^!_4j!_!`5R!`!a5Z!c!}5m!}#O5{#O#P#n#P#Q6Q#Q#R6V#T#o5m#o#p6[#p#q6a#q#r6f#r#s6k~#bS#R~XY#][]#]pq#]#O#P#n~#qQYZ#]]^#]~#|P#Q~]^$P~$UO#Q~~$ZP#Q~YZ$P~$aWOY$yZ]$y^r$ys#O$y#O#P%n#P;'S$y;'S;=`(O<%lO$y~$|XOY$yZ]$y^r$yrs%is#O$y#O#P%n#P;'S$y;'S;=`(O<%lO$y~%nO#V~~%qZrs$ywx$y!Q![&d#O#P$y#T#U$y#U#V$y#Y#Z$y#b#c$y#i#j(U#l#m(w#n#o$y~&gZOY$yZ]$y^r$yrs%is!Q$y!Q!['Y![#O$y#O#P%n#P;'S$y;'S;=`(O<%lO$y~']ZOY$yZ]$y^r$yrs%is!Q$y!Q![$y![#O$y#O#P%n#P;'S$y;'S;=`(O<%lO$y~(RP;=`<%l$y~(XP#o#p([~(_R!Q![(h!c!i(h#T#Z(h~(kS!Q![(h!c!i(h#T#Z(h#q#r$y~(zR!Q![)T!c!i)T#T#Z)T~)WR!Q![$y!c!i$y#T#Z$y~)fO#h~~)kO#a~~)nWOY*WZ]*W^w*Wx#O*W#O#P*v#P;'S*W;'S;=`-W<%lO*W~*ZXOY*WZ]*W^w*Wwx%ix#O*W#O#P*v#P;'S*W;'S;=`-W<%lO*W~*yZrs*Wwx*W!Q![+l#O#P*W#T#U*W#U#V*W#Y#Z*W#b#c*W#i#j-^#l#m.P#n#o*W~+oZOY*WZ]*W^w*Wwx%ix!Q*W!Q![,b![#O*W#O#P*v#P;'S*W;'S;=`-W<%lO*W~,eZOY*WZ]*W^w*Wwx%ix!Q*W!Q![*W![#O*W#O#P*v#P;'S*W;'S;=`-W<%lO*W~-ZP;=`<%l*W~-aP#o#p-d~-gR!Q![-p!c!i-p#T#Z-p~-sS!Q![-p!c!i-p#T#Z-p#q#r*W~.SR!Q![.]!c!i.]#T#Z.]~.`R!Q![*W!c!i*W#T#Z*W~.nOl~~.sOm~~.xO!S~~.}O#e~V/UOvR#]S~/ZP#f~}!O/^~/cTP~OY/^Z]/^^;'S/^;'S;=`/r<%lO/^~/uP;=`<%l/^V/}PgT!O!P0QV0VP!PT!O!P0YQ0_OcQ~0dP#g~!P!Q0g~0lO#i~~0qUd~!O!P1T!Q![2Q!g!h1i!z!{2c#X#Y1i#l#m2c~1WP!Q![1Z~1`Rd~!Q![1Z!g!h1i#X#Y1i~1lQ{|1r}!O1r~1uP!Q![1x~1}Pd~!Q![1x~2VSd~!O!P1T!Q![2Q!g!h1i#X#Y1i~2fR!Q![2o!c!i2o#T#Z2o~2tUd~!O!P3W!Q![2o!c!i2o!r!s3x#T#Z2o#d#e3x~3ZR!Q![3d!c!i3d#T#Z3d~3iTd~!Q![3d!c!i3d!r!s3x#T#Z3d#d#e3x~3{R{|1r}!O1r!P!Q1r~4ZPo~![!]4^~4cOU~V4jOSR#]SV4qQ#nQzT!^!_4w!_!`4|T4|O#cTT5ROzT~5WP#[~!_!`4|V5bQ#oQzT!_!`4|!`!a5hT5mO#dT~5rR#T~!Q![5m!c!}5m#T#o5m~6QOi~~6VOj~~6[O#j~~6aOq~~6fO#`~~6kOu~~6pP#b~!_!`4|",
    tokenizers: [0, 1, 2],
    topRules: { "Chunk": [0, 2] },
    dynamicPrecedences: { "106": 1 },
    specialized: [{ term: 97, get: (value) => spec_identifier4[value] || -1 }],
    tokenPrec: 2696
  });

  // main.js
  var errorProps = [styleTags({
    '"\\u26a0"!': tags.invalid
  })];
  var parsers = {
    js: parser2.configure({ props: errorProps }),
    css: parser3.configure({ props: errorProps }),
    cpp: parser4.configure({ props: errorProps }),
    md: parser5.configure({ props: errorProps }),
    lua: parser6.configure({ props: errorProps })
  };
  parsers.html = parser.configure({
    props: errorProps,
    wrap: parseMixed((node) => {
      if (node.name == "ScriptText") return { parser: parsers.js };
      if (node.name == "StyleText") return { parser: parsers.css };
    })
  });
  window.Lezer = {
    Tree,
    TreeFragment,
    classHighlighter,
    highlightTree,
    parsers
  };
})();
