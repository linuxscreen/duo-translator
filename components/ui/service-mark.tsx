type Brand = {
  bg: string;
  fg: string;
  ch: string;
};

const map: Record<string, Brand> = {
  google: { bg: '#fff', fg: '#1a73e8', ch: 'G' },
  deepl: { bg: '#0f2b46', fg: '#fff', ch: 'D' },
  microsoft: { bg: '#fff', fg: '#0078d4', ch: 'M' },
  openai: { bg: '#0d0d0d', fg: '#fff', ch: 'A' },
};

export function ServiceMark({ id }: { id: string }) {
  const m = map[id] ?? map.google;
  return (
    <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden rounded border border-line text-[10px] leading-none">
      <span
        className="flex h-full w-full items-center justify-center font-bold"
        style={{ background: m.bg, color: m.fg }}
      >
        {m.ch}
      </span>
    </span>
  );
}
