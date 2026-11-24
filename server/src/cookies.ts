export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

export function cookieAttrs(opts: { path: string; secure: boolean }): string {
  return `Path=${opts.path}; HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}`;
}
