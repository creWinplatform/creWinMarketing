export default function Brand({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <span className={`ryzevo-brand${inverse ? ' ryzevo-brand-inverse' : ''}${compact ? ' ryzevo-brand-compact' : ''}`}>
      <img src="/brand/ryzevo-brand-board.png" alt="Ryzevo" width={1536} height={1024} />
    </span>
  );
}
