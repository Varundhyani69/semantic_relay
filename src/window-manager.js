const MemoryWindow = require('./adapters/memory-window');
const scorer = require('./scorer');

class WindowManager {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 20;
    this.threshold = options.threshold || 0.8;
    this.storage = options.window || new MemoryWindow();
    this.timers = new Map();
    this.onFlushCallback = null;
  }

  onFlush(cb) {
    this.onFlushCallback = cb;
  }

  add(ctx) {
    this.storage.add(ctx.intent.resource, ctx);

    if (!this.timers.has(ctx.intent.resource)) {
      const timer = setTimeout(() => {
        this.timers.delete(ctx.intent.resource);
        this.flushResource(ctx.intent.resource);
      }, this.windowMs);
      this.timers.set(ctx.intent.resource, timer);
    }
  }

  async flushResource(resource) {
    const contexts = await this.storage.flush(resource);
    if (!contexts || contexts.length === 0) return;

    const groups = [];
    for (const ctx of contexts) {
      let placed = false;
      for (const group of groups) {
        const matchesGroup = group.some(existing => scorer(existing.intent, ctx.intent) >= this.threshold);
        if (matchesGroup) {
          group.push(ctx);
          placed = true;
          break;
        }
      }
      if (!placed) {
        groups.push([ctx]);
      }
    }

    if (this.onFlushCallback) {
      groups.forEach(group => this.onFlushCallback(group));
    }
  }
}

module.exports = WindowManager;
