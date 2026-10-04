(function (global) {
  'use strict';
  class MemoryStorage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
  }
  const valid = (value) => value?.version === 1 && typeof value.text === 'string'
    && typeof value.title === 'string' && value.title.length <= 80
    && Number.isFinite(value.focusSeconds) && value.focusSeconds >= 0;
  class DraftStore {
    constructor(storage) { this.storage = storage; this.key = 'sonata-workspace-v1'; this.backupKey = `${this.key}-previous`; this.lastRaw = null; this.conflict = false; }
    parse(raw) { try { const value = JSON.parse(raw); return valid(value) ? value : null; } catch { return null; } }
    previous() { try { return this.parse(this.storage?.getItem(this.backupKey)); } catch { return null; } }
    load() {
      if (!this.storage) return { text: '', title: '未命名的故事', focusSeconds: 0, unavailable: true };
      try {
        this.lastRaw = this.storage?.getItem(this.key) ?? null;
        const primary = this.parse(this.lastRaw);
        if (primary) return { ...primary, recovered: false };
        const backup = this.parse(this.storage?.getItem(this.backupKey));
        if (backup) return { ...backup, recovered: true };
        return { text: this.storage?.getItem('sonata-novel-draft') || '',
          title: (this.storage?.getItem('sonata-novel-title') || '未命名的故事').slice(0, 80),
          focusSeconds: 0, recovered: false };
      } catch { return { text: '', title: '未命名的故事', focusSeconds: 0, unavailable: true }; }
    }
    save({ text, title, focusSeconds }) {
      const next = { version: 1, text, title: title.slice(0, 80), focusSeconds, savedAt: new Date().toISOString() };
      if (!valid(next) || !this.storage) return false;
      try {
        const previous = this.storage.getItem(this.key);
        if (previous !== this.lastRaw) { this.conflict = true; return false; }
        // Preserve only valid snapshots; a corrupt primary never replaces the recovery copy.
        const old = this.parse(previous);
        if (old && (old.text !== next.text || old.title !== next.title)) this.storage.setItem(this.backupKey, previous);
        const raw = JSON.stringify(next);
        this.storage.setItem(this.key, raw);
        this.lastRaw = raw;
        return true;
      } catch { return false; }
    }
  }
  global.SonataDraftStore = DraftStore;
  global.SonataMemoryStorage = MemoryStorage;
})(typeof window !== 'undefined' ? window : globalThis);
