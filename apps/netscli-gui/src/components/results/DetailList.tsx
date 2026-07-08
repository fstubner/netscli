export function DetailList({ lines }: { lines: { label: string; value: string; muted?: boolean }[] }) {
  return (
    <div className="detail-list">
      {lines.map((line) => (
        <div className={`detail-line ${line.muted ? 'muted-line' : ''}`} key={`${line.label}-${line.value}`}>
          <span>{line.label}</span>
          <code>{line.value}</code>
        </div>
      ))}
    </div>
  );
}
