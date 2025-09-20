import { Node, NodeProps, Position, Handle } from "@xyflow/react";
import { KeyIcon, LinkIcon, DatabaseIcon, HashIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Function to generate consistent colors based on table name
const generateTableColor = (tableName: string) => {
  // Create a simple hash from the table name
  let hash = 0;
  for (let i = 0; i < tableName.length; i++) {
    const char = tableName.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Use absolute value and modulo to get positive numbers
  const hue = Math.abs(hash) % 360;
  
  // Generate different saturation and lightness based on hash
  const saturation = 60 + (Math.abs(hash) % 30); // 60-90%
  const lightness = 45 + (Math.abs(hash >> 8) % 20); // 45-65%
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

type DatabaseSchemaNode = Node<{
  label: string;
  schema: { 
    title: string; 
    type: string;
    isPrimary?: boolean;
    isForeign?: boolean;
    foreignTable?: string;
    foreignColumn?: string;
  }[];
}>;

export function DatabaseSchemaNode({
  data,
  selected,
}: NodeProps<DatabaseSchemaNode>) {
  const headerColor = generateTableColor(data.label);
  
  return (
    <div 
      className={cn(
        "group relative min-w-[320px] max-w-[380px] transition-all duration-300",
        "bg-card dark:bg-card",
        "border border-border",
        "rounded-xl shadow-lg hover:shadow-xl",
        // Remove overflow-hidden to allow handles to be visible
        selected && "ring-2 ring-ring ring-offset-2"
      )}
    >
      {/* Clean Header with dynamic color */}
      <div 
        className="px-4 py-3 rounded-t-xl text-white"
        style={{ backgroundColor: headerColor }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-white/20 rounded-lg">
              <DatabaseIcon className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{data.label}</h3>
              <p className="text-xs text-white/80">Table</p>
            </div>
          </div>
          <div className="text-xs text-white/80 bg-white/10 px-2 py-1 rounded-md">
            {data.schema.length} fields
          </div>
        </div>
      </div>
      
      {/* Clean Content */}
      <div className="p-3 space-y-1">
        {data.schema.map((entry, index) => (
          <div 
            key={entry.title} 
            className={cn(
              "flex items-center justify-between p-2.5 rounded-lg transition-all duration-150",
              "hover:bg-accent/50",
              "border border-transparent hover:border-border"
            )}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* Status Icon */}
              <div className="flex-shrink-0">
                {entry.isPrimary && (
                  <div className="w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center">
                    <KeyIcon className="h-3 w-3 text-white" />
                  </div>
                )}
                {entry.isForeign && (
                  <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                    <LinkIcon className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
                {!entry.isPrimary && !entry.isForeign && (
                  <div className="w-6 h-6 bg-muted-foreground rounded-full flex items-center justify-center">
                    <HashIcon className="h-3 w-3 text-background" />
                  </div>
                )}
              </div>
              
              {/* Field Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-sm font-medium truncate",
                    entry.isPrimary && "text-yellow-600 dark:text-yellow-400",
                    entry.isForeign && "text-primary",
                    !entry.isPrimary && !entry.isForeign && "text-foreground"
                  )}>
                    {entry.title}
                  </span>
                  {entry.isPrimary && (
                    <span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 px-1.5 py-0.5 rounded">
                      PK
                    </span>
                  )}
                  {entry.isForeign && (
                    <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                      FK
                    </span>
                  )}
                </div>
                {/* {entry.isForeign && entry.foreignTable && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <ChevronRightIcon className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      → {entry.foreignTable}.{entry.foreignColumn}
                    </span>
                  </div>
                )} */}
              </div>
            </div>
            
            {/* Data Type */}
            <div className="flex-shrink-0 ml-3">
              <span className="text-xs font-mono bg-muted text-muted-foreground px-2 py-1 rounded border border-border">
                {entry.type}
              </span>
            </div>
          </div>
        ))}
      </div>
      
      {/* Connection Handles */}
      {data.schema.map((entry, index) => {
        const margin = entry.isForeign?70:50;
        const fieldTop = 100+(index*50);
        
        return (
          <Handle
            key={entry.title}
            id={entry.title}
            type={entry.isForeign ? "source" : "target"}
            position={entry.isForeign ? Position.Right : Position.Left}
            className={cn(
              "w-4 h-4 border-2 transition-all duration-200",
              "bg-background",
              "border-2",
              entry.isForeign && "border-primary bg-primary/20",
              entry.isPrimary && "border-yellow-500 bg-yellow-500/20"
            )}
            style={{
              top: `${fieldTop}px`,
              zIndex: 50,
            }}
          />
        );
      })}
    </div>
  );
}
