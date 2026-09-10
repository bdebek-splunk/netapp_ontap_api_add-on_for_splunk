// @splunk/ui-utils imports the full lodash package as CommonJS and expects
// named methods on the returned namespace. When esbuild bundles lodash for a
// browser, that interop can expose only the default function. Re-export the
// methods used by the Splunk UI utilities through a stable ESM namespace.
import defer from "lodash/defer";
import filter from "lodash/filter";
import includes from "lodash/includes";
import isString from "lodash/isString";
import isUndefined from "lodash/isUndefined";
import sortBy from "lodash/sortBy";

const lodashCompat = {
  defer,
  filter,
  includes,
  isString,
  isUndefined,
  sortBy,
};

export { defer, filter, includes, isString, isUndefined, sortBy };
export default lodashCompat;
