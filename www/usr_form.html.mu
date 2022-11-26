<style>
.x-usr-tooltip .x-tooltip-content {
	min-width: 300px;
	margin-top: 1em;
}
</style>
<x-if global=signed_in>
	<x-form id=usr_form nav_id=usr_nav>
		<x-input col=email ></x-input>
		<x-input col=name  ></x-input>
		{{#multilang}}
		<x-lookup col=lang     ></x-lookup>
		<x-lookup col=country  ></x-lookup>
		{{/multilang}}
		<x-enum-dropdown col=theme></x-enum-dropdown>
		<x-if global=signed_in_dev>
			<x-lookup-dropdown col=tenant></x-lookup-dropdown>
		</x-if>
		<x-if global=signed_in_realusr_dev>
			<x-list-dropdown
				id=usr_usr_dropdown
				label:s:field_label_impersonate_user="Impersonate User"
				rowset_name=impersonate_users
				val_col=usr
				display_col=email
			></x-list-dropdown>
		</x-if>
	</x-form>
	<x-button id=auth_sign_out_button bare icon="fa fa-sign-out-alt">
		<t s=log_out>Log out</t>
	</x-button>
</x-if>
<x-if global=signed_in_anonymous>
	<x-form id=usr_form nav_id=usr_nav>
		{{#multilang}}
		<x-lookup-dropdown col=lang     ></x-lookup-dropdown>
		<x-lookup-dropdown col=country  ></x-lookup-dropdown>
		{{/multilang}}
		<x-enum-dropdown col=theme></x-enum-dropdown>
	</x-form>
	<x-button id=auth_sign_in_button><t s=sign_in>Sign-In</t></x-button>
</x-if>
<x-if global=signed_out>
	<x-form id=usr_form nav_id=usr_nav>
	</x-form>
	<x-button id=auth_sign_in_button><t s=sign_in>Sign-In</t></x-button>
</x-if>
