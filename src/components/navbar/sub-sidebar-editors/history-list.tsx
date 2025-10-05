import { RootState } from "@/redux/store";
import { useState } from "react";
import { useSelector } from "react-redux";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Clock, Search, Database, Check } from "lucide-react";
import { toast } from "sonner";

interface HistoryItem {
  query: string;
  timestamp: number;
  id: string;
}

const HistoryList = () => {
  const { queryHistory } = useSelector((state: RootState) => state.appDB);
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Convert queryHistory to HistoryItem format with timestamps
  const historyItems: HistoryItem[] = queryHistory.map((query, index) => ({
    query,
    timestamp: Date.now() - (queryHistory.length - index) * 60000, // Mock timestamps
    id: `history-${index}`,
  }));

  // Filter history based on search term
  const filteredHistory = historyItems.filter((item) =>
    item.query.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleCopyQuery = async (query: string, id: string) => {
    try {
      await navigator.clipboard.writeText(query);
      setCopiedId(id);
      toast.success("Query copied to clipboard");
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      toast.error("Failed to copy query");
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMinutes = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60),
    );

    if (diffInMinutes < 1) return "Just now";
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const getQueryType = (query: string) => {
    const trimmedQuery = query.trim().toLowerCase();
    if (trimmedQuery.startsWith("select")) return "SELECT";
    if (trimmedQuery.startsWith("insert")) return "INSERT";
    if (trimmedQuery.startsWith("update")) return "UPDATE";
    if (trimmedQuery.startsWith("delete")) return "DELETE";
    if (trimmedQuery.startsWith("create")) return "CREATE";
    if (trimmedQuery.startsWith("drop")) return "DROP";
    if (trimmedQuery.startsWith("alter")) return "ALTER";
    return "OTHER";
  };

  const getQueryTypeColor = (type: string) => {
    switch (type) {
      case "SELECT":
        return "bg-blue-500/10 text-blue-600 border-blue-200";
      case "INSERT":
        return "bg-green-500/10 text-green-600 border-green-200";
      case "UPDATE":
        return "bg-yellow-500/10 text-yellow-600 border-yellow-200";
      case "DELETE":
        return "bg-red-500/10 text-red-600 border-red-200";
      case "CREATE":
        return "bg-purple-500/10 text-purple-600 border-purple-200";
      case "DROP":
        return "bg-orange-500/10 text-orange-600 border-orange-200";
      case "ALTER":
        return "bg-indigo-500/10 text-indigo-600 border-indigo-200";
      default:
        return "bg-gray-500/10 text-gray-600 border-gray-200";
    }
  };

  const getQueryTypeDotColor = (type: string) => {
    switch (type) {
      case "SELECT":
        return "bg-blue-500";
      case "INSERT":
        return "bg-green-500";
      case "UPDATE":
        return "bg-yellow-500";
      case "DELETE":
        return "bg-red-500";
      case "CREATE":
        return "bg-purple-500";
      case "DROP":
        return "bg-orange-500";
      case "ALTER":
        return "bg-indigo-500";
      default:
        return "bg-gray-500";
    }
  };

  if (queryHistory.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-8">
        <Database className="mb-3 h-8 w-8 text-muted-foreground" />
        <h3 className="mb-1 text-sm font-semibold text-foreground">
          No Query History
        </h3>
        <p className="text-center text-xs text-muted-foreground">
          Your executed queries will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 transform text-muted-foreground" />
        <Input
          placeholder="Search queries..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="h-8 pl-7 text-xs focus-visible:ring-0 focus-visible:border-b-primary rounded-none"
        />
      </div>

      {/* History Count */}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-muted-foreground">
          {filteredHistory.length} of {queryHistory.length}
        </p>
        {searchTerm && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSearchTerm("")}
            className="h-6 px-2 text-xs"
          >
            Clear
          </Button>
        )}
      </div>

      {/* History List */}
      <div className="custom-scrollbar h-full space-y-1 overflow-y-auto">
        {filteredHistory.map((item, index) => {
          const queryType = getQueryType(item.query);
          const isCopied = copiedId === item.id;

          return (
            <div
              key={item.id}
              className="group relative border-l-2 border-transparent transition-all duration-200 hover:border-primary/30"
            >
              {/* Left border indicator */}
              <div
                className={`absolute left-0 top-0 h-full w-0.5 ${getQueryTypeDotColor(queryType)} opacity-0 transition-opacity group-hover:opacity-100`}
              />

              <div className="ml-2 py-2 pr-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {/* Header with type and timestamp */}
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <div
                          className={`h-2 w-2 rounded-full ${getQueryTypeDotColor(queryType)}`}
                        />
                        <span className="text-xs font-medium text-muted-foreground">
                          {queryType}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {formatTimestamp(item.timestamp)}
                      </div>
                    </div>

                    {/* Query Text */}
                    <div className="relative group/query">
                      <div className="rounded-md bg-muted/10 p-2 font-mono text-xs leading-relaxed transition-colors group-hover:bg-muted/20">
                        <code className="break-all text-foreground">
                          {item.query}
                        </code>
                      </div>

                      {/* Hover overlay with copy button */}
                      <div className="absolute inset-0 flex items-center justify-end rounded-md bg-gradient-to-l from-background/90 via-background/60 to-transparent opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover/query:opacity-100">
                        <div className="pr-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyQuery(item.query, item.id)}
                            className={`h-6 w-6 p-0 hover:bg-primary/10 transition-colors ${
                              isCopied ? "opacity-100 bg-primary/10" : ""
                            }`}
                          >
                            {isCopied ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredHistory.length === 0 && searchTerm && (
        <div className="py-6 text-center">
          <Search className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            {`No queries found matching "${searchTerm}"`}
          </p>
        </div>
      )}
    </div>
  );
};

export default HistoryList;
