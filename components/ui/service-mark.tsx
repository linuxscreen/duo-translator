type Brand = {
  bg: string;
  fg: string;
  ch: string;
};

export function ServiceMark({ id, size = 24 }: { id: string; size?: number }) {
  return (
    <img width={size} height={size} src={'/services/' + id + '.svg?url'} />
  );
}
