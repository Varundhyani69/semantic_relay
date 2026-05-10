class MemoryWindow {
  constructor() {
    this.storage = new Map();
  }

  add(resourceKey, intentCtx) {
    if (!this.storage.has(resourceKey)) {
      this.storage.set(resourceKey, []);
    }
    this.storage.get(resourceKey).push(intentCtx);
  }

  async flush(resourceKey) {
    const intents = this.storage.get(resourceKey) || [];
    this.clear(resourceKey);
    return intents;
  }

  clear(resourceKey) {
    this.storage.delete(resourceKey);
  }
}

module.exports = MemoryWindow;
