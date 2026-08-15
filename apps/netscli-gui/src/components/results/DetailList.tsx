export function DetailList({ lines }: { lines: { label: string; value: string; muted?: boolean }[] }) {
  return (
    <div className="detail-list">
      {lines.map((line, index) => (
        <div className={`detail-line ${line.muted ? 'muted-line' : ''}`} // Index-qualified: two identical TXT records produce the same
          // label+value pair, and React silently drops the duplicate (C-12).
          key={`${index}-${line.label}-${line.value}`}>
          <span>{line.label}</span>
          <code>{line.value}</code>
        </div>
      ))}
    </div>
  );
}
