<x-dialog>
	<content>
		<style>
		.sign-in-logo {
			align-self: center;
		}

		.sign-in-slides {
			align-self: center;
			width: 360px;
			padding: 1em 2em;
		}

		.sign-in-slides .x-button {
			//margin: .25em 0;
		}

		#usr_form {
			grid-template-areas:
				"email"
				"name"
				"lang"
				"country"
				"theme"
				"auth_sign_out_button"
				"auth_sign_in_button"
		}

		#auth_sign_out_button,
		#auth_sign_in_button {
			padding-top    : .5em;
			padding-bottom : .5em;
			margin-top     : .5em;
			margin-bottom  : .5em;
		}

		.sign-in-email-button,
		.sign-in-code-button
		{
			margin-top: .5em;
		}

		.sign-in-splash-img {
			background-image: url("/login-bg.jpg");
			background-position: center;
		}

		.x-dialog-head-split {
			display: flex;
			justify-content: space-between;
		}
		.sign-in-lang-dropdown {
			align-self: center;
			margin-left: 1em;
		}
		</style>
		<script runit>
			this.add(bare_nav({
				id: 'auth_pick_lang_nav',
				rowset: {
					fields: [
						{
							name: 'lang',
							lookup_rowset_name: 'pick_lang',
							lookup_cols: 'lang',
							display_col: 'name',
						}
					],
					rows: [
						[lang()],
					],
				},
			}))
		</script>
		<img class=sign-in-logo src=/sign-in-logo.png onerror="this.style.display='none'">
		<x-slides class=sign-in-slides>
			<div class="x-form">
				<div class=x-dialog-head-split>
					<div class=x-dialog-heading>
						<t s=heading_sign_in>
							Sign-in
						</t>
					</div>
					{{#multilang}}
					<x-lookup-dropdown class=sign-in-lang-dropdown
						xnav=auth_pick_lang_nav
						xcol=lang
						rowset=pick_lang lookup_cols=lang display_col=name
						.nolabel
					></x-lookup-dropdown>
					{{/multilang}}
				</div>
				<p small><t s=sign_in_greet>
					The security of your account is important to us.
					That is why instead of having you set up a hard-to-remember password,
					we will send you a one-time activation code every time
					you need to sign in.
				</t></p>
				<x-textedit
					class=sign-in-email-edit
					field_type=email
					label:s:textedit_label_sign_in_email="E-mail address" focusfirst
				></x-textedit>
				<x-button primary
					class=sign-in-email-button
					text:s:button_text_sign_in_email="E-mail me a sign-in code"
				></x-button>
			</div>

			<div class="x-form">
				<div class=x-dialog-heading><t s=heading_sign_in_enter_code>
					Enter code
				</t></div>
				<p small><t s=sign_in_email_sent>
					An e-mail was sent to you with a 6-digit sign-in code.
					Enter the code in the box below to sign-in.
					<br>
					If you haven't received an email even after
					a few minutes, please <a href="/sign-in">try again</a>.
				</t></p>
				<x-textedit
					class=sign-in-code-edit
					field_type=sign_in_code
					label:s:textedit_label_sign_in_code="6-digit sign-in code"
					focusfirst></x-textedit>
				<x-button primary
					class=sign-in-code-button
					text:s:button_text_sign_in="Sign-in"
				></x-button>
			</div>

		</x-slides>
	</content>
</x-dialog>
