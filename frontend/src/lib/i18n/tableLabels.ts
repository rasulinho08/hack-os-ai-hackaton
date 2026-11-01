import type { TableLabels } from "@/components/ds/DataTable";
import { fill } from "@/lib/i18n/fill";

/** The shared data table's own words, in the reader's language. */
export function tableLabels(t: (key: string) => string): TableLabels {
  return {
    filters: t("tbl.filters"),
    clearAll: t("tbl.clear_all"),
    columns: t("tbl.columns"),
    count: (shown, total) => fill(t("tbl.count"), { shown, total }),
    selected: (n) => fill(t("tbl.selected"), { n }),
    clearSelection: t("tbl.clear_selection"),
    noMatches: t("tbl.no_matches"),
    nothingMatches: t("tbl.nothing_matches"),
    clearFilters: t("tbl.clear_filters"),
    selectAllPage: t("tbl.select_all_page"),
    selectRow: t("tbl.select_row"),
    page: (n, of) => fill(t("tbl.page"), { n, of }),
    prev: t("tbl.prev"),
    next: t("tbl.next"),
    prevPage: t("tbl.prev_page"),
    nextPage: t("tbl.next_page"),
  };
}
