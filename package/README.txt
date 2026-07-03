# Splunk Add-on for NetApp ONTAP

| | |
|---|---|
| **Version** | 1.0.0 |
| **Vendor** | NetApp |
| **Splunk platform** | Splunk Enterprise, Splunk Cloud Platform |
| **Python version** | Python 3.9+ |
| **License** | See [LICENSE](LICENSE) |

## Overview

The Splunk Add-on for NetApp ONTAP collects operational data from NetApp ONTAP clusters via the ONTAP REST API and indexes it in Splunk for monitoring, alerting, and analysis.

The following data types are supported:

| Input | ONTAP REST Endpoint | Splunk Source Type |
|---|---|---|
| Qtrees | `/api/storage/qtrees` | `apiontap:qtrees` |
| Aggregates | `/api/storage/aggregates` | `apiontap:aggregates` |
| Volumes | `/api/storage/volumes` | `apiontap:volume` |
| SVMs | `/api/svm/svms` | `apiontap:svms` |
| Cluster Nodes | `/api/cluster/nodes` | `apiontap:cluster_nodes` |
| Cluster Identity | `/api/cluster` | `apiontap:cluster_identity` |

---

## Requirements

### Splunk platform

- Splunk Enterprise 8.2 or later, or Splunk Cloud Platform
- Python 3.9 or later (configured on the Splunk heavy forwarder or search head)

### NetApp ONTAP

- ONTAP 9.6 or later (REST API support required)
- A dedicated ONTAP user account with **read-only** access to the REST API (see [ONTAP user permissions](#ontap-user-permissions) below)
- Network connectivity from the Splunk instance to the ONTAP management interface on port **443** (HTTPS)

### ONTAP user permissions

The account used by this add-on requires the following minimum REST API access:

| API path | Access |
|---|---|
| `/api/storage/qtrees` | `readonly` |
| `/api/storage/aggregates` | `readonly` |
| `/api/storage/volumes` | `readonly` |
| `/api/svm/svms` | `readonly` |
| `/api/cluster/nodes` | `readonly` |
| `/api/cluster` | `readonly` |

To create a dedicated read-only role and user in ONTAP CLI:

```shell
security login role create -role splunk_readonly -cmddirname DEFAULT -access readonly
security login create -user-or-group-name splunk_svc -application http -authmethod password -role splunk_readonly
```

---

## Installation

1. Download the latest `.tar.gz` package from the [Releases](#) page.
2. In Splunk Web, go to **Apps → Manage Apps → Install app from file**.
3. Upload the `.tar.gz` file and click **Upload**.
4. Restart Splunk when prompted (or use `splunk restart` on the CLI).

> **Distributed deployments:** Install the add-on on your heavy forwarder(s) for data collection. Install on search heads for field extractions and knowledge objects. No configuration is required on indexers.

---

## Configuration

All configuration is done through the add-on's UI at **Apps → Splunk TA for NetApp ONTAP**.

### Step 1 — Configure an Account

An account stores the connection credentials for one ONTAP cluster.

1. Navigate to **Configuration → Accounts**.
2. Click **Add**.
3. Fill in the fields:

   | Field | Description |
   |---|---|
   | **Name** | A unique identifier for this account (e.g. `prod_cluster_01`). Cannot be changed after creation. |
   | **ONTAP Host** | Base URL of the ONTAP management interface, including scheme (e.g. `https://192.168.1.10`). |
   | **Username** | ONTAP username with REST API read access. |
   | **Password** | Password for the ONTAP user. Stored encrypted in Splunk's credential store. |
   | **Verify Host Connections** | When enabled, the add-on tests the connection to the ONTAP host on save and displays the result in the **Server Status** column. Disable if you want to save without an immediate connectivity check. |
   | **Verify TLS Certificates** | When enabled, ONTAP API calls validate the server certificate. Leave disabled for lab systems that use self-signed certificates. |

4. Click **Save**.
5. The **Server Status** column on the Accounts table will show `Connected` on success, or an error message if the host is unreachable.

> You can configure multiple accounts — one per ONTAP cluster.

---

### Step 2 — Configure Data Collection

The Data Collection tab creates and enables the modular inputs for a given account.

1. Navigate to **Configuration → Data Collection**.
2. Fill in the fields:

   | Field | Description |
   |---|---|
   | **Account** | Select the account configured in Step 1. |
   | **Index** | Splunk index where collected events will be stored. Defaults to `default`. |
   | **Interval** | How frequently to poll the ONTAP API, in seconds. Range: 10 – 3600. Default: `300`. |
   | **Request Timeout** | Maximum wait time for each ONTAP REST request, in seconds. Range: 1 – 300. Default: `30`. |
   | **Collect qtrees** | Enable/disable collection of qtree data. |
   | **Collect aggregates** | Enable/disable collection of aggregate data. |
   | **Collect volumes** | Enable/disable collection of volume data. |
   | **Collect SVMs** | Enable/disable collection of SVM (Storage Virtual Machine) data. |
   | **Collect cluster nodes** | Enable/disable collection of cluster node data. |
   | **Collect cluster identity** | Enable/disable collection of cluster-level identity data. |

3. Click **Save**.

   Saving will automatically:
   - **Create** a new modular input for each enabled data type (named `<account>_<type>`, e.g. `prod_cluster_01_qtrees`).
   - **Enable** inputs for checked data types.
   - **Disable** inputs for unchecked data types.

4. To verify, navigate to **Inputs**. You should see one input per enabled data type for the account, all with status **Active**.

> To collect from multiple ONTAP clusters, repeat Steps 1 and 2 for each cluster account.

---

### Step 3 — (Optional) Adjust Logging

1. Navigate to **Configuration → Logging**.
2. Set the log level (`DEBUG`, `INFO`, `WARNING`, `ERROR`, or `CRITICAL`). Default is `INFO`.

Add-on logs are written to:
```
$SPLUNK_HOME/var/log/splunk/splunk_ta_netapp_ontap_*.log
```

---

## Managing Inputs

Inputs created by the Data Collection tab appear on the **Inputs** page. From there you can:

- **Enable / Disable** individual inputs using the toggle in the Status column.
- **Edit** an input to change its index or interval independently.
- **Delete** an input to permanently remove it.
- **Sort by Account** using the Account column header to group inputs by cluster.

> **Note:** If you delete an account, all inputs associated with that account are automatically removed.

---

## Searching Data

All events collected by this add-on use source types in the format `apiontap:<input_type>`.

**Example searches:**

```spl
| index=default sourcetype="apiontap:volume"
| index=default sourcetype="apiontap:svms"
| index=default sourcetype="apiontap:cluster_identity"
```

---

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---|---|---|
| Server Status shows `Connection timeout` | ONTAP host unreachable on port 443 | Check firewall rules and the host URL format (`https://...`) |
| Server Status shows `Failed to connect… 401` | Invalid credentials | Re-enter the username/password on the Accounts tab |
| Inputs page shows no inputs after saving Data Collection | REST API error during input creation | Check `splunk_ta_netapp_ontap_data_collection_rh.log` for details |
| Events not appearing in Splunk | Input is disabled or wrong index | Verify the input is **Active** on the Inputs page and check the index name |
| `Error decrypting password` in logs | Credential store issue | Delete and re-create the account |

---

## Source Types

| Source type | Description |
|---|---|
| `apiontap:qtrees` | Qtree records from `/api/storage/qtrees` |
| `apiontap:aggregates` | Aggregate records from `/api/storage/aggregates` |
| `apiontap:volume` | Volume records from `/api/storage/volumes` |
| `apiontap:svms` | SVM records from `/api/svm/svms` |
| `apiontap:cluster_nodes` | Node records from `/api/cluster/nodes` |
| `apiontap:cluster_identity` | Cluster identity from `/api/cluster` |

---
