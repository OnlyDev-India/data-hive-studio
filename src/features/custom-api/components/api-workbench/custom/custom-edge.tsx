import { SmoothStepEdge, SmoothStepEdgeProps } from "@xyflow/react";

export function CustomEdge(props: SmoothStepEdgeProps) {
  return (
    <>
      <SmoothStepEdge
        {...props}
        style={{
          stroke: "hsl(var(--primary))",
          strokeWidth: 2,
          ...props.style,
        }}
      />
    </>
  );
}
