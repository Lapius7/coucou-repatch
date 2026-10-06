// The grip at the bottom edge of the views that can be pulled larger.

import { State } from "../core/state";
import { t } from "../core/i18n";
import { h } from "./dom";

/** Pull it down for a larger island, up to put it back (see Island.wireInput). */
export function pullGrip(): HTMLElement {
  const grip = h("div", { class: "pull-handle" });
  grip.addEventListener("mouseenter", () => {
    grip.title = State.enlarged ? t("log.shrink") : t("log.enlarge");
  });
  return grip;
}
