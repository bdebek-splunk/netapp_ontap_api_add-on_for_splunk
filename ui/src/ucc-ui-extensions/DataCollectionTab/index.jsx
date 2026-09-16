import React from "react";
import ReactDOM from "react-dom";
import { CustomTabBase } from "@splunk/add-on-ucc-framework";
import { DataCollectionApp, ThemeShell } from "../../data_collection_app.jsx";

export default class DataCollectionTab extends CustomTabBase {
  render() {
    ReactDOM.render(
      <ThemeShell>
        <DataCollectionApp />
      </ThemeShell>,
      this.el,
    );
  }
}
