import { Card } from "@/components/ui/card";
import { useWorkbench } from "@/features/custom-api/context";
import { cn } from "@/lib/utils";

interface BaseNodeProps extends React.HTMLAttributes<HTMLDivElement> {
  id?: string;
}

export const BaseNode = ({ className, children, ...props }: BaseNodeProps) => {
  const { id } = props;
  const { getCurrentSelectedNodeId } = useWorkbench();
  const selected = getCurrentSelectedNodeId() === id;
  return (
    <Card
      className={cn(
        "group min-w-[280px] max-w-[320px] transition-all duration-200",
        "border-2 bg-background shadow-lg",
        selected && "ring-2 ring-primary ring-offset-0",
        className,
      )}
      {...props}
    >
      {children}
    </Card>
  );
};
