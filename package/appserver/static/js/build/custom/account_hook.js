class AccountHook {
	constructor(globalConfig, serviceName, state, mode, util) {
		this.globalConfig = globalConfig;
		this.serviceName = serviceName;
		this.state = state;
		this.mode = mode;
		this.util = util;
	}

	makeSplunkUrl(path) {
		if (window.Splunk?.util?.make_url) {
			return window.Splunk.util.make_url(path);
		}
		const match = window.location.pathname.match(/^\/([a-z]{2}(?:-[A-Z]{2})?)\//);
		return (match ? `/${match[1]}` : "") + path;
	}

	async getAccountByName(accountName) {
		try {
			console.log("Trying to fetch account host for:", accountName);
			const url = this.makeSplunkUrl(`/splunkd/__raw/servicesNS/nobody/Splunk_TA_NetApp_ontap/Splunk_TA_NetApp_ontap_account/${encodeURIComponent(accountName)}?output_mode=json`);
			const response = await fetch(url, {
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					"X-Requested-With": "XMLHttpRequest"
				},
				credentials: "same-origin"
			});
			if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

			const json = await response.json();
			return json.entry?.[0]?.content?.host;
		} catch (error) {
			console.error("Error fetching account host:", error);
			return null;
		}
	}

	async onChange(field, value, dataDict) {
		if (field === "account") {
			const accountName = value;
			console.log("Account selected:", accountName);

			// Disable host field and clear value while fetching
			this.util.setState(prevState => {
				const data = { ...prevState.data };
				data.account_host.disabled = true;
				data.account_host.value = "";
				return { data };
			});

			const host = await this.getAccountByName(accountName);
			if (host) {
				this.util.setState(prevState => {
					const data = { ...prevState.data };
					data.account_host.value = host;
					return { data };
				});
			}
		}
	}

	async onRender(field, value, dataDict) {
		if (field === "account_host") {
			const accountName = this.state.data.account.value;
			if (!accountName) return;

			const host = await this.getAccountByName(accountName);
			if (host) {
				this.util.setState(prevState => {
					const data = { ...prevState.data };
					data.account_host.disabled = true;
					data.account_host.value = host;
					return { data };
				});
			}
		}
	}
}

export default AccountHook;
