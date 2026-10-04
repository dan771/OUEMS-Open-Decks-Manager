import { applyAction } from "./domain.js";
import { actionBasis, equal, prepareAction, setIds } from "./collaboration.js";

// Only reversible card placements and confirmation toggles are queued. Each
// command retains the values the organiser actually saw, even while offline.
export class BoardSaveQueue {
  constructor({ state, userId, send, onChange, persist, restored = [] }) {
    Object.assign(this, { state, userId, send, onChange, persist });
    this.entries = restored;
    this.running = false;
    this.stopped = false;
    this.error = restored.length ? { kind: "recovered" } : null;
  }
  get view() {
    let view = structuredClone(this.state);
    for (const { payload } of this.entries) {
      // If an incoming update already includes a save, or changes its read set,
      // retain that update rather than covering it with a stale local preview.
      if (!equal(payload.base, actionBasis(view, payload))) continue;
      const next = structuredClone(view);
      try {
        applyAction(
          next,
          payload,
          "",
          setIds(this.userId, payload.operationId),
        );
        view = next;
      } catch {
        // Removed cards/nights and changed plans are resolved by the server.
      }
    }
    return view;
  }
  accept(state) {
    if (state.version >= this.state.version) this.state = state;
    return this.view;
  }
  changed() {
    this.persist(
      this.entries.map(({ payload, label }) => ({ payload, label })),
    );
    this.onChange(this.view, this);
  }
  enqueue(action, snapshot = this.view, label = "Card updated") {
    if (this.stopped) return Promise.resolve(false);
    if (!["move", "confirm"].includes(action.type))
      throw new Error("This change cannot be queued.");
    if (this.entries.length >= 100)
      throw new Error("Finish or review the pending saves before adding more.");
    const payload = {
      ...prepareAction(snapshot, action),
      version: snapshot.version,
      operationId: crypto.randomUUID(),
    };
    // Validate before accepting an intent. No partially applied local preview.
    applyAction(
      structuredClone(snapshot),
      payload,
      "",
      setIds(this.userId, payload.operationId),
    );
    const promise = new Promise((resolve) => {
      this.entries.push({ payload, label, resolve });
    });
    this.changed();
    void this.drain();
    return promise;
  }
  async drain() {
    if (this.running || this.error || this.stopped || !this.entries.length)
      return;
    this.running = true;
    this.changed();
    try {
      while (this.entries.length && !this.stopped) {
        const entry = this.entries[0];
        try {
          const result = await this.send(entry.payload);
          if (this.stopped) return;
          this.entries.shift();
          this.accept(result.state);
          entry.resolve?.(result);
          this.changed();
        } catch (error) {
          if (this.stopped) return;
          this.error = {
            kind: error.status === 409 ? "conflict" : "failed",
            status: error.status,
            message: error.message,
          };
          entry.resolve?.(false);
          delete entry.resolve;
          this.changed();
          return;
        }
      }
    } finally {
      this.running = false;
      if (!this.stopped) this.changed();
    }
  }
  retry() {
    if (this.running || this.stopped) return;
    this.error = null;
    this.changed();
    void this.drain();
  }
  rebase(reviewedState) {
    if (this.running || this.stopped || this.error?.kind !== "conflict") return;
    // An explicit review is the only time a conflicting intent gets new guards.
    // Guard the reviewed snapshot, not a newer update arriving behind the dialog.
    const entries = [];
    let preview = structuredClone(reviewedState);
    for (const { payload, label, resolve } of this.entries) {
      const { base, version, operationId, ...action } = payload;
      const next = {
        ...prepareAction(preview, action),
        version: reviewedState.version,
        operationId: crypto.randomUUID(),
      };
      applyAction(preview, next, "", setIds(this.userId, next.operationId));
      entries.push({ payload: next, label, resolve });
    }
    this.entries = entries;
    this.error = null;
    this.changed();
    void this.drain();
  }
  discard() {
    if (this.running) return;
    for (const entry of this.entries) entry.resolve?.(false);
    this.entries = [];
    this.error = null;
    this.changed();
  }
  stop() {
    this.stopped = true;
    for (const entry of this.entries) entry.resolve?.(false);
  }
}
