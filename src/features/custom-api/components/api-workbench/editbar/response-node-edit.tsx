import { useEffect, useState, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useWorkbenchRedux } from "@/features/custom-api/hooks/use-workbench-redux";
import {
  ResponseNodeData,
  EndpointNodeData,
  APIEndpoint,
} from "@/features/custom-api/types/custom-api.type";
import JsonEditor, { JsonEditorRef } from "./json-editor";
import { useSelector } from "react-redux";

// Validation schema
const responseNodeSchema = z.object({
  statusCode: z
    .number()
    .min(100)
    .max(599, "Status code must be between 100 and 599"),
  responseBody: z
    .string()
    .min(1, "Response body is required")
    .refine((val) => {
      try {
        // Replace template variables with placeholder values for validation
        const templateRegex = /\{\{[^}]+\}\}/g;
        const validationString = val.replace(templateRegex, '"TEMPLATE_VAR"');
        JSON.parse(validationString);
        return true;
      } catch {
        return false;
      }
    }, "Response body must be valid JSON (template variables like {{body.name}} are allowed)"),
  description: z.string().optional(),
});

type ResponseNodeFormData = z.infer<typeof responseNodeSchema>;

const ResponseNodeEdit = () => {
  const { getCurrentSelectedNodeId, currentEndpointState, updateNode } =
    useWorkbenchRedux();
  const { currentAPI } = useSelector((state: any) => state.api);
  const [useCustomStatusCode, setUseCustomStatusCode] = useState(false);
  const monacoEditorRef = useRef<JsonEditorRef>(null);

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty, isValid },
    watch,
  } = useForm<ResponseNodeFormData>({
    resolver: zodResolver(responseNodeSchema),
    defaultValues: {
      statusCode: 200,
      responseBody: "{}",
      description: "",
    },
    mode: "onChange",
  });

  const selectedNodeId = getCurrentSelectedNodeId();

  // Helper function to get parent node (endpoint node) data
  const getParentNodeData = () => {
    if (!selectedNodeId || !currentEndpointState) return null;

    // Find the edge that connects to this response node
    const incomingEdge = currentEndpointState.edges.find(
      (edge) => edge.target === selectedNodeId,
    );
    if (!incomingEdge) return null;

    // Find the parent node
    const parentNode = currentEndpointState.nodes.find(
      (node) => node.id === incomingEdge.source,
    );
    return parentNode;
  };

  // Get available fields from parent endpoint node
  const getAvailableFields = () => {
    const parentNode = getParentNodeData();
    if (!parentNode || parentNode.data.type !== "endpointNode") return [];

    const endpointId = parentNode.data.endpointId;
    const endpoint = currentAPI.endpoints.find(
      (endpoint: APIEndpoint) => endpoint.id === endpointId,
    );
    const fields: Array<{ label: string; value: string; category: string }> =
      [];

    // Add path parameters
    if (endpoint.parameters) {
      endpoint.parameters.forEach((param: any) => {
        if (param.in === "path") {
          fields.push({
            label: `Path: ${param.name}`,
            value: `{{params.${param.name}}}`,
            category: "Path Parameters",
          });
        }
      });
    }

    // Add query parameters
    if (endpoint.parameters) {
      endpoint.parameters.forEach((param: any) => {
        if (param.in === "query") {
          fields.push({
            label: `Query: ${param.name}`,
            value: `{{query.${param.name}}}`,
            category: "Query Parameters",
          });
        }
      });
    }

    // Add request body fields (simplified - you might want to parse the schema)
    if (endpoint.method !== "GET") {
      fields.push({
        label: "Request Body",
        value: "{{body}}",
        category: "Request Body",
      });
    }

    // Add headers
    fields.push({
      label: "Authorization Header",
      value: "{{headers.authorization}}",
      category: "Headers",
    });

    fields.push({
      label: "Content-Type Header",
      value: "{{headers.contentType}}",
      category: "Headers",
    });

    return fields;
  };

  // Insert field into Monaco editor
  const insertField = (fieldValue: string) => {
    if (!monacoEditorRef.current) return;

    const editor = monacoEditorRef.current.getEditor();
    if (!editor) return;

    const selection = editor.getSelection();
    if (!selection) return;

    const range = {
      startLineNumber: selection.startLineNumber,
      startColumn: selection.startColumn,
      endLineNumber: selection.endLineNumber,
      endColumn: selection.endColumn,
    };

    // Insert the field value at the current selection
    editor.executeEdits("insert-field", [
      {
        range: range,
        text: fieldValue,
        forceMoveMarkers: true,
      },
    ]);

    // Update the form value with the new content
    const newValue = editor.getValue();
    setValue("responseBody", newValue, {
      shouldDirty: true,
      shouldValidate: true,
    });

    // Focus the editor
    editor.focus();
  };

  // Load node data when selection changes
  useEffect(() => {
    if (selectedNodeId && currentEndpointState) {
      const node = currentEndpointState.nodes.find(
        (n) => n.id === selectedNodeId,
      );
      if (node && node.data.type === "responseNode") {
        reset({
          statusCode: node.data.statusCode || 200,
          responseBody: node.data.responseBody || "{}",
          description: node.data.description || "",
        });
      }
    }
  }, [selectedNodeId, currentEndpointState, reset]);

  const onSubmit = (data: ResponseNodeFormData) => {
    if (!selectedNodeId) return;

    // Update the node data
    updateNode(selectedNodeId, {
      statusCode: data.statusCode,
      responseBody: data.responseBody,
      description: data.description,
    });
  };

  const commonStatusCodes = [
    { value: 200, label: "200 - OK" },
    { value: 201, label: "201 - Created" },
    { value: 204, label: "204 - No Content" },
    { value: 400, label: "400 - Bad Request" },
    { value: 401, label: "401 - Unauthorized" },
    { value: 403, label: "403 - Forbidden" },
    { value: 404, label: "404 - Not Found" },
    { value: 422, label: "422 - Unprocessable Entity" },
    { value: 500, label: "500 - Internal Server Error" },
  ];

  if (!selectedNodeId) {
    return null;
  }

  return (
    <div className="pt-4">
      <h4 className="mb-3 text-sm font-medium text-foreground">
        Edit Response Node
      </h4>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Node ID Display */}
        <div className="text-xs text-muted-foreground">
          Node ID:{" "}
          <span className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            {selectedNodeId}
          </span>
        </div>

        {/* Status Code */}
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="use-custom-status"
              checked={useCustomStatusCode}
              onCheckedChange={(checked) =>
                setUseCustomStatusCode(checked === true)
              }
            />
            <Label
              htmlFor="use-custom-status"
              className="text-xs font-medium text-foreground"
            >
              Use custom status code
            </Label>
          </div>

          {useCustomStatusCode ? (
            <Controller
              name="statusCode"
              control={control}
              render={({ field }) => (
                <Input
                  id="custom-status"
                  type="number"
                  value={field.value}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "") {
                      field.onChange(200); // Default to 200 if empty
                    } else {
                      const parsedValue = parseInt(value, 10);
                      if (!isNaN(parsedValue)) {
                        field.onChange(parsedValue);
                      }
                    }
                  }}
                  className="h-8"
                  placeholder="Enter custom status code"
                />
              )}
            />
          ) : (
            <Controller
              name="statusCode"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value.toString()}
                  onValueChange={(value) => {
                    const parsedValue = parseInt(value, 10);
                    if (!isNaN(parsedValue)) {
                      field.onChange(parsedValue);
                    }
                  }}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select status code" />
                  </SelectTrigger>
                  <SelectContent>
                    {commonStatusCodes.map((code) => (
                      <SelectItem
                        key={code.value}
                        value={code.value.toString()}
                      >
                        {code.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}

          {errors.statusCode && (
            <p className="text-xs text-destructive">
              {errors.statusCode.message}
            </p>
          )}
        </div>

        {/* Response Body */}
        <div className="space-y-2">
          <Label
            htmlFor="response-body"
            className="text-xs font-medium text-foreground"
          >
            Response Body
          </Label>

          {/* Available Fields */}
          {getAvailableFields().length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Available Fields
              </Label>
              <div className="flex flex-wrap gap-1">
                {getAvailableFields().map((field, index) => (
                  <Badge
                    key={index}
                    variant="secondary"
                    className="cursor-pointer text-xs hover:bg-primary hover:text-primary-foreground"
                    onClick={() => insertField(field.value)}
                    title={`Insert ${field.value}`}
                  >
                    {field.label}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <Controller
            name="responseBody"
            control={control}
            render={({ field }) => {
              return (
                <JsonEditor
                  ref={monacoEditorRef}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Enter JSON response body. Use {{params.id}}, {{query.search}}, {{body.name}} etc."
                  className="border-input"
                />
              );
            }}
          />
          {errors.responseBody && (
            <p className="text-xs text-destructive">
              {errors.responseBody.message}
            </p>
          )}
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label
            htmlFor="description"
            className="text-xs font-medium text-foreground"
          >
            Description
          </Label>
          <Controller
            name="description"
            control={control}
            render={({ field }) => (
              <Input
                id="description"
                value={field.value || ""}
                onChange={field.onChange}
                className="h-8"
                placeholder="Enter description"
              />
            )}
          />
          {errors.description && (
            <p className="text-xs text-destructive">
              {errors.description.message}
            </p>
          )}
        </div>

        {/* Save Button */}
        <Button
          type="submit"
          className="h-8 w-full text-xs"
          disabled={!isDirty || !isValid}
        >
          Save Changes
        </Button>
      </form>
    </div>
  );
};

export default ResponseNodeEdit;
