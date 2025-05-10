import OpenedFiles from "@/components/navbar/opened-files";
import { cookies } from "next/headers";

const EditorPage = async () => {
  const dbType = cookies().get("dbType")?.value||"";
  return <OpenedFiles dbType={dbType} />;
};

export default EditorPage;
