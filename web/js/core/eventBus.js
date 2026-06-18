const target = new EventTarget();

export const eventBus = {
  on(type, handler) {
    target.addEventListener(type, handler);
    return () => target.removeEventListener(type, handler);
  },
  emit(type, detail = {}) {
    target.dispatchEvent(new CustomEvent(type, { detail }));
  },
};
