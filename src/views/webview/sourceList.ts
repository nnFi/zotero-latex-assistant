interface SourceListState {
  readonly id: string;
  readonly query: string;
  readonly selected: readonly string[];
  readonly present: readonly string[];
}

type SourceListAction = { type: "synchronize"; keys: string[] } | { type: "doi" | "refresh" }
  | { type: "cite" | "open"; key: string };
type SourceListReply = { type: "complete" } | { type: "error"; message: string };

declare function acquireVsCodeApi(): {
  getState(): SourceListState | undefined;
  setState(state: SourceListState): void;
  postMessage(message: SourceListAction): void;
};

// Standalone browser script: no Node.js or VS Code extension-host imports.
{
  const api = acquireVsCodeApi();
  const stateId = document.getElementById("list-header")!.dataset.stateId!;
  const saved = api.getState();
  const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  const search = document.getElementById("search") as HTMLInputElement;
  const all = document.getElementById("all") as HTMLInputElement;
  const importButton = document.getElementById("import") as HTMLButtonElement;
  const status = document.getElementById("status")!;
  const empty = document.getElementById("empty")!;
  let busy = false;
  const checkbox = (row: HTMLTableRowElement): HTMLInputElement => row.querySelector<HTMLInputElement>(".pick")!;
  const key = (row: HTMLTableRowElement): string => row.dataset.key!;
  const present = new Set(rows.filter((row) => row.dataset.inBib === "true").map(key));

  if (saved?.id === stateId) {
    search.value = saved.query || "";
    const selected = new Set(saved.selected || []);
    const previous = new Set(saved.present || []);
    for (const row of rows) {
      checkbox(row).checked = !checkbox(row).disabled && (present.has(key(row))
        ? !previous.has(key(row)) || selected.has(key(row)) : selected.has(key(row)) && !previous.has(key(row)));
    }
  }

  const picked = (): string[] => rows.filter((row) => checkbox(row).checked).map(key);
  function update(): void {
    const query = search.value.toLocaleLowerCase("en").trim();
    for (const row of rows) row.hidden = !(row.dataset.search ?? "").includes(query);
    const visible = rows.filter((row) => !row.hidden && !checkbox(row).disabled);
    const checked = visible.filter((row) => checkbox(row).checked).length;
    all.checked = visible.length > 0 && checked === visible.length;
    all.indeterminate = checked > 0 && checked < visible.length;
    all.disabled = busy || !visible.length;
    const selected = picked();
    document.getElementById("selection")!.textContent = `${selected.length} selected · ${rows.filter((row) => !row.hidden).length} sources`;
    importButton.disabled = busy;
    empty.hidden = rows.some((row) => !row.hidden);
    empty.textContent = rows.length ? "No sources match the filter." : "No sources available.";
    api.setState({ id: stateId, query: search.value, selected, present: [...present] });
  }

  function setBusy(value: boolean): void {
    busy = value;
    for (const button of document.querySelectorAll<HTMLButtonElement>("button")) {
      button.disabled = value || button.dataset.unavailable === "true";
    }
    for (const pick of document.querySelectorAll<HTMLInputElement>(".pick:not([data-unavailable])")) pick.disabled = value;
    search.disabled = value;
    update();
  }

  for (const row of rows) {
    const pick = checkbox(row);
    if (pick.disabled) pick.dataset.unavailable = "true";
    pick.addEventListener("change", update);
  }
  search.addEventListener("input", update);
  all.addEventListener("change", () => {
    for (const row of rows) if (!row.hidden && !checkbox(row).disabled) checkbox(row).checked = all.checked;
    update();
  });
  importButton.addEventListener("click", () => {
    if (busy) return;
    const keys = picked();
    setBusy(true);
    status.textContent = "Updating project .bib …";
    api.postMessage({ type: "synchronize", keys });
  });
  document.getElementById("doi")!.addEventListener("click", () => api.postMessage({ type: "doi" }));
  document.getElementById("refresh")!.addEventListener("click", () => {
    setBusy(true);
    status.textContent = "Refreshing list …";
    api.postMessage({ type: "refresh" });
  });
  document.querySelector("tbody")!.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>("[data-action]");
    if (!button || busy || button.disabled) return;
    const row = button.closest<HTMLTableRowElement>("tr");
    if (!row) return;
    const action = button.dataset.action;
    if (action === "select") {
      const pick = checkbox(row);
      if (!pick.disabled) { pick.checked = !pick.checked; update(); }
    } else if (action === "cite" || action === "open") {
      if (action === "cite") { setBusy(true); status.textContent = "Inserting citation …"; }
      api.postMessage({ type: action, key: key(row) });
    }
  });
  window.addEventListener("message", (event: MessageEvent<SourceListReply>) => {
    if (event.data.type === "error") { setBusy(false); status.textContent = event.data.message; }
    if (event.data.type === "complete") {
      if (busy) status.textContent = "";
      setBusy(false);
    }
  });
  update();
}
