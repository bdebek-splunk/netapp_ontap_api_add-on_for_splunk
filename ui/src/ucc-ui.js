import { uccInit } from "@splunk/add-on-ucc-framework";
import DataCollectionTab from "./ucc-ui-extensions/DataCollectionTab/index.jsx";

uccInit({
  data_collection_tab: {
    component: DataCollectionTab,
    type: "tab",
  },
}).catch((error) => {
  // Keep initialization failures visible in Splunk Web diagnostics.
  console.error("Could not initialize UCC custom UI", error);
});
