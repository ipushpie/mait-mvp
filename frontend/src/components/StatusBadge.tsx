'use client';

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  let className = 'badge ';

  switch (s) {
    case 'queued':
      className += 'badge-queued';
      break;
    case 'processing':
      className += 'badge-processing';
      break;
    case 'ready':
    case 'done':
      className += 'badge-ready';
      break;
    case 'partial':
      className += 'badge-running';
      break;
    case 'failed':
      className += 'badge-failed';
      break;
    case 'running':
      className += 'badge-running';
      break;
    case 'pending':
      className += 'badge-pending';
      break;
    default:
      className += 'badge-queued';
  }

  return <span className={className}>{status}</span>;
}
