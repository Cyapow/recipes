// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, getTheme, setTheme } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme', () => {
  it('defaults to following the device', () => {
    expect(getTheme()).toBe('system');
    applyTheme();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
  it('remembers dark and light, and clears on system', () => {
    setTheme('dark');
    expect(getTheme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    setTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    setTheme('system');
    expect(getTheme()).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
  it('ignores junk in storage', () => {
    localStorage.setItem('recipes.theme', 'purple');
    expect(getTheme()).toBe('system');
  });
});
