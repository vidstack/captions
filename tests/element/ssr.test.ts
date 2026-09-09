// @vitest-environment node

import { defineMediaCaptionsElement, MediaCaptionsElement } from '../../src/element';

test('module can be imported without a DOM', () => {
  expect(typeof HTMLElement).toBe('undefined');
  expect(typeof MediaCaptionsElement).toBe('function');
  expect(MediaCaptionsElement.observedAttributes).toContain('src');
});

test('defineMediaCaptionsElement is a no-op without customElements', () => {
  expect(typeof customElements).toBe('undefined');
  expect(() => defineMediaCaptionsElement()).not.toThrow();
  expect(() => defineMediaCaptionsElement('x-captions')).not.toThrow();
});
