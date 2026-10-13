import { FormLabel, Text } from "@/shared/components/builder-canvas";

export function LimitBody({
  limit,
  offset,
  onChange,
}: {
  limit: string;
  offset: string;
  onChange: (v: { limit: string; offset: string }) => void;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-1.5">
      <FormLabel>Rows</FormLabel>
      <Text
        label="Row count"
        value={limit}
        placeholder="100"
        inputMode="numeric"
        onValue={(v) => onChange({ limit: v, offset })}
      />
      <FormLabel>skip</FormLabel>
      <Text
        label="Offset"
        value={offset}
        placeholder="0"
        inputMode="numeric"
        onValue={(v) => onChange({ limit, offset: v })}
      />
    </div>
  );
}
