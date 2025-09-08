import {
  BugIcon,
  FlaskConicalIcon,
  LogsIcon,
  NotebookTabsIcon,
  TerminalIcon,
  WorkflowIcon,
  FileTextIcon,
} from "lucide-react";

export const ENDPOINT_PAGE_NAVS = [
  {
    label: "Overview",
    value: "overview",
    icon: NotebookTabsIcon,
  },
  {
    label: "Workbench",
    value: "workbench",
    icon: WorkflowIcon,
  },
  {
    label: "Test",
    value: "test",
    icon: FlaskConicalIcon,
  },
];

export const ENDPOINT_PAGE_STATUS_NAVS = [
  {
    label: "Logs",
    value: "logs",
    icon: LogsIcon,
  },
  {
    label: "Errors",
    value: "errors",
    icon: BugIcon,
  },
];

export const ENDPOINT_PAGE_TEST_NAVS = [
  {
    label: "Code",
    value: "code",
    icon: TerminalIcon,
  },
  {
    label: "Response",
    value: "response",
    icon: FileTextIcon,
  },
];
