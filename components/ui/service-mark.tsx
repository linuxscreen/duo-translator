type Brand = {
  bg: string;
  fg: string;
  ch: string;
};

export function ServiceMark({ id }: { id: string }) {
  return (
    <img width={24} height={24} src={'/services/' + id + '.svg?url'} />
  );
}
