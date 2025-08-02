import { Node, NodeProps, Position, Handle } from "@xyflow/react";
import { KeyIcon, LinkIcon, DatabaseIcon, HashIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
  return (
    <div 
      className={cn(
        "group relative min-w-[320px] max-w-[380px] transition-all duration-300",
        "bg-card dark:bg-card",
        "border border-border",
        "rounded-xl shadow-lg hover:shadow-xl",
        "overflow-hidden",
        selected && "ring-2 ring-ring ring-offset-2"
      )}
    >
      {/* Clean Header */}
      <div className="bg-primary px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-primary-foreground/20 rounded-lg">
              <DatabaseIcon className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-primary-foreground">{data.label}</h3>
              <p className="text-xs text-primary-foreground/80">Table</p>
            </div>
          </div>
          <div className="text-xs text-primary-foreground/80 bg-primary-foreground/10 px-2 py-1 rounded-md">
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
                {entry.isForeign && entry.foreignTable && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <ChevronRightIcon className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      → {entry.foreignTable}.{entry.foreignColumn}
                    </span>
                  </div>
                )}
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
      {data.schema.map((entry, index) => (
        <Handle
          key={entry.title}
          id={entry.title}
          type={entry.isForeign ? "source" : "target"}
          position={entry.isForeign ? Position.Right : Position.Left}
          className={cn(
            "w-4 h-4 border-2 transition-all duration-200",
            "bg-card",
            "border-border",
            "hover:border-primary hover:scale-110",
            entry.isForeign && "border-primary hover:border-primary/80",
            entry.isPrimary && "border-yellow-500 hover:border-yellow-600"
          )}
          style={{
            top: `${72 + (index * 48)}px`,
            left: entry.isForeign ? 'auto' : '-8px',
            right: entry.isForeign ? '-8px' : 'auto',
          }}
        />
      ))}
    </div>
  );
}
