import {parseMixed, Tree, TreeFragment} from "@lezer/common";
import {
	classHighlighter,
	highlightTree,
	styleTags,
	tags,
} from "@lezer/highlight";
import {parser as htmlParser} from "@lezer/html";
import {parser as jsParser} from "@lezer/javascript";
import {parser as cssParser} from "@lezer/css";
import {parser as cppParser} from "@lezer/cpp";
import {parser as mdParser} from "@lezer/markdown";
import {parser as luaParser} from "./lezer-lua/lua-parser.js";

let errorProps = [styleTags({
	'"\\u26a0"!': tags.invalid,
})];
let parsers = {
	js:  jsParser.configure({props: errorProps}),
	css: cssParser.configure({props: errorProps}),
	cpp: cppParser.configure({props: errorProps}),
	md:  mdParser.configure({props: errorProps}),
	lua: luaParser.configure({props: errorProps}),
};
parsers.html = htmlParser.configure({
	props: errorProps,
	wrap: parseMixed(node => {
		if (node.name == 'ScriptText') return { parser: parsers.js }
		if (node.name == 'StyleText' ) return { parser: parsers.css }
	})
});

window.Lezer = {
	Tree,
	TreeFragment,
	classHighlighter,
	highlightTree,
	parsers,
};
