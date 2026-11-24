import { describe, expect, it } from 'vitest';
import { cookieAttrs, readCookie } from './cookies.js';

describe('readCookie', () => {
  it('finds one cookie among several', () => {
    expect(readCookie('a=1; b=2; c=3', 'b')).toBe('2');
  });

  it('keeps any "=" inside the value', () => {
    expect(readCookie('tok=abc==; other=x', 'tok')).toBe('abc==');
  });

  it('does not match a name that is a prefix or suffix of another', () => {
    expect(readCookie('recipes_session_old=1; xrecipes_session=2', 'recipes_session')).toBeUndefined();
    expect(readCookie('recipes_session_old=1; recipes_session=2', 'recipes_session')).toBe('2');
  });

  it('returns undefined for a missing header or a missing cookie', () => {
    expect(readCookie(undefined, 'a')).toBeUndefined();
    expect(readCookie('', 'a')).toBeUndefined();
    expect(readCookie('b=1', 'a')).toBeUndefined();
  });
});

describe('cookieAttrs', () => {
  it('scopes the path and adds Secure only when asked', () => {
    expect(cookieAttrs({ path: '/x', secure: false })).toBe('Path=/x; HttpOnly; SameSite=Lax');
    expect(cookieAttrs({ path: '/', secure: true })).toBe('Path=/; HttpOnly; SameSite=Lax; Secure');
  });
});
