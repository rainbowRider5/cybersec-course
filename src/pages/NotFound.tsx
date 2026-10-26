import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="page prose">
      <h1>Not found</h1>
      <p>That page does not exist, or the module is not released yet.</p>
      <p>
        <Link to="/">Back to the course</Link>
      </p>
    </div>
  );
}
