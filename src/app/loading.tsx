export default function Loading() {
  return (
    <div className="mx-auto max-w-[1240px] space-y-3">
      <div className="skeleton h-10 w-64" />
      <div className="skeleton h-40 w-full rounded-[16px]" />
    </div>
  );
}
