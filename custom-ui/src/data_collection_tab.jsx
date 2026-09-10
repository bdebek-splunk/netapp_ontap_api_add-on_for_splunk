import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as ButtonModule from "@splunk/react-ui/Button";
import * as ComboBoxModule from "@splunk/react-ui/ComboBox";
import * as MessageModule from "@splunk/react-ui/Message";
import * as WaitSpinnerModule from "@splunk/react-ui/WaitSpinner";
import { SplunkThemeProvider, pick, variables } from "@splunk/themes";
import * as styledComponents from "styled-components";

// esbuild can expose a CommonJS dependency as either the module namespace or
// its nested default export, depending on the browser bundle boundary.
const styledModule = styledComponents.default || styledComponents;
const styled = styledModule.default || styledModule;

function unwrapComponent(module) {
  const first = module?.default || module;
  return first?.default || first;
}

const Button = unwrapComponent(ButtonModule);
const ComboBox = unwrapComponent(ComboBoxModule);
const Message = unwrapComponent(MessageModule);
const WaitSpinner = unwrapComponent(WaitSpinnerModule);

const ADDON = "Splunk_TA_NetApp_ontap";
const SETTINGS_STANZA = "data_collection";
const DEFAULT_INTERVAL = 300;
const DEFAULT_TIMEOUT = 30;
const METRICS = [
  "qtrees",
  "aggregates",
  "volume",
  "svms",
  "cluster_nodes",
  "cluster_identity",
].map((name) => ({ name, label: name.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) }));

function makeSplunkUrl(path) {
  if (window.Splunk?.util?.make_url) return window.Splunk.util.make_url(path);
  if (/^\/splunkd(?:\/|$)/.test(path)) return path;
  const config = window.$C || {};
  const root = String(config.MRSPARKLE_ROOT_PATH || "").replace(/\/+$/, "");
  const locale = String(config.LOCALE || window.location.pathname.match(/^\/([a-z]{2}(?:-[A-Z]{2})?)\//)?.[1] || "").replace(/^\/+|\/+$/g, "");
  return `${root}${locale ? `/${locale}` : ""}/${String(path).replace(/^\/+/, "")}`;
}

function inputUrl(kind) {
  return makeSplunkUrl(`/splunkd/__raw/servicesNS/nobody/${ADDON}/${ADDON}_${kind}`);
}

function inputDeleteUrl(kind, name) {
  // UCC exposes these modular inputs through the add-on endpoint aliases.
  // The direct /data/inputs path is not routed by Splunk Web in this app.
  return makeSplunkUrl(`/splunkd/__raw/servicesNS/nobody/${ADDON}/${ADDON}_${kind}/${encodeURIComponent(name)}`);
}

function isMissingInputError(error) {
  const message = String(error?.message || "");
  return /^404:/.test(message) || /REST Error\s*\[404\]|Could not find object id=/i.test(message);
}

function formKey() {
  if (window.Splunk?.util?.getFormKey) return window.Splunk.util.getFormKey();
  const match = document.cookie.match(/(?:^|;\s*)splunkweb_csrf_token_[^=]+=([^\s;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function apiFetch(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    ...(options.headers || {}),
  };
  if (method !== "GET") {
    const key = formKey();
    if (key) headers["X-Splunk-Form-Key"] = key;
  }
  const response = await fetch(url, { credentials: "include", ...options, headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${body}`);
  if (method === "DELETE") return {};
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Non-JSON response from ${url} (${response.headers.get("content-type") || "unknown content type"})`);
  }
}

function themeValue(value) {
  if (value && typeof value === "object") value = value.colorScheme || value.theme || value.name;
  const normalized = String(value || "");
  if (/dark/i.test(normalized)) return "dark";
  if (/light|lite/i.test(normalized)) return "light";
  return "";
}

function computedColorScheme() {
  for (const element of [document.body, document.documentElement].filter(Boolean)) {
    const color = window.getComputedStyle(element).backgroundColor;
    const match = color.match(/^rgba?\(([^)]+)\)$/i);
    if (!match) continue;
    const channels = match[1].split(",").map((channel) => Number.parseFloat(channel.trim()));
    if (channels.length < 3 || channels.slice(0, 3).some((channel) => Number.isNaN(channel))) continue;
    if (channels.length === 4 && channels[3] === 0) continue;
    const luminance = (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255;
    return luminance < 0.45 ? "dark" : "light";
  }
  return "";
}

function resolveColorScheme() {
  // UCC populates __get_theme__ from its theme endpoint. Prefer that value
  // because it reflects the active Splunk instance theme rather than the
  // browser preference or a family-only value such as "enterprise".
  const loaded = themeValue(window.__get_theme__);
  if (loaded) return loaded;
  const direct = [window.__splunk_ui_theme__, window.$C?.SPLUNK_UI_THEME];
  for (const value of direct) {
    const scheme = themeValue(value);
    if (scheme) return scheme;
  }
  const elements = [document.documentElement, document.body].filter(Boolean);
  const values = elements.flatMap((element) => [
    element.dataset.theme,
    element.dataset.colorScheme,
    element.getAttribute("data-theme"),
    element.getAttribute("data-color-scheme"),
    ...element.classList,
  ]);
  const detected = values.find((value) => /dark|light/i.test(String(value || "")));
  if (detected) return themeValue(detected);
  const computed = computedColorScheme();
  if (computed) return computed;
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

function useInstanceColorScheme() {
  const [scheme, setScheme] = useState(resolveColorScheme);
  useEffect(() => {
    const refresh = () => {
      const next = resolveColorScheme();
      setScheme((current) => (current === next ? current : next));
    };
    const observer = new MutationObserver(refresh);
    [document.documentElement, document.body].filter(Boolean).forEach((element) => observer.observe(element, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-color-scheme"],
    }));
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener?.("change", refresh);
    const timer = window.setInterval(refresh, 500);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.("change", refresh);
      window.clearInterval(timer);
    };
  }, []);
  return scheme;
}

function enabled(content) {
  return !["1", "true", "True"].includes(String(content?.disabled ?? "0"));
}

function collectionNameFor(account, kind, inputName) {
  const legacyName = `${account}_${kind}`;
  if (inputName === legacyName) return account;
  const prefix = `${account}_`;
  const suffix = `_${kind}`;
  if (inputName.startsWith(prefix) && inputName.endsWith(suffix)) {
    return inputName.slice(prefix.length, -suffix.length) || account;
  }
  return inputName.endsWith(suffix) ? inputName.slice(0, -suffix.length) : inputName;
}

async function loadCollectionData() {
  const [accounts, indexes, settings, ...inputResponses] = await Promise.all([
    apiFetch(makeSplunkUrl(`/splunkd/__raw/servicesNS/nobody/${ADDON}/${ADDON}_account?output_mode=json&count=0`)),
    // Index discovery is only a convenience. A heavy forwarder may not be
    // able to enumerate indexes that are defined on the indexers, so allow
    // the collection form to load without this response.
    apiFetch(makeSplunkUrl("/splunkd/__raw/services/data/indexes?output_mode=json&count=0&search=isInternal%3D0")).catch(() => ({ entry: [] })),
    apiFetch(makeSplunkUrl(`/splunkd/__raw/servicesNS/nobody/${ADDON}/${ADDON}_settings/${SETTINGS_STANZA}?output_mode=json`)).catch(() => ({ entry: [] })),
    ...METRICS.map((metric) => apiFetch(`${inputUrl(metric.name)}?output_mode=json&count=0`)),
  ]);
  const accountList = (accounts.entry || []).map((entry) => ({ name: entry.name, host: entry.content?.host || "" }));
  const indexList = (indexes.entry || []).map((entry) => entry.name).filter((name) => !/^_/.test(name));
  if (!indexList.includes("default")) indexList.unshift("default");
  const byCollection = new Map();
  inputResponses.forEach((response, metricIndex) => {
    const metric = METRICS[metricIndex];
    (response.entry || []).forEach((entry) => {
      const content = entry.content || {};
      const account = String(content.account || "").trim();
      if (!account) return;
      const inputName = entry.name?.split("://").pop() || `${account}_${metric.name}`;
      const collectionName = collectionNameFor(account, metric.name, inputName);
      const key = `${account}::${collectionName}`;
      if (!byCollection.has(key)) byCollection.set(key, {
        account,
        collectionName,
        index: content.index || "default",
        metrics: {},
      });
      const collection = byCollection.get(key);
      collection.index = content.index || collection.index;
      collection.metrics[metric.name] = {
        interval: Number(content.interval) || DEFAULT_INTERVAL,
        enabled: enabled(content),
        name: inputName,
      };
    });
  });
  return {
    accounts: accountList,
    indexes: indexList,
    settings: settings.entry?.[0]?.content || {},
    collections: [...byCollection.values()].sort((left, right) => `${left.account}::${left.collectionName}`.localeCompare(`${right.account}::${right.collectionName}`)),
  };
}

function formForCollection(collection, defaultTimeout = DEFAULT_TIMEOUT) {
  return {
    name: collection?.collectionName || "",
    account: collection?.account || "",
    index: collection?.index || "default",
    timeout: String(collection?.timeout || defaultTimeout),
    metrics: Object.fromEntries(METRICS.map((metric) => [metric.name, {
      enabled: collection ? Boolean(collection.metrics[metric.name]?.enabled) : true,
      interval: String(collection?.metrics[metric.name]?.interval || DEFAULT_INTERVAL),
    }])),
  };
}

const AppShell = styled("main")`
  box-sizing: border-box;
  min-height: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: ${variables.spacingXLarge} ${variables.spacingXXLarge} ${variables.spacingXXXLarge};
  background: ${pick({ enterprise: variables.backgroundColorPage, prisma: variables.backgroundColorPage })};
  color: ${pick({ enterprise: variables.contentColorDefault, prisma: variables.contentColorDefault })};
  font-family: ${variables.sansFontFamily};
`;

const Header = styled("div")`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: ${variables.spacingXLarge};
  margin-bottom: ${variables.spacingXLarge};
`;

const NewCollectionButton = styled("div")`
  flex: 0 0 110px;
  width: 110px;
  max-width: 110px;
  & > button {
    width: 100%;
    min-width: 0;
    padding-left: ${variables.spacingSmall};
    padding-right: ${variables.spacingSmall};
  }
`;

const Title = styled("h1")`
  margin: 0 0 ${variables.spacingXSmall};
  color: ${pick({ enterprise: variables.contentColorActive, prisma: variables.contentColorActive })};
  font-size: ${variables.fontSizeXXLarge};
  font-weight: ${variables.fontWeightSemiBold};
`;

const Description = styled("p")`
  margin: 0;
  color: ${pick({ enterprise: variables.contentColorMuted, prisma: variables.contentColorMuted })};
  font-size: ${variables.fontSize};
`;

const Toolbar = styled("div")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${variables.spacingMedium};
  margin-bottom: ${variables.spacingSmall};
`;

const SectionTitle = styled("h2")`
  margin: 0;
  font-size: ${variables.fontSizeLarge};
  font-weight: ${variables.fontWeightSemiBold};
`;

const Count = styled("span")`
  color: ${pick({ enterprise: variables.contentColorMuted, prisma: variables.contentColorMuted })};
  font-size: ${variables.fontSizeSmall};
`;

const TableFrame = styled("div")`
  overflow-x: auto;
  border: 1px solid ${variables.borderColor};
  border-radius: ${variables.borderRadius};
  background: ${variables.backgroundColorSection};
`;

const Table = styled("table")`
  width: 100%;
  border-collapse: collapse;
  font-size: ${variables.fontSizeSmall};
  th {
    padding: ${variables.spacingSmall} ${variables.spacingMedium};
    border-bottom: 1px solid ${variables.borderColorStrong};
    background: ${variables.backgroundColorHover};
    color: ${variables.contentColorMuted};
    font-weight: ${variables.fontWeightSemiBold};
    text-align: left;
    white-space: nowrap;
  }
  td {
    padding: ${variables.spacingMedium};
    border-bottom: 1px solid ${variables.borderColorWeak};
    vertical-align: top;
  }
  tr:last-child td { border-bottom: 0; }
  tr:hover td { background: ${variables.backgroundColorHover}; }
`;

const Strong = styled("span")`
  color: ${variables.contentColorActive};
  font-weight: ${variables.fontWeightSemiBold};
`;

const Secondary = styled("span")`
  display: block;
  margin-top: ${variables.spacingQuarter};
  color: ${variables.contentColorMuted};
  font-size: ${variables.fontSizeSmall};
`;

const MetricList = styled("div")`
  display: flex;
  flex-wrap: wrap;
  gap: ${variables.spacingXSmall} ${variables.spacingMedium};
  min-width: 300px;
`;

const ActionButtons = styled("div")`
  display: flex;
  flex-wrap: wrap;
  gap: ${variables.spacingXSmall};
  white-space: nowrap;
`;

const Metric = styled("span")`
  color: ${variables.contentColorMuted};
  white-space: nowrap;
  &::after { content: ""; display: inline-block; width: 5px; height: 5px; margin: 0 0 2px ${variables.spacingXSmall}; border-radius: 50%; background: ${variables.contentColorPositive}; }
`;

const Empty = styled("div")`
  padding: ${variables.spacingXXXLarge} ${variables.spacingXLarge};
  color: ${variables.contentColorMuted};
  text-align: center;
`;

const Form = styled("form")`
  display: grid;
  gap: ${variables.spacingMedium};
  min-width: min(620px, 78vw);
`;

const Field = styled("label")`
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  align-items: start;
  gap: ${variables.spacingMedium};
  color: ${variables.contentColorMuted};
  font-size: ${variables.fontSizeSmall};
  font-weight: ${variables.fontWeightSemiBold};
  > span { padding-top: ${variables.spacingSmall}; }
`;

const Input = styled("input")`
  width: 100%;
  min-height: 34px;
  padding: ${variables.spacingXSmall} ${variables.spacingSmall};
  border: 1px solid ${variables.interactiveColorBorder};
  border-radius: ${variables.borderRadius};
  background: ${variables.backgroundColorSection};
  color: ${variables.contentColorDefault};
  font: inherit;
  &:focus { outline: 2px solid ${variables.focusColor}; outline-offset: 1px; }
`;

const Select = styled("select")`
  width: 100%;
  min-height: 34px;
  padding: ${variables.spacingXSmall} ${variables.spacingSmall};
  border: 1px solid ${variables.interactiveColorBorder};
  border-radius: ${variables.borderRadius};
  background: ${variables.backgroundColorSection};
  color: ${variables.contentColorDefault};
  font: inherit;
`;

const Help = styled("span")`
  display: block;
  margin-top: ${variables.spacingQuarter};
  color: ${variables.contentColorMuted};
  font-size: ${variables.fontSizeSmall};
  font-weight: ${variables.fontWeightNormal};
`;

const MetricSection = styled("div")`
  margin-top: ${variables.spacingMedium};
  padding-top: ${variables.spacingMedium};
  border-top: 1px solid ${variables.borderColor};
`;

const MetricHeader = styled("div")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${variables.spacingMedium};
`;

const MetricRow = styled("div")`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  align-items: center;
  gap: ${variables.spacingMedium};
  padding: ${variables.spacingSmall} 0;
  border-bottom: 1px solid ${variables.borderColorWeak};
`;

const CheckLabel = styled("label")`
  display: flex;
  align-items: center;
  gap: ${variables.spacingXSmall};
  color: ${variables.contentColorDefault};
  font-size: ${variables.fontSizeSmall};
  font-weight: ${variables.fontWeightNormal};
`;

const Interval = styled("div")`
  display: flex;
  align-items: center;
  gap: ${variables.spacingXSmall};
  color: ${variables.contentColorMuted};
  font-size: ${variables.fontSizeSmall};
  ${Input} { width: 100px; }
`;

const DialogBackdrop = styled("div")`
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${variables.spacingXXLarge};
  background: rgba(0, 0, 0, 0.62);
`;

const Dialog = styled("div")`
  display: flex;
  flex-direction: column;
  width: min(760px, 100%);
  max-height: calc(100vh - 96px);
  overflow: hidden;
  border: 1px solid ${variables.borderColorStrong};
  border-radius: ${variables.borderRadius};
  background: ${pick({ enterprise: variables.backgroundColor, prisma: variables.backgroundColorDialog })};
  color: ${variables.contentColorDefault};
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
`;

const DialogHeader = styled("div")`
  flex: 0 0 auto;
  padding: ${variables.spacingLarge} ${variables.spacingXLarge};
  border-bottom: 1px solid ${variables.borderColor};
  font-size: ${variables.fontSizeLarge};
  font-weight: ${variables.fontWeightSemiBold};
`;

const DialogBody = styled("div")`
  flex: 1 1 auto;
  overflow: auto;
  padding: ${variables.spacingXLarge};
`;

const DialogFooter = styled("div")`
  display: flex;
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: ${variables.spacingSmall};
  padding: ${variables.spacingLarge} ${variables.spacingXLarge};
  border-top: 1px solid ${variables.borderColor};
  background: ${pick({ enterprise: variables.backgroundColor, prisma: variables.backgroundColorDialog })};
`;

function ThemeShell({ children }) {
  const colorScheme = useInstanceColorScheme();
  return (
    <SplunkThemeProvider family="enterprise" density="comfortable" colorScheme={colorScheme}>
      {children}
    </SplunkThemeProvider>
  );
}

const IndexComboBox = styled(ComboBox)`
  display: block;
  width: 100%;
  font: inherit;
  color: ${variables.contentColorDefault};
  & input {
    font: inherit;
    color: inherit;
  }
`;

function filterIndexOptions(indexes, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  return indexes.filter((index) => !normalizedQuery || index.toLowerCase().includes(normalizedQuery));
}

function IndexPicker({ value, indexes, onChange, disabled }) {
  const [options, setOptions] = useState(() => filterIndexOptions(indexes, value));
  const [isLoading, setIsLoading] = useState(false);
  const requestRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setOptions(filterIndexOptions(indexes, value));
  }, [indexes, value]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const fetchOptions = useCallback(async (query = "") => {
    requestRef.current?.abort();
    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    requestRef.current = controller;
    setIsLoading(true);

    try {
      const data = await apiFetch(makeSplunkUrl("/splunkd/__raw/services/data/indexes?output_mode=json&count=0&search=isInternal%3D0"), { signal: controller.signal });
      if (requestId !== requestIdRef.current) return;
      const discoveredIndexes = (data.entry || [])
        .map((entry) => entry.name)
        .filter((name) => name && !/^_/.test(name));
      if (!discoveredIndexes.includes("default")) discoveredIndexes.unshift("default");
      setOptions(filterIndexOptions(discoveredIndexes, query));
    } catch (error) {
      if (error.name !== "AbortError" && requestId === requestIdRef.current) {
        // Index discovery is optional. Keep existing suggestions and allow
        // the user to enter a custom index when the endpoint is unavailable.
        setOptions(filterIndexOptions(indexes, query));
      }
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [indexes]);

  const handleChange = useCallback((event, data) => {
    const nextValue = data?.value ?? event.target?.value ?? "";
    onChange(nextValue);
    fetchOptions(nextValue);
  }, [fetchOptions, onChange]);

  return (
    <IndexComboBox
      value={value}
      controlledFilter
      disabled={disabled}
      placeholder="Enter or select an index"
      onChange={handleChange}
      onOpen={() => fetchOptions(value)}
      isLoadingOptions={isLoading}
      noOptionsMessage="No discovered indexes. You can enter a custom index."
    >
      {options.map((index) => <ComboBox.Option key={index} value={index} />)}
    </IndexComboBox>
  );
}

function CollectionModal({ form, accounts, indexes, isEdit, saving, onChange, onClose, onSave }) {
  const allMetricsEnabled = METRICS.every((metric) => form.metrics[metric.name].enabled);
  const toggleAllMetrics = () => {
    const nextEnabled = !allMetricsEnabled;
    METRICS.forEach((metric) => onChange(`metrics.${metric.name}.enabled`, nextEnabled));
  };

  return (
    <DialogBackdrop role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <Dialog role="dialog" aria-modal="true" aria-labelledby="collection-dialog-title">
        <DialogHeader id="collection-dialog-title">{isEdit ? "Edit Collection" : "New Collection"}</DialogHeader>
        <DialogBody>
        <Form id="collection-form" onSubmit={onSave}>
          <Field>
            <span>Collection name</span>
            <div>
              <Input value={form.name} disabled={isEdit} pattern="[A-Za-z][A-Za-z0-9_]*" maxLength="100" required onChange={(event) => onChange("name", event.target.value)} />
              <Help>A unique name for this collection on the selected account.</Help>
            </div>
          </Field>
          <Field>
            <span>Account</span>
            <Select value={form.account} disabled={isEdit} required onChange={(event) => onChange("account", event.target.value)}>
              <option value="">Select an account</option>
              {accounts.map((account) => <option key={account.name} value={account.name}>{account.name}</option>)}
            </Select>
          </Field>
          <Field>
            <span>Index</span>
            <div>
              <IndexPicker
                value={form.index}
                indexes={indexes}
                onChange={(value) => onChange("index", value)}
              />
              <Help>Type to fetch index suggestions, or enter a custom index name.</Help>
            </div>
          </Field>
          <Field>
            <span>Request timeout</span>
            <div>
              <Input type="number" min="1" max="300" value={form.timeout} required onChange={(event) => onChange("timeout", event.target.value)} />
              <Help>Maximum wait for each ONTAP REST request (1–300 seconds).</Help>
            </div>
          </Field>
          <MetricSection>
            <MetricHeader>
              <strong>Metrics</strong>
              <Button type="button" appearance="subtle" onClick={toggleAllMetrics} disabled={saving ? "disabled" : false}>
                {allMetricsEnabled ? "Deselect all" : "Select all"}
              </Button>
            </MetricHeader>
            <Help>Enable metrics and set each interval independently (10–3600 seconds).</Help>
            {METRICS.map((metric) => (
              <MetricRow key={metric.name}>
                <CheckLabel>
                  <input type="checkbox" checked={form.metrics[metric.name].enabled} onChange={(event) => onChange(`metrics.${metric.name}.enabled`, event.target.checked)} />
                  {metric.label}
                </CheckLabel>
                <Interval>
                  <Input type="number" min="10" max="3600" value={form.metrics[metric.name].interval} aria-label={`${metric.label} interval`} onChange={(event) => onChange(`metrics.${metric.name}.interval`, event.target.value)} />
                  seconds
                </Interval>
              </MetricRow>
            ))}
          </MetricSection>
        </Form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" appearance="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="collection-form" appearance="primary" disabled={saving ? "disabled" : false}>{saving ? "Saving…" : "Save Collection"}</Button>
        </DialogFooter>
      </Dialog>
    </DialogBackdrop>
  );
}

function DataCollectionApp() {
  const [accounts, setAccounts] = useState([]);
  const [indexes, setIndexes] = useState(["default"]);
  const [settings, setSettings] = useState({});
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await loadCollectionData();
      setAccounts(data.accounts);
      setIndexes(data.indexes);
      setSettings(data.settings);
      setCollections(data.collections);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const openNew = () => {
    setForm(formForCollection(null, settings.request_timeout));
    setModal({ isEdit: false, original: null });
  };

  const openEdit = (collection) => {
    setForm(formForCollection(collection, settings.request_timeout));
    setModal({ isEdit: true, original: collection });
  };

  const updateForm = (path, value) => {
    setForm((current) => {
      const next = { ...current, metrics: { ...current.metrics } };
      const parts = path.split(".");
      if (parts[0] === "metrics") next.metrics[parts[1]] = { ...next.metrics[parts[1]], [parts[2]]: value };
      else next[parts[0]] = value;
      return next;
    });
  };

  const showError = (message) => setNotice({ type: "error", message });

  const save = async (event) => {
    event.preventDefault();
    const selected = METRICS.filter((metric) => form.metrics[metric.name].enabled);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(form.name)) return showError("Collection name must begin with a letter and contain only letters, numbers, and underscores.");
    if (!form.account) return showError("Select an account before saving.");
    const duplicate = collections.find((collection) => collection.account === form.account && collection.collectionName === form.name);
    if (duplicate && !(modal.isEdit && modal.original.account === form.account && modal.original.collectionName === form.name)) return showError("A collection with this name already exists for the selected account.");
    if (!/^\d+$/.test(form.timeout) || Number(form.timeout) < 1 || Number(form.timeout) > 300) return showError("Request timeout must be between 1 and 300 seconds.");
    if (!selected.length) return showError("Select at least one metric.");
    for (const metric of selected) {
      const interval = form.metrics[metric.name].interval;
      if (!/^\d+$/.test(interval) || Number(interval) < 10 || Number(interval) > 3600) return showError(`${metric.label} interval must be between 10 and 3600 seconds.`);
    }
    const params = new URLSearchParams({
      output_mode: "json",
      collection_name: form.name,
      account: form.account,
      index: form.index || "default",
      interval: form.metrics[selected[0].name].interval,
      request_timeout: form.timeout,
    });
    METRICS.forEach((metric) => {
      params.set(`collect_${metric.name}`, form.metrics[metric.name].enabled ? "1" : "0");
      params.set(`interval_${metric.name}`, form.metrics[metric.name].interval || String(DEFAULT_INTERVAL));
    });
    setSaving(true);
    try {
      await apiFetch(makeSplunkUrl(`/splunkd/__raw/servicesNS/nobody/${ADDON}/${ADDON}_settings/${SETTINGS_STANZA}`), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      setModal(null);
      setForm(null);
      setNotice({ type: "success", message: "Collection saved successfully." });
      await refresh();
    } catch (saveError) {
      showError(`Could not save collection: ${saveError.message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (collection) => {
    const key = `${collection.account}::${collection.collectionName}`;
    const confirmed = window.confirm(
      `Delete collection "${collection.collectionName}" for account "${collection.account}"? This will remove all connected metric inputs.`
    );
    if (!confirmed) return;

    setDeleting(key);
    setNotice(null);
    try {
      const deleted = await Promise.all(METRICS.map((metric) => {
        const inputName = collection.metrics[metric.name]?.name || (
          collection.collectionName === collection.account
            ? `${collection.account}_${metric.name}`
            : `${collection.account}_${collection.collectionName}_${metric.name}`
        );
        return apiFetch(inputDeleteUrl(metric.name, inputName), { method: "DELETE" }).then(() => true).catch((deleteError) => {
          // A partially-created collection may not have an input for every metric.
          // UCC can wrap the underlying 404 in an HTTP 500 XML response.
          if (isMissingInputError(deleteError)) return false;
          throw deleteError;
        });
      }));
      if (!deleted.some(Boolean)) throw new Error("No connected inputs were found for this collection.");
      setNotice({ type: "success", message: `Collection "${collection.collectionName}" deleted successfully.` });
      await refresh();
    } catch (deleteError) {
      showError(`Could not delete collection: ${deleteError.message}`);
      await refresh();
    } finally {
      setDeleting(null);
    }
  };

  const metricLabels = useMemo(() => Object.fromEntries(METRICS.map((metric) => [metric.name, metric.label])), []);

  return (
    <AppShell>
      <Header>
        <div><Title>Data Collection</Title><Description>Manage ONTAP collections and set an independent polling interval for every metric.</Description></div>
        <NewCollectionButton>
          <Button appearance="primary" onClick={openNew}>New Collection</Button>
        </NewCollectionButton>
      </Header>
      {notice && <Message type={notice.type} appearance="fill" onRequestRemove={() => setNotice(null)}>{notice.message}</Message>}
      <Toolbar><SectionTitle>Collections</SectionTitle><Count>{collections.length} {collections.length === 1 ? "collection" : "collections"}</Count></Toolbar>
      {loading ? <Empty><WaitSpinner size="medium" /></Empty> : error ? <Message type="error">Could not load collections: {error}</Message> : !collections.length ? <Empty><strong>No collections created</strong><Secondary>Choose New Collection to start collecting ONTAP metrics.</Secondary></Empty> : (
        <TableFrame>
          <Table>
            <thead><tr><th>Collection</th><th>Account</th><th>Index</th><th>Metrics</th><th>Actions</th></tr></thead>
            <tbody>{collections.map((collection) => {
              const activeMetrics = METRICS.filter((metric) => collection.metrics[metric.name]?.enabled);
              return <tr key={`${collection.account}::${collection.collectionName}`}>
                <td><Strong>{collection.collectionName}</Strong></td>
                <td><Strong>{collection.account}</Strong><Secondary>{accounts.find((account) => account.name === collection.account)?.host || ""}</Secondary></td>
                <td>{collection.index || "default"}</td>
                <td><MetricList>{activeMetrics.length ? activeMetrics.map((metric) => <Metric key={metric.name}>{metricLabels[metric.name]}</Metric>) : <Secondary>None active</Secondary>}</MetricList></td>
                <td>
                  <ActionButtons>
                    <Button appearance="secondary" onClick={() => openEdit(collection)} disabled={deleting ? "disabled" : false}>Edit</Button>
                    <Button appearance="destructive" onClick={() => remove(collection)} disabled={deleting ? "disabled" : false} aria-label={`Delete ${collection.collectionName}`}>{deleting === `${collection.account}::${collection.collectionName}` ? "Deleting…" : "Delete"}</Button>
                  </ActionButtons>
                </td>
              </tr>;
            })}</tbody>
          </Table>
        </TableFrame>
      )}
      {modal && form && <CollectionModal form={form} accounts={accounts} indexes={indexes} isEdit={modal.isEdit} saving={saving} onChange={updateForm} onClose={() => { setModal(null); setForm(null); }} onSave={save} />}
    </AppShell>
  );
}

class DataCollectionTab {
  constructor(tab, element) {
    this.tab = tab;
    this.element = element;
    this.root = null;
  }

  render() {
    this.root = createRoot(this.element);
    this.root.render(<ThemeShell><DataCollectionApp /></ThemeShell>);
  }
}

export default DataCollectionTab;
