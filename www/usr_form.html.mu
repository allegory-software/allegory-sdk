<style>
.usr-tooltip .tooltip-content {
	min-width: 300px;
	margin-top: 1em;
}
</style>
<if global=signed_in>
	<frm id=usr_form nav_id=usr_nav>
		<inp col=email ></inp>
		<inp col=name  ></inp>
		{{#multilang}}
		<inp col=lang     ></inp>
		<inp col=country  ></inp>
		{{/multilang}}
		<inp col=theme></inp>
		<if global=signed_in_dev>
			<inp col=tenant></inp>
		</if>
		<if global=signed_in_realusr_dev>
			<list-dropdown
				id=usr_usr_dropdown
				label:s:field_label_impersonate_user="Impersonate User"
				rowset_name=impersonate_users
				val_col=usr
				display_col=email
			></list-dropdown>
		</if>
	</frm>
	<btn id=auth_sign_out_button bare icon="fa fa-sign-out-alt">
		<t s=log_out>Log out</t>
	</btn>
</if>
<if global=signed_in_anonymous>
	<frm id=usr_form nav_id=usr_nav>
		{{#multilang}}
		<inp col=lang     ></inp>
		<inp col=country  ></inp>
		{{/multilang}}
		<inp col=theme></inp>
	</frm>
	<btn id=auth_sign_in_button><t s=sign_in>Sign-In</t></btn>
</if>
<if global=signed_out>
	<frm id=usr_form nav_id=usr_nav>
	</frm>
	<btn id=auth_sign_in_button><t s=sign_in>Sign-In</t></btn>
</if>
