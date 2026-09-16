class CustomInputCell {
    constructor(globalConfig, serviceName, el, row, field) {
        this.globalConfig = globalConfig;
        this.serviceName = serviceName;
        this.el = el;
        this.row = row;
        this.field = field;
    }

    makeSplunkUrl(path) {
        if (window.Splunk?.util?.make_url) {
            return window.Splunk.util.make_url(path);
        }
        const match = window.location.pathname.match(/^\/([a-z]{2}(?:-[A-Z]{2})?)\//);
        return (match ? `/${match[1]}` : "") + path;
    }

    render() {
        this.el.innerHTML = `
            <button class="btn-check-connection">Check Connection</button>
            <span class="connection-status"></span>
        `;

        this.el.querySelector('.btn-check-connection').addEventListener('click', async () => {
            const statusSpan = this.el.querySelector('.connection-status');
            statusSpan.textContent = 'Checking...';
            const formKey = window.Splunk?.util?.getFormKey();

            try {
                const response = await fetch(
                    this.makeSplunkUrl(`/splunkd/__raw/servicesNS/nobody/Splunk_TA_NetApp_ontap/ontap_vserver_validator_rh/${encodeURIComponent(this.row.name)}/custom`),
                    {
                        method: 'POST',
                        headers: {
                            'X-Requested-With': 'XMLHttpRequest',
                            "X-Splunk-Form-Key": formKey,
                        },
                        credentials: 'same-origin'
                    }
                );
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const result = await response.json();

                statusSpan.textContent = result.status || 'Success';
            } catch (error) {
                console.error('Connection check failed:', error);
                statusSpan.textContent = 'Failed';
            }
        });

        return this;
    }
}
export default CustomInputCell;
