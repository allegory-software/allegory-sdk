/*

	Functional CSS library & reset.
	Written by Cosmin Apreutesei. Public Domain.

CSS CLASSES:
	TEXT          pre[-line] [x]small[er] [x]large tight lh1 [no-]bold italic underline strike allcaps noselect zwsp
	TEXT COLORS   dim[-on-dark] white label link
	ALIGN INLINE  t-{l r c j m t b bas sub sup`) float-{l r`)
	ALIGN FLEX    h-{l r c sb s t b m bl`) v-{t b m sb s l r c`) S[1-5] flex-[no]wrap order-{1 2 last`)
	ALIGN GRID    grid-{l r c sb s t b m bl`)', '', `x y`){1-5`) x..x y..y
	GAPS F,G      gap[-x- -y-][0 025 05 075 2 4 8]
	ALIGN F,G     self-h-{t m b s`) self-v-{l c r s`)
	ALIGN F,G,B,A self-h-{l r c`) self-v-{t b m`)
	SIZING        nowrap shrinks
	BORDERS       b[0] b-{l r t b`)[-0] b-{dotted dashed invisible fg`)
	CORNERS       ro[05 075 0 2] ro-{l r t b`)-0 round ro-group-{h v`)
	PADDINGS      p[0 05 2 4 8] p-{l r t b x y`)-{0 05 2 4 8`)
	MARGINS       m[0 05 2 4 8] m-{l r t b x y`)-{0 05 2 4 8`)', '', `ml mr mx`)-auto
	OUTLINE       outline-focus no-outline
	OVERFLOW      [v h]scroll[-auto] [no]clip[-x -y] scroll-thin
	POSITIONING   rel abs z{1 2 3 4 5`) overlay
	VISIBILITY    hidden skip click-through[-off]
	FLAT BGs      bg[1 2 -alt -smoke -fg] no-bg
	IMAGE BGs     bg-{cover contain center t r b l no-repeat repeat-{x y`)`)
	FILTERS       [in]visible op[0 1 01-09] darken lighten no-filter
	SHADOWS       ring shadow-{tooltip thumb menu button pressed modal toolbox`) no-shadow
	TRANSFORMS    flip-{h v`) rotate-{90 180 270`)
	TRANSITIONS   ease ease-{01s 05s 1s`) no-ease ease-out ease-fw
	ANIMATIONS    beat bounce fade beat-fade flip shake spin spin-pulse forever once reverse
	CURSORS       arrow hand grab grabbing
	FONTS         mono arial opensans[-condensed] inter
	MAT ICONS     mi[-round -sharp -outlined -fill -no-fill]
	FA ICONS      fa[r] fa-*

HTML SELECTORS:
	*[dim] *[nowrap]
	img[invertable]

NOTES:
	You must add the theme-light class to <html> for theme-inverted class to work!

*/

{

let css = css_util

/* COLORS ----------------------------------------------------------------- */

css(':root, .theme-light, .theme-dark .theme-inverted', '', `

	--fg                    : hsl(  0   0%   0% / 1.0);
	--fg-p                  : hsl(  0   0%   0% / 0.9); /* multiline text on normal backgrounds (just a tad dimmer than fg) */
	--fg-white              : hsl(  0   0% 100% / 1.0);
	--fg-black              : hsl(  0   0%   0% / 1.0);
	--fg-dim                : hsl(  0   0%   0% / 0.5); /* faded (not gray!) text but clearly legible (disabled, info boxes) */
	--fg-dim-on-dark        : hsl(  0   0% 100% / 0.5); /* same but on dark or colored bg */
	--fg-label              : hsl(  0   0%   0% / 0.8); /* between fg and dim (edit labels, chart labels) */
	--fg-label-on-dark      : hsl(  0   0% 100% / 0.8); /* same but on dark or colored bg */
	--fg-link               : hsl(222 100%  40% / 1.0); /* anything clickable inside text: links, bare buttons, checkboxes */
	--fg-link-hover         : hsl(222 100%  45% / 1.0);
	--fg-link-active        : hsl(222 100%  55% / 1.0);

	--bg                    : hsl(  0   0% 100% / 1.0); /* opaque */
	--bg-hover              : hsl(  0   0%  99% / 1.0); /* opaque */
	--bg-active             : hsl(  0   0%  98% / 1.0); /* opaque */
	--bg1                   : hsl(  0   0%  95% / 1.0); /* sits on bg; opaque */
	--bg2                   : hsl(  0   0%  85% / 1.0); /* sits on bg1; opaque */
	--bg2-hover             : hsl(  0   0%  90% / 1.0);
	--bg-alt                : hsl(  0   0%  97% / 1.0); /* alternating bg for grid rows; lighter than bg1 */
	--bg-smoke              : hsl(  0   0%   0% / 0.2); /* overlays bg */
	--bg-input              : var(--bg);

	--border-light          : hsl(  0   0%   0% / 0.1); /* sits on bg */
	--border-light-hover    : hsl(  0   0%   0% / 0.3);
	--border-light-on-dark  : hsl(  0   0% 100% / 0.1); /* sits on bg */
	--border-light-on-dark-hover
	                        : hsl(  0 100% 100% / 0.3);

	--outline-focus         : hsl(  0 100%   0% / 1.0);

	--fg-button                 : var(--fg);
	--bg-button                 : var(--bg);
	--bg-button-hover           : var(--bg-hover);
	--bg-button-active          : var(--bg-active);

	--fg-button-primary         : var(--fg-white);
	--bg-button-primary         : var(--fg-link);
	--bg-button-primary-hover   : var(--fg-link-hover);
	--bg-button-primary-active  : var(--fg-link-active);

	--fg-button-danger          : hsl(  0  54%  43% / 1.0); /* red fg */
	--bg-button-danger          : var(--bg-button);
	--bg-button-danger-hover    : var(--bg-button-hover);
	--bg-button-danger-active   : var(--bg-button-active);

	--fg-search             : var(--fg); /* quicksearch text over quicksearch bg */
	--bg-search             : #ff9;  /* quicksearch text bg */
	--bg-info               : #069;  /* info bubbles */
	--fg-info               : var(--fg-white);
	--bg-error              : #a33; /* invalid inputs and error bubbles */
	--fg-error              : var(--fg-white);
	--bg-warn               : #ffa500; /* warning bubbles */
	--fg-warn               : var(--fg);

	/* input value states */
	--bg-new                : #eeeeff;
	--bg-modified           : #ddffdd;
	--bg-new-modified       : #ccf0f0;

	/* item interaction states. these need to be opaque! */
	--bg-unfocused          : #999;
	--bg-focused            : #ddd;
	--bg-unfocused-selected : #333;
	--fg-unfocused-selected : var(--fg-white);
	--bg-focused-selected   : #258;
	--fg-focused-selected   : var(--fg-white);
	--bg-focused-error      : #f33;
	--bg-unselected         : #888;
	--bg-selected           : #69c;
	--fg-selected           : var(--fg-white);
	--fg-focused            : var(--fg-white);
	--bg-row-focused        : #ddd;

	--ring                  : hsl(  0 100%   0% / .25);

	--shadow-tooltip        :  2px  2px  9px      #00000044;
	--shadow-toolbox        :  1px  1px  4px      #000000aa;
	--shadow-menu           :  2px  2px  2px      #000000aa;
	--shadow-button         :  0px  0px  2px  0px #00000011;
	--shadow-modal          :  2px  5px 10px      #00000088;
	--shadow-pressed        : inset 0 0.15em 0.3em hsl(210 13% 12% / .5);
	--shadow-picker         :  0px  5px 10px  1px #00000044; /* large fuzzy shadow */

	--fg-text-selection     : var(--bg-focused-selected);
	--bg-text-selection     : var(--fg-focused-selected);

	font-size               : var(--font-size-normal);
	color                   : var(--fg);
	background-color        : var(--bg);

`)

css('.theme-dark, .theme-light .theme-inverted', '', `

	--fg                    : hsl(  0   0% 100% / 1.0);
	--fg-p                  : hsl(  0   0% 100% / 0.9);
	--fg-dim                : var(--fg-dim-on-dark);
	--fg-label              : hsl(  0 100% 100% / 0.8);
	--fg-link               : hsl(140 100%  30% / 1.0);
	--fg-link-hover         : hsl(140 100%  35% / 1.0);
	--fg-link-active        : hsl(140 100%  40% / 1.0);

	--bg                    : hsl(216  28%   7% / 1.0);
	--bg-hover              : hsl(216  28%   8% / 1.0);
	--bg1                   : hsl(216  28%  15% / 1.0);
	--bg2                   : hsl(216  28%  19% / 1.0);
	--bg2-hover             : hsl(216  28%  22% / 1.0);
	--bg-alt                : hsl(216  28%  10% / 1.0);
	--bg-smoke              : hsk(  0   0% 100% / 0.2);
	--bg-input              : hsl(  0   0%   0% / 1.0);

	--border-light          : var(--border-light-on-dark);
	--border-light-hover    : var(--border-light-on-dark-hover);

	--outline-focus         : hsl(  0   0% 100% / 1.0);

	--bg-button                 : hsl(215 15% 15%);
	--bg-button-hover           : hsl(215 15% 24%);
	--bg-button-active          : hsl(215 16% 30%);

	--bg-button-danger          : var(--bg-button);
	--bg-button-danger-hover    : var(--bg-button-hover);
	--bg-button-danger-active   : var(--bg-button-active);
	--fg-button-danger          : hsl(0 54% 43%);

	/* grid cell data states */
	--bg-new               : #2c2c5c;
	--bg-modified          : #196119;
	--bg-new-modified      : #293b34;

	/* grid cell interaction states. these need to be opaque! */
	--bg-unfocused-selected : #4c545d;
	--bg-unfocused          : #2e3033;
	--bg-unselected         : #1d2021;
	--bg-selected           : #122f4d;
	--bg-row-focused        : #222326;

	--shadow-pressed : inset 0 .15em .5em hsl(228 32% 15% / 46%);

	color-scheme: dark; /* make default scrollbars dark */

	font-size        : var(--font-size-normal);
	color            : var(--fg);
	background-color : var(--bg);

`)

/* SPACINGS --------------------------------------------------------------- */

css(':root', '', `
	--space-025 : .125rem;
	--space-05  :  .25rem;
	--space-075 : .375rem;
	--space-1   :   .5rem;
	--space-2   :  .75rem;
	--space-4   :    1rem;
	--space-8   :    2rem;

	--font-size-normal : 14px;

	--font-size-xsmall  : .72rem;    /* 10/14 */
	--font-size-small   : .8125rem;  /* 12/14 */
	--font-size-smaller : .875rem;   /* 13/14 */
	--font-size-large   : 1.125rem;  /* 16/14 */
	--font-size-xlarge  : 1.5rem;
	--font-size-h1      : 2em;
	--font-size-h2      : 1.5em;
	--font-size-h3      : 1.3em;

	--font-baseline-adjust-ff: 0; /* set this to 1 depending on font */
`)

css('.theme-small', '', `
	--font-size-normal : 12px;
`)

css('.theme-large', '', `
	--font-size-normal : 16px;
`)

css(':root', '', `
	font-size        : var(--font-size-normal);
	color            : var(--fg);
	background-color : var(--bg);
`)

/* RESET ------------------------------------------------------------------ */

css('*', '', `
	box-sizing: border-box;
`)

css(':root, html, body, table, tr, td, img', '', `
	margin: 0;
	padding: 0;
	border: 0;
`)

/* let `body` do the scrolling instead of `html` so that modals can cover the scrollbars */
css(':root', '', `
	width: 100%;
	height: 100%;
	overflow: hidden;
	font-family: arial, sans-serif;
`)

// For document-style UIs use `overflow-y: scroll` to avoid the annoying
// horizontal shifting of a centered page that happens between pages that fit
// the height of the window and those that don't. For split-screen-style UIs
// use `overflow-y: auto` or `hidden` instead because they use full-screen
// splitters that do the scrolling instead so the body itself should never
// have to scroll. We use `auto` by default to detect content overflow bugs.
css('body', '', `
	width: 100%;
	height: 100%;
	overflow: auto;
	/* overflow-y: scroll; */
`)

css('img', '', `
	display: block; /* don't align to surrounding text, that never made sense */
	max-width: 100%; /* make shrinkable */
`)

/* style hrs with just `color` */
css('hr', '', `
	border: 0;
	border-top-width: 1px;
	border-top-style: solid;
	color: var(--border-light);
`)

css('a', '', ` color: var(--fg-link); `)

css_state('a:visited', '', ` color: var(--fg-link); `)

css('p', '', ` color: var(--fg-p); `)

css('h1', '', ` font-size: var(--font-size-h1); `)
css('h2', '', ` font-size: var(--font-size-h2); `)
css('h3', '', ` font-size: var(--font-size-h3); `)

/* text selection */
css('::selection', '', `
	background : var(--bg-text-selection);
	color      : var(--fg-text-selection);
`)

/* invertable images */
css(':is(.theme-dark, .theme-light .theme-inverted) img[invertable]', '', `
	filter: invert(1);
`)

/* make `resize: both` resizer dark */
css([
	'.theme-dark::-webkit-resizer',
	'.theme-dark ::-webkit-resizer',
], '', `
	background: var(--bg-smoke);
`)

/* FONTS ------------------------------------------------------------------ */

css(`
@font-face {
  font-family: 'opensans';
  font-weight: 100 900;
  font-style: normal;
  font-named-instance: 'Regular';
  src: url("opensans.var.woff2") format("woff2");
}

@font-face {
  font-family: 'opensans';
  font-weight: 100 900;
  font-style: italic;
  font-named-instance: 'Italic';
  src: url("opensans-italic.var.woff2") format("woff2");
}

@font-face {
  font-family: 'inter';
  font-weight: 100 900;
  font-display: swap;
  font-style: normal;
  font-named-instance: 'Regular';
  src: url("inter-roman.var.woff2") format("woff2");
}

@font-face {
  font-family: 'inter';
  font-weight: 100 900;
  font-display: swap;
  font-style: italic;
  font-named-instance: 'Italic';
  src: url("inter-italic.var.woff2") format("woff2");
}

@font-face {
	font-family: "mi-round";
	font-style: normal;
	font-weight: 400;
	font-display: block;
	src: url("material-icons-round.woff2");
}

@font-face {
	font-family: "mi-sharp";
	font-style: normal;
	font-weight: 400;
	font-display: block;
	src: url("material-icons-sharp.woff2");
}

@font-face {
	font-family: "mi-outlined";
	font-style: normal;
	font-weight: 400;
	font-display: block;
	src: url("material-icons-outlined.woff2");
}
`)

css('.opensans', '', ` font-family: opensans, sans-serif; `)
css('.inter   ', '', ` font-family: inter, sans-serif; `)

css('.mi, .mi-round, .mi-sharp, .mi-outlined', '', `
	font-weight: normal;
	font-style: normal;
	font-size: 1.5em;
	vertical-align: -.25em;
	line-height: 1;
	letter-spacing: normal;
	text-transform: none;
	display: inline-block;
	white-space: nowrap;
	word-wrap: normal;
	direction: ltr;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
	text-rendering: optimizeLegibility;
	font-feature-settings: "liga";
`)

css('.mi-round'    , '', ` font-family: "mi-round"; `)
css('.mi-sharp'    , '', ` font-family: "mi-sharp"; `)
css('.mi-outlined' , '', ` font-family: "mi-outlined"; `)

css('.mi', 'mi-round')

/* TEXT ------------------------------------------------------------------- */

css('.pre      ', '', ` white-space: pre; `)
css('.pre-line ', '', ` white-space: pre-line; `)
css('.xsmall   ', '', ` font-size: var(--font-size-xsmall); `)
css('.small    ', '', ` font-size: var(--font-size-small); `)
css('.smaller  ', '', ` font-size: var(--font-size-smaller); `)
css('.normal   ', '', ` font-size: var(--font-size-normal); `)
css('.large    ', '', ` font-size: var(--font-size-large); line-height: 1.75; `)
css('.xlarge   ', '', ` font-size: var(--font-size-xlarge); line-height: 2; `)
css('.tight    ', '', ` line-height: 1.2; `)
css('.lh1      ', '', ` line-height: 1; `)
css('.littlebold','', ` font-weight: 500; `)
css('.semibold ', '', ` font-weight: 600; `)
css('.bold     ', '', ` font-weight: bold; `)
css('.extrabold', '', ` font-weight: 800; `)
css('.italic   ', '', ` font-style: italic; `)
css('.no-bold  ', '', ` font-weight: normal; `)
css('.condensed', '', ` font-stretch: 75%; `) /* only with var fonts */
css('.underline', '', ` text-decoration: underline; `)
css('.strike   ', '', ` text-decoration: line-through; `)
css('.allcaps  ', '', ` text-transform: uppercase; `)
css('.noselect ', '', ` user-select: none; `)

css('.mono     ', '', ` font-family: monospace; `)
css('.arial    ', '', ` font-family: arial, sans-serif; `)

/* use with ::before; inserts ZWSP to force line height on empty text */
css('.zwsp     ', '', " content: '\200b'; ")

css('[dim]          ', '', ` color: var(--fg-dim); `)
css('.dim           ', '', ` color: var(--fg-dim); `)
css('.dim-on-dark   ', '', ` color: var(--fg-dim-on-dark); `)
css('.white         ', '', ` color: var(--fg-white); `)
css('.label         ', '', ` color: var(--fg-label); `)
css('.label-on-dark ', '', ` color: var(--fg-label-on-dark); `)
css('.link          ', '', ` color: var(--fg-link); `)
css('.fg            ', '', ` color: var(--fg); `)
css('.fg-error      ', '', ` color: var(--bg-error); `)

/* ALIGN: INLINE ---------------------------------------------------------- */

css('.t-l       ', '', ` text-align: start  ; `)
css('.t-c       ', '', ` text-align: center ; `)
css('.t-r       ', '', ` text-align: end    ; `)
css('.t-j       ', '', ` text-align: justify; `)
css('.t-t       ', '', ` vertical-align: top     ; `)
css('.t-m       ', '', ` vertical-align: middle  ; `)
css('.t-b       ', '', ` vertical-align: bottom  ; `)
css('.t-baseline', '', ` vertical-align: baseline; `)
css('.t-sup     ', '', ` vertical-align: super   ; `)
css('.t-sub     ', '', ` vertical-align: sub     ; `)

css('.float-l', '', ` float: left; `)
css('.float-r', '', ` float: right; `)

/* ALIGN: FLEXBOX --------------------------------------------------------- */

css('.h', '', ` display: inline-flex; flex-flow: row   ; `)
css('.v', '', ` display: inline-flex; flex-flow: column; `)

css('.h-l ', '', ` display: inline-flex; flex-flow: row   ; justify-content: flex-start   ; `)
css('.h-r ', '', ` display: inline-flex; flex-flow: row   ; justify-content: flex-end     ; `)
css('.h-c ', '', ` display: inline-flex; flex-flow: row   ; justify-content: center       ; `)
css('.h-sb', '', ` display: inline-flex; flex-flow: row   ; justify-content: space-between; `)
css('.h-s ', '', ` display: inline-flex; flex-flow: row   ; align-items: stretch          ; `)
css('.h-t ', '', ` display: inline-flex; flex-flow: row   ; align-items: flex-start       ; `)
css('.h-b ', '', ` display: inline-flex; flex-flow: row   ; align-items: flex-end         ; `)
css('.h-m ', '', ` display: inline-flex; flex-flow: row   ; align-items: center           ; `)
css('.h-bl', '', ` display: inline-flex; flex-flow: row   ; align-items: baseline         ; `)

css('.v-t ', '', ` display: inline-flex; flex-flow: column; justify-content: flex-start   ; `)
css('.v-b ', '', ` display: inline-flex; flex-flow: column; justify-content: flex-end     ; `)
css('.v-m ', '', ` display: inline-flex; flex-flow: column; justify-content: center       ; `)
css('.v-sb', '', ` display: inline-flex; flex-flow: column; justify-content: space-between; `)
css('.v-s ', '', ` display: inline-flex; flex-flow: column; align-items: stretch          ; `)
css('.v-l ', '', ` display: inline-flex; flex-flow: column; align-items: flex-start       ; `)
css('.v-r ', '', ` display: inline-flex; flex-flow: column; align-items: flex-end         ; `)
css('.v-c ', '', ` display: inline-flex; flex-flow: column; align-items: center           ; `)

css('.S ', '', ` flex: 1; `)
css('.S1', '', ` flex: 1; `)
css('.S2', '', ` flex: 2; `)
css('.S3', '', ` flex: 3; `)
css('.S4', '', ` flex: 4; `)
css('.S5', '', ` flex: 5; `)
css('.S6', '', ` flex: 6; `)

/* cross-axis align: flex & css grid */
css('.self-h-t', '', ` align-self: start  ; `)
css('.self-h-m', '', ` align-self: center ; `)
css('.self-h-b', '', ` align-self: end    ; `)
css('.self-h-s', '', ` align-self: stretch; `)
css('.self-v-l', '', ` align-self: start  ; `)
css('.self-v-c', '', ` align-self: center ; `)
css('.self-v-r', '', ` align-self: end    ; `)
css('.self-v-s', '', ` align-self: stretch; `)

css('.flex-wrap  ', '', ` flex-wrap: wrap; `)
css('.flex-nowrap', '', ` flex-flow: nowrap; `)

css('.order-1   ', '', ` order: 1; `)
css('.order-2   ', '', ` order: 1; `)
css('.order-last', '', ` order: 99999; `)

/* flex & grid */
css('.gap025  ', '', ` gap: var(--space-025); `)
css('.gap05   ', '', ` gap: var(--space-05); `)
css('.gap075  ', '', ` gap: var(--space-075); `)
css('.gap     ', '', ` gap: var(--space-1); `)
css('.gap2    ', '', ` gap: var(--space-2); `)
css('.gap4    ', '', ` gap: var(--space-4); `)
css('.gap8    ', '', ` gap: var(--space-8); `)
css('.gap0    ', '', ` gap: 0; `)

css('.gap-x-025  ', '', ` column-gap: var(--space-025); `)
css('.gap-x-05   ', '', ` column-gap: var(--space-05); `)
css('.gap-x-075  ', '', ` column-gap: var(--space-075); `)
css('.gap-x      ', '', ` column-gap: var(--space-1); `)
css('.gap-x-2    ', '', ` column-gap: var(--space-2); `)
css('.gap-x-4    ', '', ` column-gap: var(--space-4); `)
css('.gap-x-8    ', '', ` column-gap: var(--space-8); `)
css('.gap-x-0    ', '', ` column-gap: 0; `)

css('.gap-y-025  ', '', ` row-gap: var(--space-025); `)
css('.gap-y-05   ', '', ` row-gap: var(--space-05); `)
css('.gap-y-075  ', '', ` row-gap: var(--space-075); `)
css('.gap-y      ', '', ` row-gap: var(--space-1); `)
css('.gap-y-2    ', '', ` row-gap: var(--space-2); `)
css('.gap-y-4    ', '', ` row-gap: var(--space-4); `)
css('.gap-y-8    ', '', ` row-gap: var(--space-8); `)
css('.gap-y-0    ', '', ` row-gap: 0; `)

/* ALIGN: GRID ------------------------------------------------------------ */

css('.grid-h', '', ` display: inline-grid; grid-auto-flow: row   ; `)
css('.grid-v', '', ` display: inline-grid; grid-auto-flow: column; `)

css('.grid-1col', '', ` display: inline-grid; grid-template-columns: repeat(1, auto); `)
css('.grid-2col', '', ` display: inline-grid; grid-template-columns: repeat(2, auto); `)
css('.grid-3col', '', ` display: inline-grid; grid-template-columns: repeat(3, auto); `)
css('.grid-4col', '', ` display: inline-grid; grid-template-columns: repeat(4, auto); `)
css('.grid-5col', '', ` display: inline-grid; grid-template-columns: repeat(5, auto); `)
css('.grid-6col', '', ` display: inline-grid; grid-template-columns: repeat(6, auto); `)

css('.grid-l ', '', ` display: inline-grid; justify-content: start   ; `)
css('.grid-r ', '', ` display: inline-grid; justify-content: end     ; `)
css('.grid-c ', '', ` display: inline-grid; justify-content: center  ; `)
css('.grid-sb', '', ` display: inline-grid; justify-content: space-between; `)
css('.grid-s ', '', ` display: inline-grid; align-items: stretch     ; `)
css('.grid-t ', '', ` display: inline-grid; align-items: start       ; `)
css('.grid-b ', '', ` display: inline-grid; align-items: end         ; `)
css('.grid-m ', '', ` display: inline-grid; align-items: center      ; `)
css('.grid-bl', '', ` display: inline-grid; align-items: baseline    ; `)

css('.x1', '', ` grid-column-start: 1; `)
css('.x2', '', ` grid-column-start: 2; `)
css('.x3', '', ` grid-column-start: 3; `)
css('.x4', '', ` grid-column-start: 4; `)
css('.x5', '', ` grid-column-start: 5; `)

css('.y1', '', ` grid-row-start   : 1; `)
css('.y2', '', ` grid-row-start   : 2; `)
css('.y3', '', ` grid-row-start   : 3; `)
css('.y4', '', ` grid-row-start   : 4; `)
css('.y5', '', ` grid-row-start   : 5; `)

css('.xx   ', '', ` grid-column-end  : span 2; `)
css('.xxx  ', '', ` grid-column-end  : span 3; `)
css('.xxxx ', '', ` grid-column-end  : span 4; `)
css('.xxxxx', '', ` grid-column-end  : span 5; `)

css('.yy   ', '', ` grid-row-end     : span 2; `)
css('.yyy  ', '', ` grid-row-end     : span 3; `)
css('.yyyy ', '', ` grid-row-end     : span 4; `)
css('.yyyyy', '', ` grid-row-end     : span 5; `)

/* inline-axis align: grid, block, absolute positioning. */
css('.self-h-l', '', ` justify-self: start ; `)
css('.self-h-r', '', ` justify-self: end   ; `)
css('.self-h-c', '', ` justify-self: center; `)
css('.self-v-t', '', ` justify-self: start ; `)
css('.self-v-b', '', ` justify-self: end   ; `)
css('.self-v-m', '', ` justify-self: center; `)

/* SIZING ----------------------------------------------------------------- */

css('[nowrap]', '', `
	white-space: nowrap;
	overflow: hidden;
`)
css('.nowrap', '', `
	white-space: nowrap;
	overflow: hidden;
`)

css('[nowrap-dots]', '', `
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`)
css('.nowrap-dots', '', `
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`)

css('.shrinks', '', `
	min-width  : 0;
	min-height : 0;
`)

css('.w1 ', '', ` width: 1.25em; `) /* mainly to keep changing icons fixated and aligned */
css('.w2 ', '', ` width:  2.5em; `)
css('.w4 ', '', ` width:    5em; `)
css('.w8 ', '', ` width:   10em; `)
css('.w16', '', ` width:   20em; `)
css('.w32', '', ` width:   40em; `)

/* BORDERS ---------------------------------------------------------------- */

css('.b      ', '', ` border        : 1px solid var(--border-light); `)
css('.b2     ', '', ` border        : 2px solid var(--border-light); `)
css('.b0     ', '', ` border-width  : 0; `)
css('.b-l    ', '', ` border-left   : 1px solid var(--border-light); `)
css('.b-r    ', '', ` border-right  : 1px solid var(--border-light); `)
css('.b-t    ', '', ` border-top    : 1px solid var(--border-light); `)
css('.b-b    ', '', ` border-bottom : 1px solid var(--border-light); `)

css('.b-l-0  ', '', ` border-left-width   : 0; border-top-left-radius   : 0; border-bottom-left-radius : 0; `)
css('.b-r-0  ', '', ` border-right-width  : 0; border-top-right-radius  : 0; border-bottom-right-radius: 0; `)
css('.b-t-0  ', '', ` border-top-width    : 0; border-top-left-radius   : 0; border-top-right-radius   : 0; `)
css('.b-b-0  ', '', ` border-bottom-width : 0; border-bottom-left-radius: 0; border-bottom-right-radius: 0; `)

css('.ro05   ', '', ` border-radius: var(--space-05); `)
css('.ro075  ', '', ` border-radius: var(--space-075); `)
css('.ro     ', '', ` border-radius: var(--space-1); `)
css('.ro2    ', '', ` border-radius: var(--space-2); `)
css('.round  ', '', ` border-radius: 9999px; `)
css('.ro0    ', '', ` border-radius: 0; `)

css('.ro-l-0 ', '', ` border-top-left-radius   : 0; border-bottom-left-radius : 0; `)
css('.ro-r-0 ', '', ` border-top-right-radius  : 0; border-bottom-right-radius: 0; `)
css('.ro-t-0 ', '', ` border-top-left-radius   : 0; border-top-right-radius   : 0; `)
css('.ro-b-0 ', '', ` border-bottom-left-radius: 0; border-bottom-right-radius: 0; `)

css('.ro-group-h > :not(:last-child)' , '', ` border-top-right-radius  : 0; border-bottom-right-radius: 0; `)
css('.ro-group-h > :not(:first-child)', '', ` border-top-left-radius   : 0; border-bottom-left-radius : 0; `)
css('.ro-group-v > :not(:last-child)' , '', ` border-bottom-left-radius: 0; border-bottom-right-radius: 0; `)
css('.ro-group-v > :not(:first-child)', '', ` border-top-left-radius   : 0; border-top-right-radius   : 0; `)

css('.b-solid    ', '', ` border-style: solid; `)
css('.b-dotted   ', '', ` border-style: dotted; `)
css('.b-dashed   ', '', ` border-style: dashed; `)
css('.b-invisible', '', ` border-color: #00000000; `)

css('.b-fg       ', '', ` border-color: var(--fg); `)
css('.b-hover    ', '', ` border-color: var(--border-light-hover); `)

/* PADDINGS --------------------------------------------------------------- */

css('.p025  ', '', ` padding: var(--space-025); `)
css('.p05   ', '', ` padding: var(--space-05); `)
css('.p     ', '', ` padding: var(--space-1); `)
css('.p2    ', '', ` padding: var(--space-2); `)
css('.p4    ', '', ` padding: var(--space-4); `)
css('.p8    ', '', ` padding: var(--space-8); `)
css('.p0    ', '', ` padding: 0; `)

css('.p-t-05', '', ` padding-top:    var(--space-05); `)
css('.p-r-05', '', ` padding-right:  var(--space-05); `)
css('.p-b-05', '', ` padding-bottom: var(--space-05); `)
css('.p-l-05', '', ` padding-left:   var(--space-05); `)

css('.p-x-025', '', ` padding-left:   var(--space-025); padding-right:  var(--space-025); `)
css('.p-y-025', '', ` padding-top:    var(--space-025); padding-bottom: var(--space-025); `)
css('.p-x-05 ', '', ` padding-left:   var(--space-05 ); padding-right:  var(--space-05 ); `)
css('.p-y-05 ', '', ` padding-top:    var(--space-05 ); padding-bottom: var(--space-05 ); `)
css('.p-x    ', '', ` padding-left:   var(--space-1  ); padding-right:  var(--space-1  ); `)
css('.p-y    ', '', ` padding-top:    var(--space-1  ); padding-bottom: var(--space-1  ); `)
css('.p-x-2  ', '', ` padding-left:   var(--space-2  ); padding-right:  var(--space-2  ); `)
css('.p-y-2  ', '', ` padding-top:    var(--space-2  ); padding-bottom: var(--space-2  ); `)
css('.p-x-4  ', '', ` padding-left:   var(--space-4  ); padding-right:  var(--space-4  ); `)
css('.p-y-4  ', '', ` padding-top:    var(--space-4  ); padding-bottom: var(--space-4  ); `)
css('.p-x-8  ', '', ` padding-left:   var(--space-8  ); padding-right:  var(--space-8  ); `)
css('.p-y-8  ', '', ` padding-top:    var(--space-8  ); padding-bottom: var(--space-8  ); `)

css('.p-x-0  ', '', ` padding-left   : 0; padding-right  : 0; `)
css('.p-y-0  ', '', ` padding-top    : 0; padding-bottom : 0; `)

css('.p-t   ', '', ` padding-top:    var(--space-1); `)
css('.p-r   ', '', ` padding-right:  var(--space-1); `)
css('.p-b   ', '', ` padding-bottom: var(--space-1); `)
css('.p-l   ', '', ` padding-left:   var(--space-1); `)

css('.p-t-2 ', '', ` padding-top:    var(--space-2); `)
css('.p-r-2 ', '', ` padding-right:  var(--space-2); `)
css('.p-b-2 ', '', ` padding-bottom: var(--space-2); `)
css('.p-l-2 ', '', ` padding-left:   var(--space-2); `)

css('.p-t-4 ', '', ` padding-top:    var(--space-4); `)
css('.p-r-4 ', '', ` padding-right:  var(--space-4); `)
css('.p-b-4 ', '', ` padding-bottom: var(--space-4); `)
css('.p-l-4 ', '', ` padding-left:   var(--space-4); `)

css('.p-t-8 ', '', ` padding-top:    var(--space-8); `)
css('.p-r-8 ', '', ` padding-right:  var(--space-8); `)
css('.p-b-8 ', '', ` padding-bottom: var(--space-8); `)
css('.p-l-8 ', '', ` padding-left:   var(--space-8); `)

css('.p-t-0 ', '', ` padding-top    : 0; `)
css('.p-r-0 ', '', ` padding-right  : 0; `)
css('.p-b-0 ', '', ` padding-bottom : 0; `)
css('.p-l-0 ', '', ` padding-left   : 0; `)

/* MARGINS ---------------------------------------------------------------- */

css('.m     ', '', ` margin: var(--space-1); `)
css('.m05   ', '', ` margin: var(--space-05); `)
css('.m2    ', '', ` margin: var(--space-2); `)
css('.m4    ', '', ` margin: var(--space-4); `)
css('.m8    ', '', ` margin: var(--space-8); `)
css('.m0    ', '', ` margin: 0; `)

css('.m-x-05', '', ` margin-left:   var(--space-05); margin-right:  var(--space-05); `)
css('.m-y-05', '', ` margin-top:    var(--space-05); margin-bottom: var(--space-05); `)
css('.m-x   ', '', ` margin-left:   var(--space-1); margin-right:  var(--space-1); `)
css('.m-y   ', '', ` margin-top:    var(--space-1); margin-bottom: var(--space-1); `)
css('.m-x-2 ', '', ` margin-left:   var(--space-2); margin-right:  var(--space-2); `)
css('.m-y-2 ', '', ` margin-top:    var(--space-2); margin-bottom: var(--space-2); `)
css('.m-x-4 ', '', ` margin-left:   var(--space-4); margin-right:  var(--space-4); `)
css('.m-y-4 ', '', ` margin-top:    var(--space-4); margin-bottom: var(--space-4); `)
css('.m-x-8 ', '', ` margin-left:   var(--space-8); margin-right:  var(--space-8); `)
css('.m-y-8 ', '', ` margin-top:    var(--space-8); margin-bottom: var(--space-8); `)

css('.m-x-0 ', '', ` margin-left:   0; margin-right:  0; `)
css('.m-y-0 ', '', ` margin-top:    0; margin-bottom: 0; `)

css('.m-t-05', '', ` margin-top:    var(--space-05); `)
css('.m-r-05', '', ` margin-right:  var(--space-05); `)
css('.m-b-05', '', ` margin-bottom: var(--space-05); `)
css('.m-l-05', '', ` margin-left:   var(--space-05); `)

css('.m-t   ', '', ` margin-top:    var(--space-1); `)
css('.m-r   ', '', ` margin-right:  var(--space-1); `)
css('.m-b   ', '', ` margin-bottom: var(--space-1); `)
css('.m-l   ', '', ` margin-left:   var(--space-1); `)

css('.m-t-2 ', '', ` margin-top:    var(--space-2); `)
css('.m-r-2 ', '', ` margin-right:  var(--space-2); `)
css('.m-b-2 ', '', ` margin-bottom: var(--space-2); `)
css('.m-l-2 ', '', ` margin-left:   var(--space-2); `)

css('.m-t-4 ', '', ` margin-top:    var(--space-4); `)
css('.m-r-4 ', '', ` margin-right:  var(--space-4); `)
css('.m-b-4 ', '', ` margin-bottom: var(--space-4); `)
css('.m-l-4 ', '', ` margin-left:   var(--space-4); `)

css('.m-t-8 ', '', ` margin-top:    var(--space-8); `)
css('.m-r-8 ', '', ` margin-right:  var(--space-8); `)
css('.m-b-8 ', '', ` margin-bottom: var(--space-8); `)
css('.m-l-8 ', '', ` margin-left:   var(--space-8); `)

css('.m-x-auto', '', ` margin-left: auto; margin-right: auto; `)
css('.m-l-auto', '', ` margin-left: auto `)
css('.m-r-auto', '', ` margin-right: auto `)

css('.m-t-0 ', '', ` margin-top:    0; `)
css('.m-r-0 ', '', ` margin-right:  0; `)
css('.m-b-0 ', '', ` margin-bottom: 0; `)
css('.m-l-0 ', '', ` margin-left:   0; `)

/* OUTLINE ---------------------------------------------------------------- */

css('.outline-focus', '', `
	outline: 2px solid var(--outline-focus);
`)

css('.no-outline', '', ` outline: none; `)

css_state(':focus-visible', 'outline-focus')

/* OVERFLOW --------------------------------------------------------------- */

css('.scroll      ', '', ` overflow  : scroll; `)
css('.hscroll     ', '', ` overflow-x: scroll; `)
css('.vscroll     ', '', ` overflow-y: scroll; `)
css('.scroll-auto ', '', ` overflow  : auto; `)
css('.hscroll-auto', '', ` overflow-x: auto; `)
css('.vscroll-auto', '', ` overflow-y: auto; `)
css('.clip        ', '', ` overflow  : hidden; `)
css('.clip-x      ', '', ` overflow-x: hidden; `)
css('.clip-y      ', '', ` overflow-y: hidden; `)
css('.noclip      ', '', ` overflow  : visible; `)
css('.noclip-x    ', '', ` overflow-x: visible; `)
css('.noclip-y    ', '', ` overflow-y: visible; `)

/* THIN SCROLLBARS -------------------------------------------------------- */

/* must set w/h to enable custom-drawn scrollbars */
css('.scroll-thin::-webkit-scrollbar', '', `
	width : 8px;
	height: 8px;
`)

css('.scroll-thin::-webkit-scrollbar-track', '', `
	background-color: var(--bg1);
`)

css('.scroll-thin::-webkit-scrollbar-thumb', '', `
	background    : var(--bg2);
	border-color  : var(--bg2);
	border-radius : 50px;
`)

css_state('.scroll-thin::-webkit-scrollbar-thumb:hover', '', `
	background: var(--bg2-hover);
`)

/* POSITIONING ------------------------------------------------------------ */

css('.rel', '', ` position: relative; `)
css('.abs', '', ` position: absolute; `)

/* example: menu = z4, picker = z3, tooltip = z2, toolbox = z1 */
css('.z1 ', '', ` z-index: 1; `)
css('.z2 ', '', ` z-index: 2; `)
css('.z3 ', '', ` z-index: 3; `)
css('.z4 ', '', ` z-index: 4; `)
css('.z5 ', '', ` z-index: 5; `)

css('.overlay', '', `
	position: absolute;
	left: 0;
	top: 0;
	right: 0;
	bottom: 0;
`)

/* VISIBILITY ------------------------------------------------------------- */

css('.show  ', '', ` display: initial; `) /* TODO: this is flaky! */
css('.hidden', '', ` display: none; `)
css('.skip  ', '', ` display: contents; `)

css('.invisible', '', ` visibility: hidden; `)
css('.visible  ', '', ` visibility: visible; `)

css('.click-through    ', '', ` pointer-events: none; `)
css('.click-through-off', '', ` pointer-events: all; `)

/* FLAT BACKGROUNDS ------------------------------------------------------- */

css('.bg      ', '', ` background: var(--bg); `)
css('.bg-hover', '', ` background: var(--bg-hover); `)
css('.bg1     ', '', ` background: var(--bg1); `)
css('.bg2     ', '', ` background: var(--bg2); `)
css('.bg-alt  ', '', ` background: var(--bg-alt); `)
css('.bg-smoke', '', ` background: var(--bg-smoke); `)
css('.bg-fg   ', '', ` background: var(--fg); `) /* slider thumb, etc. */
css('.bg-white', '', ` background: var(--fg-white); `)
css('.bg-link ', '', ` background: var(--fg-link); `) /* slider track */
css('.no-bg   ', '', ` background: none; `)

css('.bg-error', '', `
	background : var(--bg-error);
	color      : var(--fg-error);
`)

/* IMAGE BACKGROUNDS ------------------------------------------------------ */

css('.bg-cover  ', '', ` background-size: cover; `)
css('.bg-contain', '', ` background-size: contain; `)

css('.bg-c', '', ` background-position: center; `)
css('.bg-t', '', ` background-position: top; `)
css('.bg-r', '', ` background-position: right; `)
css('.bg-b', '', ` background-position: bottom; `)
css('.bg-l', '', ` background-position: left; `)

css('.bg-no-repeat', '', ` background-repeat: no-repeat; `)
css('.bg-repeat-x ', '', ` background-repeat: repeat-x; `)
css('.bg-repeat-y ', '', ` background-repeat: repeat-y; `)

/* FILTERS ---------------------------------------------------------------- */

css('.darken   ', '', ` filter: brightness(0.85); `)
css('.lighten  ', '', ` filter: brightness(1.15); `)
css('.no-filter', '', ` filter: none; `)

css('.op0   ', '', ` opacity:  0; `)
css('.op1   ', '', ` opacity:  1; `)

for (let i = 1; i <= 9; i++)
	css('.op0'+i, '', ` opacity: .${i}; `)

/* SHADOWS ---------------------------------------------------------------- */

css('.ring          ', '', ` box-shadow:  0px  0px  2px var(--ring); `)

css('.shadow        ', '', ` box-shadow: var(--shadow-tooltip); `)
css('.shadow-tooltip', '', ` box-shadow: var(--shadow-tooltip); `)
css('.shadow-thumb  ', '', ` box-shadow: var(--shadow-thumb); `)
css('.shadow-menu   ', '', ` box-shadow: var(--shadow-menu); `)
css('.shadow-button ', '', ` box-shadow: var(--shadow-button); `)
css('.shadow-pressed', '', ` box-shadow: var(--shadow-pressed); `)
css('.shadow-modal  ', '', ` box-shadow: var(--shadow-modal); `)
css('.shadow-toolbox', '', ` box-shadow: var(--shadow-toolbox); `)

css('.no-shadow     ', '', ` box-shadow: none; `)

/* TRANSFORMS ------------------------------------------------------------- */

css('.transform', '', `
	transform:
		translate(var(--translate-x, 0), var(--translate-y, 0))
		scale(var(--scale-x, var(--scale, 1)), var(--scale-y, var(--scale, 1)))
		rotate(calc(var(--rotate, 0deg) + var(--rotate2, 0deg)))
	;
`)

css('.flip-h    ', 'transform',  `--scale-x: -1;`)
css('.flip-v    ', 'transform',  `--scale-y: -1;`)
css('.rotate-1q ', 'transform',  `--rotate:   90deg;`)
css('.rotate-2q ', 'transform',  `--rotate:  180deg;`)
css('.rotate-3q ', 'transform',  `--rotate:  270deg;`)
css('.rotate--1q', 'transform',  `--rotate:  -90deg;`)
css('.rotate--2q', 'transform',  `--rotate: -180deg;`)
css('.rotate--3q', 'transform',  `--rotate: -270deg;`)
css('.rotate-45 ', 'transform',  `--rotate2:   45deg;`)
css('.rotate--45', 'transform',  `--rotate2:  -45deg;`)
css('.rotate-0  ', 'transform',  `--rotate1: 0deg; --rotate2: 0deg;`)

/* TRANSITIONS ------------------------------------------------------------ */

css('.ease', '', `
	transition-property:
		top, left, right, bottom, transform,
		opacity, filter, background-color, border-color;
	transition-duration: .2s;
	transition-timing-function: ease;
`)
css('.ease-out   ', '', ` transition-timing-function: ease-out; `)
css('.ease-linear', '', ` transition-timing-function: linear; `)
css('.ease-01s   ', '', ` transition-duration: .1s; `)
css('.ease-05s   ', '', ` transition-duration: .5s; `)
css('.ease-1s    ', '', ` transition-duration:  1s; `)
css('.no-ease    ', '', ` transition: all 0s; `)
css('.ease-fw    ', '', ` animation-fill-mode: forwards; `)

/* ANIMATIONS ------------------------------------------------------------- */

css('.beat      ', '', ` animation: 1s 1 ease-in-out beat; `)
css('.bounce    ', '', ` animation: 1s 1 cubic-bezier(0.28, 0.84, 0.42, 1) bounce; `)
css('.fade      ', '', ` animation: 1s 1 cubic-bezier(0.4, 0, 0.6, 1) fade; `)
css('.beat-fade ', '', ` animation: 1s 1 cubic-bezier(0.4, 0, 0.6, 1) beat-fade; `)
css('.flip      ', '', ` animation: 1s 1 ease-in-out flip; `)
css('.shake     ', '', ` animation: 1s 1 linear shake; `)
css('.spin      ', '', ` animation: 1s 1 linear spin; `)
css('.reverse   ', '', ` animation-direction: reverse; `)
css('.forever   ', '', ` animation-iteration-count: infinite; `)
css('.once      ', '', ` animation-iteration-count: 1; `)
css('.spin-pulse', '', ` animation: 1s infinite steps(8) spin; `)

css(`

@keyframes beat {
  0%, 90% { transform: scale(1); }
  45%     { transform: scale(1.25); }
}

@keyframes bounce {
    0% { transform: scale(   1,    1) translateY( 0); }
   10% { transform: scale( 1.1,  0.9) translateY( 0); }
   30% { transform: scale( 0.9,  1.1) translateY(-0.5em); }
   50% { transform: scale(1.05, 0.95) translateY( 0); }
   57% { transform: scale(   1,    1) translateY(-0.125em); }
   64% { transform: scale(   1,    1) translateY( 0); }
  100% { transform: scale(   1,    1) translateY( 0); }
}

@keyframes fade {
  50% { opacity: 0.4; }
}

@keyframes beat-fade {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50%      { opacity:   1; transform: scale(1.125); }
}

@keyframes flip {
  50% { transform: rotate3d(0, 1, 0, -180deg); }
}

@keyframes shake {
   0%       { transform: rotate(-15deg); }
   4%       { transform: rotate( 15deg); }
   8%, 24%  { transform: rotate(-18deg); }
  12%, 28%  { transform: rotate( 18deg); }
  16%       { transform: rotate(-22deg); }
  20%       { transform: rotate( 22deg); }
  32%       { transform: rotate(-12deg); }
  36%       { transform: rotate( 12deg); }
  40%, 100% { transform: rotate(  0deg); }
}

@keyframes spin {
  0%   { transform: rotate(  0deg); }
  100% { transform: rotate(360deg); }
}

`)

/* CURSORS ---------------------------------------------------------------- */

css('.arrow   ', '', ` cursor: default; `) /* not needed with `noselect` */
css('.hand    ', '', ` cursor: pointer; `) /* only for links */
css('.grab    ', '', ` cursor: grab; `)
css('.grabbing', '', ` cursor: grabbing; `)

/* SHAPES ----------------------------------------------------------------- */

css('.icon-check::before', 'rotate-45', `
  content: "";
  display: block;
  border-color: var(--fg);
  border-style: solid;
  border-width: 0 0.2em 0.2em 0;
  width  : 0.5em;
  height : 1em;
`)

css('.icon-chevron-right::before', 'rotate--45', `
  content: "";
  display: block;
  border-color: var(--fg);
  border-style: solid;
  border-width: 0 .2em .2em 0;
  width : .6em;
  height: .6em;
  --translate-x: -0.125em;
`)

css('.icon-chevron-left::before', 'icon-chevron-right flip-h' , `--translate-x: .25em;`)
css('.icon-chevron-down::before', 'icon-chevron-right rotate-45')
css('.icon-chevron-up::before'  , 'icon-chevron-down  flip-v', `--translate-y: 0.25em;`)

} /* module */
