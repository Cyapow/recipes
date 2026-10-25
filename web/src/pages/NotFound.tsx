import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <main className="page not-found">
      <h1>Page not found</h1>
      <p className="hint">That address doesn't match anything in your recipe book.</p>
      <Link className="btn primary" to="/">Back to library</Link>
    </main>
  );
}
