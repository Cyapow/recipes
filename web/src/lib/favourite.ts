/** `favouritedBy` with your address added or removed, keeping the server's sorted order. */
export function withStar(favouritedBy: string[], email: string, on: boolean): string[] {
  const others = favouritedBy.filter((e) => e !== email);
  return (on ? [...others, email] : others).sort();
}
